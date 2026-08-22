from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

from .nodes import (
    DateFormatter,
    EnhancedFileSave,
    FileSaveNoSequence,
    H3PromptEditor,
    H3ShotTimeline,
    VideoCompare,
)

WEB_DIRECTORY = "./web"


class TerryToolsExtension(ComfyExtension):
    """
    TerryTools root extension.

    Future custom nodes should be imported from ./nodes and appended to
    get_node_list(), so the whole toolset remains one installable package.
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            # EnhancedFileSave,  # 暂时保留源码但不注册，待 Terry 文件保存测试稳定后再决定是否移除。
            FileSaveNoSequence,
            DateFormatter,
            VideoCompare,
            H3PromptEditor,
            H3ShotTimeline,
        ]


async def comfy_entrypoint() -> TerryToolsExtension:
    return TerryToolsExtension()


__all__ = ["comfy_entrypoint"]
