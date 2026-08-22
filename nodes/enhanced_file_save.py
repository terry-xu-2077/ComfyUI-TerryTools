from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import torch
import folder_paths
from comfy.cli_args import args
from comfy_api.latest import ComfyExtension, io, ui, Types
from typing_extensions import override


_INVALID_WIN_CHARS = re.compile(r'[<>:"|?*\x00-\x1F]')


def _detect_type(data: Any) -> str:
    """Return one of: text / audio / image / video."""
    if isinstance(data, str):
        return "text"

    if isinstance(data, dict) and "waveform" in data and (
        "sample_rate" in data or "sampler_rate" in data
    ):
        return "audio"

    if isinstance(data, torch.Tensor):
        # ComfyUI IMAGE is normally [B,H,W,C].
        if data.ndim == 4 and data.shape[-1] in (1, 3, 4):
            return "image"

    # Current ComfyUI VIDEO objects expose these methods through VideoInput.
    if hasattr(data, "save_to") and hasattr(data, "get_dimensions"):
        return "video"

    raise TypeError(
        "增强文件保存：当前仅支持 VIDEO / STRING / IMAGE / AUDIO。"
        f" 实际收到：{type(data).__module__}.{type(data).__name__}"
    )


def _timestamp(
    use_timestamp: bool,
    ts_year: bool,
    ts_date: bool,
    ts_hour: bool,
    ts_minute_second: bool,
) -> str:
    if not use_timestamp:
        return ""

    now = datetime.now()
    parts = []

    if ts_year:
        parts.append(now.strftime("%Y"))

    if ts_date:
        parts.append(now.strftime("%m-%d"))

    time_parts = []
    if ts_hour:
        time_parts.append(now.strftime("%H"))
    if ts_minute_second:
        time_parts.extend([now.strftime("%M"), now.strftime("%S")])

    if time_parts:
        parts.append("-".join(time_parts))

    return "_".join(parts)


def _sanitize_rel_path(value: str) -> str:
    """
    Keep subfolders, but forbid absolute paths / traversal / Windows-invalid chars.
    """
    value = (value or "").replace("\\", "/").strip()
    value = value.lstrip("/")

    clean_parts = []
    for raw in value.split("/"):
        raw = raw.strip()
        if not raw or raw in (".", ".."):
            continue
        raw = _INVALID_WIN_CHARS.sub("_", raw)
        raw = raw.rstrip(" .")
        if raw:
            clean_parts.append(raw)

    return "/".join(clean_parts) or "ComfyUI"


def _build_rel_stem(
    filename_template: str,
    use_timestamp: bool,
    ts_year: bool,
    ts_date: bool,
    ts_hour: bool,
    ts_minute_second: bool,
) -> str:
    stamp = _timestamp(
        use_timestamp, ts_year, ts_date, ts_hour, ts_minute_second
    )
    value = (filename_template or "ComfyUI").replace("%date%", stamp)
    value = _sanitize_rel_path(value)

    # The template is a "filename stem". If the user typed an extension,
    # strip it here so the selected encoder always owns the real extension.
    p = Path(value)
    if p.suffix:
        value = str(p.with_suffix("")).replace("\\", "/")

    return value.rstrip("._- ") or "ComfyUI"


def _with_sequence(stem: str, append_sequence: bool, index: int, padding: int) -> str:
    if not append_sequence:
        return stem
    return f"{stem}_{index:0{max(1, int(padding))}d}"


def _target_path(rel_stem: str, extension: str) -> tuple[str, str, str]:
    """
    Returns (absolute_path, filename, subfolder) under ComfyUI/output.
    """
    rel_stem = _sanitize_rel_path(rel_stem)
    rel = Path(rel_stem + "." + extension.lstrip("."))
    output_dir = Path(folder_paths.get_output_directory()).resolve()
    target = (output_dir / rel).resolve()

    # Defensive path containment check.
    if output_dir not in target.parents and target != output_dir:
        raise ValueError("增强文件保存：输出路径越界。")

    target.parent.mkdir(parents=True, exist_ok=True)
    subfolder = str(rel.parent).replace("\\", "/")
    if subfolder == ".":
        subfolder = ""

    return str(target), rel.name, subfolder


def _metadata_for_video(cls) -> dict | None:
    if args.disable_metadata:
        return None

    metadata = {}
    hidden = getattr(cls, "hidden", None)
    if hidden is not None:
        extra = getattr(hidden, "extra_pnginfo", None)
        prompt = getattr(hidden, "prompt", None)
        if extra:
            metadata.update(extra)
        if prompt:
            metadata["prompt"] = prompt
    return metadata or None


