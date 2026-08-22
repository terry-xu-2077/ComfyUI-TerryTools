import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";

function isChineseLocale() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(value || navigator.language || "en")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return String(navigator.language || "en").toLowerCase().startsWith("zh");
  }
}

function isTarget(node) {
  return node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID;
}

function applyLocale(node) {
  if (!isTarget(node)) return false;
  const row = node.__terryTimestampRow;
  const element = row?.element;
  if (!element) return false;

  const zh = isChineseLocale();
  const strings = zh
    ? ["时间戳：", "年份", "日期", "时", "分秒"]
    : ["Timestamp:", "Year", "Date", "Hour", "Min/Sec"];

  const children = [...element.children];
  if (children[0]) children[0].textContent = strings[0];
  for (let i = 1; i <= 4; i++) {
    const label = children[i];
    const text = label?.querySelector?.("span");
    if (text) text.textContent = strings[i];
  }
  return true;
}

function schedule(node) {
  queueMicrotask(() => applyLocale(node));
  requestAnimationFrame(() => applyLocale(node));
  setTimeout(() => applyLocale(node), 80);
  setTimeout(() => applyLocale(node), 250);
}

let lastLocale = null;
function refreshAllWhenLocaleChanges() {
  let current = "";
  try {
    current = String(app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en");
  } catch {
    current = String(navigator.language || "en");
  }
  if (current === lastLocale) return;
  lastLocale = current;
  for (const node of app.graph?._nodes || []) applyLocale(node);
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.Locale",
  setup() {
    refreshAllWhenLocaleChanges();
    setInterval(refreshAllWhenLocaleChanges, 1000);
  },
  nodeCreated(node) {
    if (isTarget(node)) schedule(node);
  },
  loadedGraphNode(node) {
    if (isTarget(node)) schedule(node);
  },
});
