import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};
const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();
const FILE_WIDGETS = ["filename_template", "date_format", "append_sequence", "sequence_start", "sequence_padding"];

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return String(navigator.language || "en").toLowerCase().startsWith("zh");
  }
}

function t(zh, en) {
  return localeIsZh() ? zh : en;
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) || null;
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryHideAdapter) return;
  widget.__terryHideAdapter = true;
  widget.__terryOriginalComputeSize = typeof widget.computeSize === "function"
    ? widget.computeSize.bind(widget)
    : null;
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return this.__terryOriginalComputeSize?.(width) || [width ?? 0, 20];
  };
}

function setWidgetHidden(node, name, hidden) {
  const widget = getWidget(node, name);
  if (!widget) return;
  installHideAdapter(widget);
  widget.hidden = hidden;
  widget.options ||= {};
  widget.options.hidden = hidden;
  if (widget.element?.style) widget.element.style.display = hidden ? "none" : "";
}

function moveWidgetBefore(node, widget, anchorNames) {
  const widgets = node.widgets;
  if (!Array.isArray(widgets) || !widget) return;
  const current = widgets.indexOf(widget);
  if (current >= 0) widgets.splice(current, 1);
  let anchor = -1;
  for (const name of anchorNames) {
    anchor = widgets.findIndex((item) => item?.name === name);
    if (anchor >= 0) break;
  }
  if (anchor < 0) widgets.push(widget);
  else widgets.splice(anchor, 0, widget);
}

function getGraphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  return graph.links?.[linkId]
    || graph._links?.get?.(linkId)
    || graph.links?.[String(linkId)]
    || null;
}

function normalizeType(type) {
  const value = String(type || "").toUpperCase();
  return value === "TEXT" ? "STRING" : value;
}

function nodeType(node) {
  return String(
    node?.type ||
    node?.constructor?.type ||
    node?.comfyClass ||
    node?.constructor?.comfyClass ||
    ""
  ).toLowerCase();
}

function resolveOriginType(graph, linkId, seen = new Set()) {
  if (linkId == null || seen.has(linkId)) return null;
  seen.add(linkId);
  const link = getGraphLink(graph, linkId);
  if (!link) return null;
  const origin = graph?.getNodeById?.(link.origin_id);
  const output = origin?.outputs?.[link.origin_slot];
  let type = normalizeType(link.type || output?.type);
  if (TYPE_WIDGETS[type]) return type;
  const typeName = nodeType(origin);
  if (origin && (typeName === "reroute" || typeName.endsWith("reroute"))) {
    const upstream = resolveOriginType(graph, origin.inputs?.[0]?.link, seen);
    if (upstream) return upstream;
  }
  type = normalizeType(output?.type);
  return TYPE_WIDGETS[type] ? type : null;
}

function connectedType(node) {
  const input = node.inputs?.find((item) => item?.name === "data");
  if (!input || input.link == null) return null;
  return resolveOriginType(node.graph || app.graph, input.link);
}

