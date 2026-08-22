# TerryTools for ComfyUI


## v0.3.1 - H3 即时参考缩略图

`Terry | H3 提示词编辑器` 的参考预览改为前端即时解析：

- 不需要 Queue / 执行节点即可显示已连接加载器中的图片和视频预览。
- 顺着工作流连线读取上游 `LoadImage / LoadVideo / LoadAudio` 当前 widget 的文件选择。
- 直接通过 ComfyUI `/view?...&type=input` 显示 input 目录中的媒体。
- 若上游节点已经有自己的预览元素，也会直接复用。
- 上游加载器换文件时，H3 编辑器中的 `@` 菜单和已插入参考会即时刷新。
- 执行后生成的 temp preview 仍保留为兼容性兜底，用于无法从上游节点解析出文件路径的自定义媒体节点。


## v0.3.0 - Terry | H3 提示词编辑器

新增 `TerryTools / Text / Terry | H3 提示词编辑器`。

- 一个标准 H3 多行文本编辑器，输出端始终输出原始 H3 `STRING`。
- 使用 ComfyUI V3 `Autogrow + AnyType` 动态参考输入，可持续增加图片、视频、音频输入。
- `@` 输入参考选择器：按连接顺序分别生成 `Picture N / Video N / Audio N`；图片显示缩略图，视频显示小预览，音频显示图标与来源节点名称。
- `可视化 / 原文` 双模式实时同步。
- 自动把 `<Picture N>`、`<Video N>`、`<Audio N>`、`<Subject N>`、`[Shot N]`、`(Sx)`、时间码与 retention marker 渲染成直观标签。
- `<d>[Language] ...</d>` 渲染为语言下拉框 + 对话文本，序列化时仍恢复标准 H3 文本。
- 支持 `<scenetrans>`、`<cutoff>` 等 H3 连续性标签。
- 参考图片/视频的缩略预览在节点执行后使用 ComfyUI temp 生成，不写入正式 output。

说明：可视化层只用于编辑体验，工作流保存和节点输出仍以隐藏的原始 `prompt` widget 为唯一文本源，避免富文本格式污染 H3 prompt。


## v0.2.2 - 视频对比默认循环

- `Terry | 视频对比` 默认循环播放。
- 播放到 A/B 中较长视频结尾后，自动回到 0 秒并重新同步播放。
- 较短视频在超过自身时长的区间仍显示黑场。


## v0.2.1 - 视频对比时长策略

- 时间轴改为以 A/B 中较长视频为上限。
- 较短视频结束后自动进入黑场，另一条继续播放。
- 拖动到短视频时长之外时，该侧直接显示黑场。



## v0.2.0 - Terry | 视频对比

新增 `TerryTools / Video / Terry | 视频对比`。

- 两个 VIDEO 输入：A、B。
- 一个共用预览区域。
- A/B 以竖向分割线方式叠加比较。
- 中间分割线可拖动，也支持左右方向键微调。
- 底部独立同步时间轴，可拖动定位。
- A/B 共用播放 / 暂停。
- 播放时持续校正两路 `currentTime` 漂移。
- 两段视频时长不同，以较长视频作为时间轴上限；较短视频结束后对应一侧显示黑场。
- A/B 默认静音，避免双音轨同时播放。
- 预览文件写入 ComfyUI `temp`，不会进入正式 output。
- A、B 原视频仍从节点输出，可继续连接后续节点。



## v0.1.1 - 紧凑动态参数面板

`Terry | 增强文件保存` 现在改为真正的动态界面：

- 未连接输入：只保留通用文件命名参数。
- IMAGE：只显示图片相关参数。
- VIDEO：只显示视频相关参数。
- AUDIO：只显示音频相关参数。
- STRING：只显示文本相关参数。
- 时间戳关闭时，年份 / 日期 / 时 / 分秒自动折叠。
- 序列号关闭时，起始值 / 位数自动折叠。
- 视频、音频、文本内部的从属选项继续按条件折叠。
- 隐藏参数高度归零，不再把节点撑大。


**TerryTools** 是 Terry 的个人 ComfyUI 工具箱节点包。

这个仓库不绑定某一种节点类型。后续 Terry 需要的保存、批处理、图像、视频、文本、工作流辅助和效率类节点，都可以继续放进同一个节点包中。

## 当前节点

### Terry | 增强文件保存

分类：

`TerryTools / Save`

功能：

- 一个 `AnyType` 输入接口。
- 自动识别 VIDEO / STRING / IMAGE / AUDIO。
- 根据连接类型动态显示对应参数。
- 图片、视频、音频尽量复用 ComfyUI 原生保存/编码实现。
- `%date%` 文件名替换。
- 时间戳可独立选择：
  - 年
  - 日期
  - 时
  - 分秒
- 文件尾部序列号可完全关闭。
- 关闭序列号时使用精确文件名。
- 同名文件存在时直接覆盖。
- 支持文件名中的子目录。
- 文本支持自定义扩展名。

## 目录结构

```text
ComfyUI-TerryTools/
├─ __init__.py
├─ nodes/
│  ├─ __init__.py
│  └─ enhanced_file_save.py
└─ web/
   └─ enhanced_file_save.js
```

今后新增 Python 节点统一放入：

`nodes/`

前端扩展统一放入：

`web/`

这样无需为每一个节点安装一个独立 custom_nodes 插件。

## 安装

将整个：

`ComfyUI-TerryTools`

放入：

`ComfyUI/custom_nodes/`

最终路径：

`ComfyUI/custom_nodes/ComfyUI-TerryTools/`

然后重启 ComfyUI。

## 扩展约定

建议 TerryTools 后续统一采用以下分类：

- `TerryTools/Save`
- `TerryTools/Image`
- `TerryTools/Video`
- `TerryTools/Audio`
- `TerryTools/Text`
- `TerryTools/Workflow`
- `TerryTools/Utility`

节点显示名统一使用：

`Terry | 节点名称`

这样节点搜索和分类会比较清晰。