def _move_overwrite(src: str, dst: str):
    """
    Exact-name semantics:
    existing destination is overwritten intentionally.
    """
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)


class EnhancedFileSave(io.ComfyNode):
    """
    One wildcard input, four supported payload families.
    Frontend JS only changes visibility; backend always detects the real runtime type.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="EnhancedFileSave",
            display_name="Terry | 增强文件保存",
            category="TerryTools/Save",
            description=(
                "一个输入端接收 VIDEO / STRING / IMAGE / AUDIO。"
                "按真实输入类型自动保存，并提供精确文件名、%date% 时间戳和可选序列号。"
            ),
            is_output_node=True,
            inputs=[
                io.AnyType.Input(
                    "data",
                    display_name="内容",
                    tooltip="支持 VIDEO / STRING / IMAGE / AUDIO。",
                ),

                # ---------- Common naming ----------
                io.String.Input(
                    "filename_template",
                    display_name="文件名",
                    default="ComfyUI_%date%",
                    tooltip=(
                        "可包含子文件夹，例如 project/shot_%date%。"
                        "%date% 会按下方勾选项替换。若填写扩展名，将自动移除，"
                        "真实扩展名由内容格式决定。"
                    ),
                ),
                io.Boolean.Input(
                    "use_timestamp",
                    display_name="启用 %date% 时间戳",
                    default=True,
                ),
                io.Boolean.Input(
                    "ts_year",
                    display_name="时间戳：年份",
                    default=True,
                ),
                io.Boolean.Input(
                    "ts_date",
                    display_name="时间戳：日期",
                    default=True,
                ),
                io.Boolean.Input(
                    "ts_hour",
                    display_name="时间戳：时",
                    default=True,
                ),
                io.Boolean.Input(
                    "ts_minute_second",
                    display_name="时间戳：分秒",
                    default=True,
                ),
                io.Boolean.Input(
                    "append_sequence",
                    display_name="尾部添加序列号",
                    default=False,
                    tooltip=(
                        "关闭时绝不自动补 ComfyUI 的 _00001_。"
                        "若目标已存在，直接覆盖。"
                    ),
                ),
                io.Int.Input(
                    "sequence_start",
                    display_name="序列号起始值",
                    default=1,
                    min=0,
                    max=999999999,
                    step=1,
                ),
                io.Int.Input(
                    "sequence_padding",
                    display_name="序列号位数",
                    default=5,
                    min=1,
                    max=12,
                    step=1,
                ),

                # ---------- IMAGE ----------
                io.Int.Input(
                    "image_compress_level",
                    display_name="PNG 压缩等级",
                    default=4,
                    min=0,
                    max=9,
                    step=1,
                    tooltip="直接使用 ComfyUI ImageSaveHelper。",
                ),

                # ---------- AUDIO ----------
                io.Combo.Input(
                    "audio_format",
                    display_name="音频格式",
                    options=["flac", "mp3", "opus"],
                    default="flac",
                ),
                io.Combo.Input(
                    "audio_quality",
                    display_name="音频质量",
                    options=["V0", "64k", "96k", "128k", "192k", "320k"],
                    default="128k",
                ),

                # ---------- VIDEO ----------
                io.Combo.Input(
                    "video_format",
                    display_name="视频容器",
                    options=Types.VideoContainer.as_input(),
                    default="auto",
                    tooltip="当前 ComfyUI 原生 SaveVideo 的容器选项。",
                ),
                io.Combo.Input(
                    "video_codec",
                    display_name="视频编码",
                    options=["auto", "h264"],
                    default="auto",
                    tooltip="当前 ComfyUI 原生 SaveVideo 的编码选项。",
                ),
                io.Combo.Input(
                    "video_encoding",
                    display_name="H.264 编码模式",
                    options=["auto", "re-encode"],
                    default="auto",
                ),
                io.Float.Input(
                    "video_crf",
                    display_name="H.264 CRF",
                    default=23.0,
                    min=0.0,
                    max=51.0,
                    step=1.0,
                ),

                # ---------- TEXT ----------
                io.Combo.Input(
                    "text_extension",
                    display_name="文本后缀",
                    options=["txt", "md", "json", "csv", "log", "custom"],
                    default="txt",
                ),
                io.String.Input(
                    "text_custom_extension",
                    display_name="自定义文本后缀",
                    default="txt",
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[io.AnyType.Output("data", display_name="原内容")],
        )

    @classmethod
    def execute(
        cls,
        data,
        filename_template,
        use_timestamp,
        ts_year,
        ts_date,
        ts_hour,
        ts_minute_second,
        append_sequence,
        sequence_start,
        sequence_padding,
        image_compress_level,
        audio_format,
        audio_quality,
        video_format,
        video_codec,
        video_encoding,
        video_crf,
        text_extension,
        text_custom_extension,
    ) -> io.NodeOutput:
        kind = _detect_type(data)

        stem = _build_rel_stem(
            filename_template,
            use_timestamp,
            ts_year,
            ts_date,
            ts_hour,
            ts_minute_second,
        )

        if kind == "text":
            ext = (
                text_custom_extension.strip().lstrip(".")
                if text_extension == "custom"
                else text_extension
            )
            ext = re.sub(r"[^A-Za-z0-9_-]", "", ext) or "txt"

            rel_stem = _with_sequence(
                stem, append_sequence, int(sequence_start), int(sequence_padding)
            )
            target, _, _ = _target_path(rel_stem, ext)
            with open(target, "w", encoding="utf-8", newline="") as f:
                f.write(data)
            return io.NodeOutput(data)

        if kind == "video":
            rel_stem = _with_sequence(
                stem, append_sequence, int(sequence_start), int(sequence_padding)
            )

            fmt = Types.VideoContainer(video_format)
            ext = Types.VideoContainer.get_extension(video_format)
            target, filename, subfolder = _target_path(rel_stem, ext)

            # Mirrors current ComfyUI SaveVideo:
            # auto keeps compatible source streams when possible;
            # h264 + re-encode applies CRF.
            codec_name = video_codec
            crf = video_crf if (
                video_codec == "h264" and video_encoding == "re-encode"
            ) else None

            kwargs = {
                "format": fmt,
                "codec": codec_name,
                "metadata": _metadata_for_video(cls),
            }
            # Current VideoInput implementations accept CRF in SaveVideo's path.
            # Some older VideoInput builds do not; gracefully fall back if needed.
            if crf is not None:
                try:
                    data.save_to(target, crf=crf, **kwargs)
                except TypeError:
                    data.save_to(target, **kwargs)
            else:
                data.save_to(target, **kwargs)

            return io.NodeOutput(
                data,
                ui=ui.PreviewVideo(
                    [ui.SavedResult(filename, subfolder, io.FolderType.output)]
                ),
            )

        if kind == "audio":
            # Current helper expects sample_rate. Normalize the older sampler_rate spelling.
            audio = data
            if "sample_rate" not in audio and "sampler_rate" in audio:
                audio = dict(audio)
                audio["sample_rate"] = audio["sampler_rate"]

            # Use ComfyUI's native audio encoder, then rename exactly.
            temp_prefix = f".enhanced_file_save_tmp/{uuid.uuid4().hex}"
            quality = audio_quality
            if audio_format == "flac":
                quality = "128k"  # ignored by native helper for FLAC

            saved = ui.AudioSaveHelper.save_audio(
                audio,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                format=audio_format,
                quality=quality,
            )

            final_results = []
            for i, result in enumerate(saved):
                seq = int(sequence_start) + i
                rel_stem = _with_sequence(
                    stem, append_sequence, seq, int(sequence_padding)
                )
                target, filename, subfolder = _target_path(rel_stem, audio_format)

                src = os.path.join(
                    folder_paths.get_output_directory(),
                    result.subfolder,
                    result.filename,
                )
                _move_overwrite(src, target)
                final_results.append(
                    ui.SavedResult(filename, subfolder, io.FolderType.output)
                )

            return io.NodeOutput(data, ui=ui.SavedAudios(final_results))

        if kind == "image":
            # Use ComfyUI's native PNG encoding + metadata implementation,
            # then rename to remove its compulsory counter.
            temp_prefix = f".enhanced_file_save_tmp/{uuid.uuid4().hex}"
            saved = ui.ImageSaveHelper.save_images(
                data,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                compress_level=int(image_compress_level),
            )

            final_results = []
            for i, result in enumerate(saved):
                seq = int(sequence_start) + i
                rel_stem = _with_sequence(
                    stem, append_sequence, seq, int(sequence_padding)
                )
                target, filename, subfolder = _target_path(rel_stem, "png")

                src = os.path.join(
                    folder_paths.get_output_directory(),
                    result.subfolder,
                    result.filename,
                )
                _move_overwrite(src, target)
                final_results.append(
                    ui.SavedResult(filename, subfolder, io.FolderType.output)
                )

            return io.NodeOutput(data, ui=ui.SavedImages(final_results))

        raise RuntimeError("Unreachable")
