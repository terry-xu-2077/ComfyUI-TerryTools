import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
const VALUES_PROP = "terry_enhanced_file_save_values";
const DEFAULT_DATE_FORMAT = "YYYYMMDDHHmmss";
const DATE_FORMAT_VALUES = new Set([
  "none",
  "YYYYMMDD_HHmmss",
  "YYYY-MM-DD_HH-mm-ss",
  "YYYY_MM_DD_HH_mm_ss",
  "YYYYMMDDHHmmss",
  "YYYYMMDD_HHmm",
  "YYYY-MM-DD_HH-mm",
  "YYYY_MM_DD_HH_mm",
  "YYYYMMDDHHmm",
  "YYYYMMDD_HH",
  "YYYY-MM-DD_HH",
  "YYYY_MM_DD_HH",
  "YYYYMMDDHH",
  "YYYYMMDD",
  "YYYY-MM-DD",
  "YYYY_MM_DD",
  "YYYYMM",
]);

const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};
const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();
const FILE_WIDGETS = [
  "filename_template",
  "date_format",
  "append_sequence",
  "sequence_start",
  "sequence_padding",
];
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
  const invalidDate = !!date && !DATE_FORMAT_VALUES.has(rawDate);

  if (invalidDate) {
    const currentFilename = String(filename?.value ?? "").trim();
    const filenameLooksInvalid =
      !currentFilename || ["auto", "h264", "re-encode"].includes(currentFilename);
    const misplacedLooksLikeFilename =
      rawDate.includes("%date%") || rawDate.includes("/") || rawDate.includes("\\");
    if (filename && filenameLooksInvalid && misplacedLooksLikeFilename) {
      setWidgetValue(node, "filename_template", rawDate);
    }
    setWidgetValue(node, "date_format", DEFAULT_DATE_FORMAT);
  }

  const filenameValue = String(
    getWidget(node, "filename_template")?.value ?? ""
  ).trim();
  if (!filenameValue || ["auto", "h264", "re-encode"].includes(filenameValue)) {
    setWidgetValue(node, "filename_template", "ComfyUI_%date%");
  }

  const videoFormat = getWidget(node, "video_format");
  if (videoFormat && !String(videoFormat.value ?? "").trim()) {
    setWidgetValue(node, "video_format", "auto");
  }

  const videoCodec = getWidget(node, "video_codec");
  if (videoCodec && !["auto", "h264"].includes(String(videoCodec.value ?? ""))) {
    setWidgetValue(node, "video_codec", "auto");
  }

  const videoEncoding = getWidget(node, "video_encoding");
  if (
    videoEncoding &&
    !["auto", "re-encode"].includes(String(videoEncoding.value ?? ""))
  ) {
    setWidgetValue(node, "video_encoding", "auto");
  }

  const append = getWidget(node, "append_sequence");
  if (append && typeof append.value !== "boolean") {
    setWidgetValue(node, "append_sequence", false);
  }

  const start = getWidget(node, "sequence_start");
  if (start && !Number.isFinite(Number(start.value))) {
    setWidgetValue(node, "sequence_start", 1);
  }

  const padding = getWidget(node, "sequence_padding");
  if (
    padding &&
    (!Number.isFinite(Number(padding.value)) || Number(padding.value) < 1)
  ) {
    setWidgetValue(node, "sequence_padding", 5);
  }
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryHideAdapter) return;
  widget.__terryHideAdapter = true;
  widget.__terryOriginalComputeSize =
    typeof widget.computeSize === "function"
      ? widget.computeSize.bind(widget)
      : null;
  widget.computeSize = function (width) {
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
      const size = widget.computeSize?.(
        Math.max(0, (node.size?.[0] || 0) - 24)
      );
      if (
        Array.isArray(size) &&
        Number.isFinite(Number(size[1])) &&
        Number(size[1]) > 0
      ) {
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
  repairCorruptedValues(node);

  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);

  const type = connectedType(node);
  if (type) {
    for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);
  }

  const useSequence = getWidget(node, "append_sequence")?.value === true;
  setWidgetHidden(node, "sequence_start", !useSequence);
  setWidgetHidden(node, "sequence_padding", !useSequence);

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
  if (!widget || widget.__terryDynamicPanelHooked) return;
  widget.__terryDynamicPanelHooked = true;
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
    "append_sequence",
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
  name: "TerryTools.EnhancedFileSave.DynamicPanel",
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
    nodeType.prototype.onConfigure = function (info) {
      const named = info?.properties?.[VALUES_PROP];
      const result = configure?.apply(this, arguments);
      queueMicrotask(() => {
        if (!restoreNamedValues(this, named)) repairCorruptedValues(this);
        initNode(this);
      });
      return result;
    };

    const serialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (info) {
      repairCorruptedValues(this);
      const result = serialize?.apply(this, arguments);
      if (info) {
        info.properties ||= {};
        info.properties[VALUES_PROP] = namedValues(this);
      }
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
