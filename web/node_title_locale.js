import { app } from "../../scripts/app.js";

const NODE_TITLES = {
  TerryFileSave: {
    en: "Terry File Save",
    zh: "Terry 文件保存",
  },
  TerryVideoCompare: {
    en: "Terry Video Compare",
    zh: "Terry 视频对比",
  },
  TerryGroupManager: {
    en: "Terry Group Manager",
    zh: "Terry 分组开关",
  },
  TerryH3PromptEditor: {
    en: "Terry H3 Prompt Editor",
    zh: "Terry H3 提示词编辑器",
  },
  TerryH3ShotTimeline: {
    en: "Terry H3 Prompt Editor (Timeline)",
    zh: "Terry H3 提示词编辑器（时间轴）",
  },
};

function currentLanguage() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-");
    return locale === "zh" || locale.startsWith("zh-") ? "zh" : "en";
  } catch {
    const locale = String(navigator.language || "en").toLowerCase();
    return locale.startsWith("zh") ? "zh" : "en";
  }
}

function titleFor(nodeId) {
  const entry = NODE_TITLES[nodeId];
  if (!entry) return null;
  return entry[currentLanguage()] || entry.en;
}

function nodeIdOf(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      ""
  );
}

function syncNodeTitle(node) {
  const nodeId = nodeIdOf(node);
  const title = titleFor(nodeId);
  if (!title) return;
  node.title = title;
  if (node.constructor) node.constructor.title = title;
  node.setDirtyCanvas?.(true, true);
}

function syncAllNodeTitles() {
  for (const graph of [app.graph, ...(app.graph?._subgraphs?.values?.() || [])]) {
    for (const node of graph?._nodes || []) syncNodeTitle(node);
  }
  app.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "TerryTools.NodeTitleLocale",

  addCustomNodeDefs(defs) {
    for (const nodeId of Object.keys(NODE_TITLES)) {
      const def = defs?.[nodeId];
      if (!def) continue;
      def.display_name = titleFor(nodeId);
    }
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    const title = titleFor(nodeData?.name);
    if (!title) return;

    nodeData.display_name = title;
    nodeType.title = title;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      this.title = titleFor(nodeData.name) || title;
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      queueMicrotask(() => syncNodeTitle(this));
      return result;
    };
  },

  nodeCreated(node) {
    queueMicrotask(() => syncNodeTitle(node));
  },

  loadedGraphNode(node) {
    queueMicrotask(() => syncNodeTitle(node));
  },

  setup() {
    let lastLanguage = currentLanguage();
    setInterval(() => {
      const nextLanguage = currentLanguage();
      if (nextLanguage === lastLanguage) return;
      lastLanguage = nextLanguage;
      syncAllNodeTitles();
    }, 500);
  },
});
