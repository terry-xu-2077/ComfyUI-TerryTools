from __future__ import annotations

import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import folder_paths
import torch
from comfy.cli_args import args
from comfy_api.latest import Types, io, ui


_INVALID_WIN_CHARS = re.compile(r'[<>:"|?*\x00-\x1F]')

DATE_FORMATS = {
    "none": "",
    "YYYYMMDD_HHmmss": "%Y%m%d_%H%M%S",
    "YYYY-MM-DD_HH-mm-ss": "%Y-%m-%d_%H-%M-%S",
    "YYYY_MM_DD_HH_mm_ss": "%Y_%m_%d_%H_%M_%S",
    "YYYYMMDDHHmmss": "%Y%m%d%H%M%S",
    "YYYYMMDD_HHmm": "%Y%m%d_%H%M",
    "YYYY-MM-DD_HH-mm": "%Y-%m-%d_%H-%M",
    "YYYY_MM_DD_HH_mm": "%Y_%m_%d_%H_%M",
    "YYYYMMDDHHmm": "%Y%m%d%H%M",
    "YYYYMMDD_HH": "%Y%m%d_%H",
    "YYYY-MM-DD_HH": "%Y-%m-%d_%H",
    "YYYY_MM_DD_HH": "%Y_%m_%d_%H",
    "YYYYMMDDHH": "%Y%m%d%H",
    "YYYYMMDD": "%Y%m%d",
    "YYYY-MM-DD": "%Y-%m-%d",
    "YYYY_MM_DD": "%Y_%m_%d",
    "YYYYMM": "%Y%m",
}


def _detect_type(data: Any) -> str:
    if isinstance(data, str):
        return "text"
    if isinstance(data, dict) and "waveform" in data and (
        "sample_rate" in data or "sampler_rate" in data
    ):
        return "audio"
    if isinstance(data, torch.Tensor):
        if data.ndim == 4 and data.shape[-1] in (1, 3, 4):
            return "image"
    if hasattr(data, "save_to") and hasattr(data, "get_dimensions"):
        return "video"
    raise TypeError(
        "增强文件保存：当前仅支持 VIDEO / STRING / IMAGE / AUDIO。"
        f" 实际收到：{type(data).__module__}.{type(data).__name__}"
    )


def _timestamp(date_format: str) -> str:
    pattern = DATE_FORMATS.get(str(date_format or "none"), "")
    return datetime.now().strftime(pattern) if pattern else ""


def _sanitize_rel_path(value: str) -> str:
    value = (value or "").replace("\\", "/").strip().lstrip("/")
    clean_parts = []
    for raw in value.split("/"):
        raw = raw.strip()
        if not raw or raw in (".", ".."):
            continue
        raw = _INVALID_WIN_CHARS.sub("_", raw).rstrip(" .")
        if raw:
            clean_parts.append(raw)
    return "/".join(clean_parts) or "ComfyUI"


def _build_rel_stem(filename_template: str, date_format: str) -> str:
    stamp = _timestamp(date_format)
    value = (filename_template or "ComfyUI").replace("%date%", stamp)
    value = _sanitize_rel_path(value)
    p = Path(value)
    if p.suffix:
        value = str(p.with_suffix("")).replace("\\", "/")
    return value.rstrip("._- ") or "ComfyUI"


def _with_sequence(stem: str, append_sequence: bool, index: int, padding: int) -> str:
    if not append_sequence:
        return stem
    return f"{stem}_{index:0{max(1, int(padding))}d}"


def _output_name(rel_stem: str) -> str:
    return Path(rel_stem).name


def _output_names(rel_stems: list[str]) -> str:
    return "\n".join(_output_name(stem) for stem in rel_stems)


def _target_path(rel_stem: str, extension: str) -> tuple[str, str, str]:
    rel_stem = _sanitize_rel_path(rel_stem)
    rel = Path(rel_stem + "." + extension.lstrip("."))
    output_dir = Path(folder_paths.get_output_directory()).resolve()
    target = (output_dir / rel).resolve()
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
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)