function resizeToContent(node) {
  try {
    const measured = node.computeSize?.();
    if (measured) {
      node.setSize?.([
        Math.max(node.size?.[0] || 0, measured[0] || 0),
        measured[1],
      ]);
    }
  } catch {}
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

function makeSection(node, key) {
  node.__terrySaveSections ||= {};
  if (node.__terrySaveSections[key] || typeof node.addDOMWidget !== "function") {
    return node.__terrySaveSections[key];
  }

  const element = document.createElement("div");
  element.style.boxSizing = "border-box";
  element.style.width = "100%";
  element.style.pointerEvents = "none";

  if (key === "divider") {
    element.style.height = "32px";
    element.style.margin = "0 10px";
    element.style.borderTop = "1px solid color-mix(in srgb, var(--fg-color, #aaa) 24%, transparent)";
    element.style.transform = "translateY(16px)";
  } else {
    element.style.height = "30px";
    element.style.padding = "8px 10px 3px";
    element.style.fontSize = "12px";
    element.style.fontWeight = "700";
    element.style.letterSpacing = ".02em";
    element.style.color = "color-mix(in srgb, var(--fg-color, #ddd) 82%, transparent)";
  }

  const widget = node.addDOMWidget(`terry_save_${key}`, "div", element, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return [width ?? 0, key === "divider" ? 36 : 32];
  };

  return node.__terrySaveSections[key] = { element, widget };
}

function updateSections(node, type) {
  const media = makeSection(node, "media");
  const divider = makeSection(node, "divider");
  const file = makeSection(node, "file");
  const labels = {
    IMAGE: t("图片参数", "Image Parameters"),
    AUDIO: t("音频参数", "Audio Parameters"),
    VIDEO: t("视频参数", "Video Parameters"),
    STRING: t("文本参数", "Text Parameters"),
  };

  media.element.textContent = labels[type] || "";
  file.element.textContent = t("文件名", "Filename");
  media.widget.hidden = !type;
  media.widget.options ||= {};
  media.widget.options.hidden = !type;
  media.element.style.display = type ? "block" : "none";

  if (type) moveWidgetBefore(node, media.widget, TYPE_WIDGETS[type]);
  moveWidgetBefore(node, divider.widget, FILE_WIDGETS);
  moveWidgetBefore(node, file.widget, FILE_WIDGETS);

  const widgets = node.widgets || [];
  const dividerIndex = widgets.indexOf(divider.widget);
  const fileIndex = widgets.indexOf(file.widget);
  if (dividerIndex > fileIndex && fileIndex >= 0) {
    widgets.splice(dividerIndex, 1);
    widgets.splice(fileIndex, 0, divider.widget);
  }
}

function applyDynamicPanel(node) {
  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);

  const type = connectedType(node);
  if (type) {
    for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);
  }

  const useSequence = getWidget(node, "append_sequence")?.value === true;
  setWidgetHidden(node, "sequence_start", !useSequence);
  setWidgetHidden(node, "sequence_padding", !useSequence);

  if (type === "AUDIO") {
    setWidgetHidden(node, "audio_quality", getWidget(node, "audio_format")?.value === "flac");
  }

  if (type === "VIDEO") {
    const codec = getWidget(node, "video_codec")?.value;
    const encoding = getWidget(node, "video_encoding")?.value;
    setWidgetHidden(node, "video_encoding", codec !== "h264");
    setWidgetHidden(node, "video_crf", !(codec === "h264" && encoding === "re-encode"));
  }

  if (type === "STRING") {
    setWidgetHidden(node, "text_custom_extension", getWidget(node, "text_extension")?.value !== "custom");
  }

  updateSections(node, type);
  resizeToContent(node);
}

function hookWidget(node, name) {
  const widget = getWidget(node, name);
  if (!widget || widget.__terryDynamicPanelHooked) return;
  widget.__terryDynamicPanelHooked = true;
  const original = widget.callback;
  widget.callback = function(...args) {
    const result = original?.apply(this, args);
    queueMicrotask(() => applyDynamicPanel(node));
    return result;
  };
}

function schedulePanelRefresh(node) {
  queueMicrotask(() => applyDynamicPanel(node));
  requestAnimationFrame(() => applyDynamicPanel(node));
  setTimeout(() => applyDynamicPanel(node), 50);
  setTimeout(() => applyDynamicPanel(node), 180);
}

function initNode(node) {
  for (const widget of node.widgets || []) installHideAdapter(widget);
  for (const name of [
    "append_sequence",
    "audio_format",
    "video_codec",
    "video_encoding",
    "text_extension",
  ]) {
    hookWidget(node, name);
  }
  makeSection(node, "media");
  makeSection(node, "divider");
  makeSection(node, "file");
  applyDynamicPanel(node);
  schedulePanelRefresh(node);
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DynamicPanel",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments);
      initNode(this);
      return result;
    };

    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const result = connections?.apply(this, arguments);
      schedulePanelRefresh(this);
      return result;
    };

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configure?.apply(this, arguments);
      queueMicrotask(() => initNode(this));
      return result;
    };
  },
  nodeCreated(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) {
      queueMicrotask(() => initNode(node));
    }
  },
  loadedGraphNode(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) {
      queueMicrotask(() => initNode(node));
    }
  },
});
