from __future__ import annotations

from comfy_api.latest import Types, io

from .enhanced_file_save import EnhancedFileSave


class FileSave(EnhancedFileSave):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryFileSave",
            display_name="Terry 文件保存",
            category="TerryTools/Save",
            description=(
                "按输入的精确文件名保存 VIDEO / STRING / IMAGE / AUDIO。"
                "可选择在文件名尾部添加序号；关闭时目标文件已存在则直接覆盖。"
                "文件名既可在节点内填写，也可由外部 STRING 输入覆盖。"
            ),
            is_output_node=True,
            inputs=[
                io.AnyType.Input(
                    "data",
                    display_name="内容",
                    tooltip="支持 VIDEO / STRING / IMAGE / AUDIO。",
                ),
                io.Int.Input(
                    "image_compress_level",
                    display_name="PNG 压缩等级",
                    default=4,
                    min=0,
                    max=9,
                    step=1,
                ),
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
                io.Combo.Input(
                    "video_format",
                    display_name="视频容器",
                    options=Types.VideoContainer.as_input(),
                    default="auto",
                ),
                io.Combo.Input(
                    "video_codec",
                    display_name="视频编码",
                    options=["auto", "h264"],
                    default="auto",
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
                io.String.Input(
                    "filename",
                    display_name="文件名",
                    default="ComfyUI",
                    tooltip=(
                        "支持子文件夹，例如 project/shot_01。无需填写扩展名；"
                        "若填写扩展名会自动移除，真实扩展名由内容格式决定。"
                    ),
                ),
                io.Boolean.Input(
                    "append_sequence",
                    display_name="尾部添加序号",
                    default=True,
                    tooltip="开启时在文件名尾部添加序号；关闭时同名文件直接覆盖。",
                ),
                io.String.Input(
                    "filename_input",
                    display_name="文件名",
                    optional=True,
                    force_input=True,
                    tooltip="可连接外部 STRING；连接后优先使用外部文件名。",
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
        filename,
        append_sequence,
        filename_input=None,
    ) -> io.NodeOutput:
        effective_filename = filename_input if filename_input is not None else filename
        return super().execute(
            data=data,
            image_compress_level=image_compress_level,
            audio_format=audio_format,
            audio_quality=audio_quality,
            video_format=video_format,
            video_codec=video_codec,
            video_encoding=video_encoding,
            video_crf=video_crf,
            text_extension=text_extension,
            text_custom_extension=text_custom_extension,
            filename_template=effective_filename,
            date_format="none",
            append_sequence=append_sequence,
            sequence_start=1,
            sequence_padding=5,
        )
