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
  widget.__terryNoSeqOriginalComputeSize =
    typeof widget.computeSize === "function"
      ? widget.computeSize.bind(widget)
      : null;
  widget.computeSize = function (width) {
    if (this.hidden) return [0, -4];
    return this.__terryNoSeqOriginalComputeSize?.(width) || [width ?? 0, 20];
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

function getGraphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  return (
    graph.links?.[linkId] ||
    graph._links?.get?.(linkId) ||
    graph.links?.[String(linkId)] ||
    null
  );
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

function widgetY(widget) {
  for (const value of [widget?.last_y, widget?.y, widget?.pos?.[1]]) {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 0) return y;
  }
  return null;
}

function visibleGroupBounds(node, names) {
  const entries = [];
  for (const name of names) {
    const widget = getWidget(node, name);
    if (!widget || widget.hidden || widget.options?.hidden) continue;
    const y = widgetY(widget);
    if (y == null) continue;
    let h = 24;
    try {
      const size = widget.computeSize?.(Math.max(0, (node.size?.[0] || 0) - 24));
      if (Array.isArray(size) && Number.isFinite(Number(size[1])) && Number(size[1]) > 0) {
        h = Number(size[1]);
      }
    } catch {}
    entries.push({ y, h });
  }
  if (!entries.length) return null;
  const top = Math.min(...entries.map((item) => item.y)) - 7;
  const bottom = Math.max(...entries.map((item) => item.y + item.h)) + 7;
  return { top, bottom };
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawGroupBox(node, ctx, names) {
  const bounds = visibleGroupBounds(node, names);
  if (!bounds || !ctx) return;
  const width = Number(node.size?.[0]) || 0;
  if (width <= 40) return;
  const x = 10;
  const w = width - 20;
  const h = bounds.bottom - bounds.top;
  if (h <= 0) return;

  ctx.save();
  roundedRectPath(ctx, x, bounds.top, w, h, 10);
  ctx.strokeStyle = "rgba(180, 180, 180, 0.24)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawParameterGroups(node, ctx) {
  const type = connectedType(node);
  if (type) drawGroupBox(node, ctx, TYPE_WIDGETS[type]);
  drawGroupBox(node, ctx, FILE_WIDGETS);
}

function applyDynamicPanel(node) {
  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);

  const type = connectedType(node);
  if (type) {
    for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);
  }

  if (type === "AUDIO") {
    setWidgetHidden(
      node,
      "audio_quality",
      getWidget(node, "audio_format")?.value === "flac"
    );
  }

  if (type === "VIDEO") {
    const codec = getWidget(node, "video_codec")?.value;
    const encoding = getWidget(node, "video_encoding")?.value;
    setWidgetHidden(node, "video_encoding", codec !== "h264");
    setWidgetHidden(
      node,
      "video_crf",
      !(codec === "h264" && encoding === "re-encode")
    );
  }

  if (type === "STRING") {
    setWidgetHidden(
      node,
      "text_custom_extension",
      getWidget(node, "text_extension")?.value !== "custom"
    );
  }

  resizeToContent(node);
}

function hookWidget(node, name) {
  const widget = getWidget(node, name);
  if (!widget || widget.__terryNoSeqDynamicPanelHooked) return;

  widget.__terryNoSeqDynamicPanelHooked = true;
  const original = widget.callback;
  widget.callback = function (...args) {
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
    "audio_format",
    "video_codec",
    "video_encoding",
    "text_extension",
  ]) {
    hookWidget(node, name);
  }

  applyDynamicPanel(node);
  schedulePanelRefresh(node);
}

app.registerExtension({
  name: "TerryTools.FileSaveNoSequence.DynamicPanel",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      initNode(this);
      return result;
    };

    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = connections?.apply(this, arguments);
      schedulePanelRefresh(this);
      return result;
    };

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configure?.apply(this, arguments);
      queueMicrotask(() => initNode(this));
      return result;
    };

    const drawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const result = drawForeground?.apply(this, arguments);
      drawParameterGroups(this, ctx);
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