class EnhancedFileSave(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="EnhancedFileSave",
            display_name="Terry | 增强文件保存",
            category="TerryTools/Save",
            description=(
                "一个输入端接收 VIDEO / STRING / IMAGE / AUDIO。"
                "按真实输入类型自动保存，并提供精确文件名、可格式化 %date% 日期和可选序列号。"
            ),
            is_output_node=True,
            inputs=[
                io.AnyType.Input(
                    "data",
                    display_name="内容",
                    tooltip="支持 VIDEO / STRING / IMAGE / AUDIO。",
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

                # ---------- Filename ----------
                io.String.Input(
                    "filename_template",
                    display_name="文件名",
                    default="ComfyUI_%date%",
                    tooltip=(
                        "可包含子文件夹，例如 project/shot_%date%。"
                        "%date% 会按日期格式下拉选项替换。若填写扩展名，将自动移除，"
                        "真实扩展名由内容格式决定。"
                    ),
                ),
                io.Combo.Input(
                    "date_format",
                    display_name="日期格式",
                    options=list(DATE_FORMATS.keys()),
                    default="YYYYMMDDHHmmss",
                    tooltip="文件名中的 %date% 会按所选格式替换；选择 none 时不加入日期。",
                ),
                io.Boolean.Input(
                    "append_sequence",
                    display_name="尾部添加序列号",
                    default=False,
                    tooltip="关闭时不自动补 ComfyUI 计数器；目标已存在时直接覆盖。",
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
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[
                io.AnyType.Output("data", display_name="原内容"),
                io.String.Output("filename", display_name="文件名"),
                io.String.Output("extension", display_name="文件后缀"),
            ],
        )

    @classmethod
    def execute(
        cls,
        data,
        image_compress_level,
        audio_format,
        audio_quality,
        video_format,
        video_codec,
        video_encoding,
        video_crf,
        text_extension,
        text_custom_extension,
        filename_template,
        date_format,
        append_sequence,
        sequence_start,
        sequence_padding,
    ) -> io.NodeOutput:
        kind = _detect_type(data)
        stem = _build_rel_stem(filename_template, date_format)

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
            return io.NodeOutput(data, _output_name(rel_stem), ext)

        if kind == "video":
            rel_stem = _with_sequence(
                stem, append_sequence, int(sequence_start), int(sequence_padding)
            )
            fmt = Types.VideoContainer(video_format)
            ext = str(Types.VideoContainer.get_extension(video_format)).lstrip(".")
            target, filename, subfolder = _target_path(rel_stem, ext)
            crf = video_crf if (
                video_codec == "h264" and video_encoding == "re-encode"
            ) else None
            kwargs = {
                "format": fmt,
                "codec": video_codec,
                "metadata": _metadata_for_video(cls),
            }
            if crf is not None:
                try:
                    data.save_to(target, crf=crf, **kwargs)
                except TypeError:
                    data.save_to(target, **kwargs)
            else:
                data.save_to(target, **kwargs)
            return io.NodeOutput(
                data,
                _output_name(rel_stem),
                ext,
                ui=ui.PreviewVideo(
                    [ui.SavedResult(filename, subfolder, io.FolderType.output)]
                ),
            )

        if kind == "audio":
            audio = data
            if "sample_rate" not in audio and "sampler_rate" in audio:
                audio = dict(audio)
                audio["sample_rate"] = audio["sampler_rate"]
            temp_prefix = f".enhanced_file_save_tmp/{uuid.uuid4().hex}"
            quality = "128k" if audio_format == "flac" else audio_quality
            saved = ui.AudioSaveHelper.save_audio(
                audio,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                format=audio_format,
                quality=quality,
            )
            final_results = []
            rel_stems = []
            for i, result in enumerate(saved):
                seq = int(sequence_start) + i
                rel_stem = _with_sequence(
                    stem, append_sequence, seq, int(sequence_padding)
                )
                rel_stems.append(rel_stem)
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
            return io.NodeOutput(
                data,
                _output_names(rel_stems),
                audio_format,
                ui=ui.SavedAudios(final_results),
            )

        if kind == "image":
            temp_prefix = f".enhanced_file_save_tmp/{uuid.uuid4().hex}"
            saved = ui.ImageSaveHelper.save_images(
                data,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                compress_level=int(image_compress_level),
            )
            final_results = []
            rel_stems = []
            for i, result in enumerate(saved):
                seq = int(sequence_start) + i
                rel_stem = _with_sequence(
                    stem, append_sequence, seq, int(sequence_padding)
                )
                rel_stems.append(rel_stem)
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
            return io.NodeOutput(
                data,
                _output_names(rel_stems),
                "png",
                ui=ui.SavedImages(final_results),
            )

        raise RuntimeError("Unreachable")