from __future__ import annotations

from datetime import datetime

from comfy_api.latest import io

from .enhanced_file_save import DATE_FORMATS


class DateFormatter(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        format_options = [key for key in DATE_FORMATS.keys() if key != "none"] + ["custom"]
        return io.Schema(
            node_id="TerryDateFormatter",
            display_name="Terry 日期格式化",
            category="TerryTools/Utils",
            description=(
                "将当前日期/时间按指定格式写入文本中的 %date%。"
                "输出为普通 STRING，可用于文件名、文件夹、提示词或任意文本拼接。"
            ),
            inputs=[
                io.String.Input(
                    "template",
                    display_name="文本模板",
                    default="%date%",
                    tooltip="文本中的所有 %date% 都会被当前日期/时间替换。",
                ),
                io.Combo.Input(
                    "date_format",
                    display_name="日期格式",
                    options=format_options,
                    default="YYYYMMDDHHmmss",
                    tooltip="选择预设格式，或选择 custom 后使用自定义 strftime 格式。",
                ),
                io.String.Input(
                    "custom_format",
                    display_name="自定义格式",
                    default="%Y%m%d_%H%M%S",
                    tooltip="仅在日期格式选择 custom 时使用，语法遵循 Python strftime。",
                ),
            ],
            outputs=[
                io.String.Output("text", display_name="格式化文本"),
                io.String.Output("date", display_name="日期文本"),
            ],
        )

    @classmethod
    def execute(cls, template, date_format, custom_format) -> io.NodeOutput:
        if date_format == "custom":
            pattern = custom_format or "%Y%m%d_%H%M%S"
        else:
            pattern = DATE_FORMATS.get(str(date_format), "%Y%m%d%H%M%S")

        date_text = datetime.now().strftime(pattern)
        text = str(template or "").replace("%date%", date_text)
        return io.NodeOutput(text, date_text)
