const TARGET_TITLES = [
  "Terry 文件保存（无序号）",
  "Terry File Save (No Sequence)",
  "Terry 增强文件保存",
  "Terry Enhanced File Save",
];

const MEDIA_LABELS = [
  "PNG 压缩等级",
  "PNG Compression Level",
  "音频格式",
  "Audio Format",
  "音频质量",
  "Audio Quality",
  "视频容器",
  "Video Container",
  "视频编码",
  "Video Codec",
  "H.264 编码模式",
  "H.264 Encoding Mode",
  "H.264 CRF",
  "文本后缀",
  "Text Extension",
  "自定义文本后缀",
  "Custom Text Extension",
];

const FILE_LABELS = ["文件名", "Filename"];
const DIVIDER = "1px solid rgba(180,180,180,.28)";

function normalizedText(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function matchesAny(text, values) {
  return values.some((value) => text.includes(value));
}

function updateNode(root) {
  const nodeText = normalizedText(root);
  if (!matchesAny(nodeText, TARGET_TITLES)) return;

  const rows = [...root.querySelectorAll('[data-testid="node-widget"]')];
  const hasMedia = rows.some((row) => matchesAny(normalizedText(row), MEDIA_LABELS));
  const fileRow = rows.find((row) => matchesAny(normalizedText(row), FILE_LABELS));
  if (!fileRow) return;

  if (hasMedia) {
    fileRow.style.borderTop = DIVIDER;
  } else {
    fileRow.style.borderTop = "";
  }
}

function refresh() {
  for (const root of document.querySelectorAll("[data-node-id]")) {
    updateNode(root);
  }
}

let queued = false;
function queueRefresh() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    refresh();
  });
}

if (document.body) {
  const observer = new MutationObserver(queueRefresh);
  observer.observe(document.body, { childList: true, subtree: true });
  queueRefresh();
}
