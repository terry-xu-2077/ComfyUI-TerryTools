import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
const VALUES_PROP = "terry_enhanced_file_save_values";
const DEFAULT_DATE_FORMAT = "YYYYMMDDHHmmss";
const DATE_FORMAT_VALUES = new Set([
  "none","YYYYMMDD_HHmmss","YYYY-MM-DD_HH-mm-ss","YYYY_MM_DD_HH_mm_ss",
  "YYYYMMDDHHmmss","YYYYMMDD_HHmm","YYYY-MM-DD_HH-mm","YYYY_MM_DD_HH_mm",
  "YYYYMMDDHHmm","YYYYMMDD_HH","YYYY-MM-DD_HH","YYYY_MM_DD_HH","YYYYMMDDHH",
  "YYYYMMDD","YYYY-MM-DD","YYYY_MM_DD","YYYYMM",
]);

const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};
const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();
const FILE_WIDGETS = ["filename_template","date_format","append_sequence","sequence_start","sequence_padding"];
const VALUE_WIDGETS = [...ALL_TYPE_WIDGETS, ...FILE_WIDGETS];

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) || null;
}
function setWidgetValue(node, name, value) {
  const widget = getWidget(node, name);
  if (!widget) return;
  widget.value = value;
  if (widget._state) widget._state.value = value;
}
function namedValues(node) {
  const values = {};
  for (const name of VALUE_WIDGETS) {
    const widget = getWidget(node, name);
    if (widget) values[name] = widget.value;
  }
  return values;
}
function restoreNamedValues(node, values) {
  if (!values || typeof values !== "object") return false;
  let restored = false;
  for (const name of VALUE_WIDGETS) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    setWidgetValue(node, name, values[name]);
    restored = true;
  }
  return restored;
}
function repairCorruptedValues(node) {
  const filename = getWidget(node, "filename_template");
  const date = getWidget(node, "date_format");
  const rawDate = String(date?.value ?? "");
  if (date && !DATE_FORMAT_VALUES.has(rawDate)) {
    const currentFilename = String(filename?.value ?? "").trim();
    const filenameLooksInvalid = !currentFilename || ["auto","h264","re-encode"].includes(currentFilename);
    const misplacedLooksLikeFilename = rawDate.includes("%date%") || rawDate.includes("/") || rawDate.includes("\\");
    if (filename && filenameLooksInvalid && misplacedLooksLikeFilename) setWidgetValue(node, "filename_template", rawDate);
    setWidgetValue(node, "date_format", DEFAULT_DATE_FORMAT);
  }
  const filenameValue = String(getWidget(node, "filename_template")?.value ?? "").trim();
  if (!filenameValue || ["auto","h264","re-encode"].includes(filenameValue)) setWidgetValue(node, "filename_template", "ComfyUI_%date%");
  const videoFormat = getWidget(node, "video_format");
  if (videoFormat && !String(videoFormat.value ?? "").trim()) setWidgetValue(node, "video_format", "auto");
  const videoCodec = getWidget(node, "video_codec");
  if (videoCodec && !["auto","h264"].includes(String(videoCodec.value ?? ""))) setWidgetValue(node, "video_codec", "auto");
  const videoEncoding = getWidget(node, "video_encoding");
  if (videoEncoding && !["auto","re-encode"].includes(String(videoEncoding.value ?? ""))) setWidgetValue(node, "video_encoding", "auto");
  const append = getWidget(node, "append_sequence");
  if (append && typeof append.value !== "boolean") setWidgetValue(node, "append_sequence", false);
  const start = getWidget(node, "sequence_start");
  if (start && !Number.isFinite(Number(start.value))) setWidgetValue(node, "sequence_start", 1);
  const padding = getWidget(node, "sequence_padding");
  if (padding && (!Number.isFinite(Number(padding.value)) || Number(padding.value) < 1)) setWidgetValue(node, "sequence_padding", 5);
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryHideAdapter) return;
  widget.__terryHideAdapter = true;
  const original = typeof widget.computeSize === "function" ? widget.computeSize.bind(widget) : null;
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return original?.(width) || [width ?? 0, 20];
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

function makeDivider(node) {
  if (node.__terrySaveDivider || typeof node.addDOMWidget !== "function") return node.__terrySaveDivider;

  const element = document.createElement("div");
  Object.assign(element.style, {
    boxSizing: "border-box",
    width: "100%",
    height: "28px",
    position: "relative",
    pointerEvents: "none",
    overflow: "hidden",
  });

  const line = document.createElement("div");
  Object.assign(line.style, {
    position: "absolute",
    left: "12px",
    right: "12px",
    top: "13px",
    height: "1px",
    background: "rgba(180,180,180,.28)",
    pointerEvents: "none",
  });
  element.appendChild(line);

  const widget = node.addDOMWidget("terry_save_divider", "div", element, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.serialize = false;
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return [width ?? 0, 28];
  };

  node.__terrySaveDivider = { element, line, widget };
  return node.__terrySaveDivider;
}

function getGraphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  return graph.links?.[linkId] || graph._links?.get?.(linkId) || graph.links?.[String(linkId)] || null;
}
function normalizeType(type) {
  const value = String(type || "").toUpperCase();
  return value === "TEXT" ? "STRING" : value;
}
function nodeType(node) {
  return String(node?.type || node?.constructor?.type || node?.comfyClass || node?.constructor?.comfyClass || "").toLowerCase();
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
    if (measured) node.setSize?.([Math.max(node.size?.[0] || 0, measured[0] || 0), measured[1]]);
  } catch {}
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

function applyDynamicPanel(node) {
  repairCorruptedValues(node);
  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);
  const type = connectedType(node);
  if (type) for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);

  const useSequence = getWidget(node, "append_sequence")?.value === true;
  setWidgetHidden(node, "sequence_start", !useSequence);
  setWidgetHidden(node, "sequence_padding", !useSequence);

  if (type === "AUDIO") setWidgetHidden(node, "audio_quality", getWidget(node, "audio_format")?.value === "flac");
  if (type === "VIDEO") {
    const codec = getWidget(node, "video_codec")?.value;
    const encoding = getWidget(node, "video_encoding")?.value;
    setWidgetHidden(node, "video_encoding", codec !== "h264");
    setWidgetHidden(node, "video_crf", !(codec === "h264" && encoding === "re-encode"));
  }
  if (type === "STRING") setWidgetHidden(node, "text_custom_extension", getWidget(node, "text_extension")?.value !== "custom");

  const divider = makeDivider(node);
  if (divider) {
    divider.widget.hidden = !type;
    divider.widget.options ||= {};
    divider.widget.options.hidden = !type;
    divider.element.style.display = type ? "block" : "none";
    moveWidgetBefore(node, divider.widget, FILE_WIDGETS);
  }

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
  for (const name of ["append_sequence","audio_format","video_codec","video_encoding","text_extension"]) hookWidget(node, name);
  makeDivider(node);
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
    nodeType.prototype.onConfigure = function(info) {
      const named = info?.properties?.[VALUES_PROP];
      const result = configure?.apply(this, arguments);
      queueMicrotask(() => {
        if (!restoreNamedValues(this, named)) repairCorruptedValues(this);
        initNode(this);
      });
      return result;
    };
    const serialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function(info) {
      repairCorruptedValues(this);
      const result = serialize?.apply(this, arguments);
      if (info) {
        info.properties ||= {};
        info.properties[VALUES_PROP] = namedValues(this);
      }
      return result;
    };
  },
  nodeCreated(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) queueMicrotask(() => initNode(node));
  },
  loadedGraphNode(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) queueMicrotask(() => initNode(node));
  },
});
