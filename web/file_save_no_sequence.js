import { app } from "../../scripts/app.js";

const NODE_ID = "TerryFileSaveNoSequence";

const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};
const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();
const FILE_WIDGETS = ["filename"];

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) || null;
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryNoSeqHideAdapter) return;
  widget.__terryNoSeqHideAdapter = true;
  const original = typeof widget.computeSize === "function"
    ? widget.computeSize.bind(widget)
    : null;
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
  if (node.__terryNoSeqDivider || typeof node.addDOMWidget !== "function") {
    return node.__terryNoSeqDivider;
  }

  const element = document.createElement("div");
  Object.assign(element.style, {
    boxSizing: "border-box",
    width: "100%",
    height: "28px",
    position: "relative",
    pointerEvents: "none",
    overflow: "visible",
  });

  const line = document.createElement("div");
  Object.assign(line.style, {
    position: "absolute",
    top: "13px",
    left: "calc(-100% + 12px)",
    width: "calc(200% - 24px)",
    height: "1px",
    background: "rgba(180,180,180,.28)",
    pointerEvents: "none",
  });
  element.appendChild(line);

  const widget = node.addDOMWidget("terry_no_seq_divider", "div", element, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.serialize = false;
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return [width ?? 0, 28];
  };

  node.__terryNoSeqDivider = { element, line, widget };
  return node.__terryNoSeqDivider;
}

function dividerY(node) {
  const widget = node.__terryNoSeqDivider?.widget;
  if (!widget || widget.hidden) return null;
  for (const value of [widget.last_y, widget.y, widget.pos?.[1]]) {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 0) return y + 14;
  }
  return null;
}

function drawClassicDivider(node, ctx) {
  const y = dividerY(node);
  if (y == null || !ctx) return;
  const width = Number(node.size?.[0]) || 0;
  if (width <= 40) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(12, y + 0.5);
  ctx.lineTo(width - 12, y + 0.5);
  ctx.strokeStyle = "rgba(180,180,180,.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
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
  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);

  const type = connectedType(node);
  if (type) for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);

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
  if (!widget || widget.__terryNoSeqDynamicPanelHooked) return;
  widget.__terryNoSeqDynamicPanelHooked = true;
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
  for (const name of ["audio_format", "video_codec", "video_encoding", "text_extension"]) hookWidget(node, name);
  makeDivider(node);
  applyDynamicPanel(node);
  schedulePanelRefresh(node);
}

app.registerExtension({
  name: "TerryTools.FileSaveNoSequence.DynamicPanel",
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
    const drawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function(ctx) {
      const result = drawForeground?.apply(this, arguments);
      drawClassicDivider(this, ctx);
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
