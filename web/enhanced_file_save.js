import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";

const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};

const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();
const TIMESTAMP_WIDGETS = [
  ["ts_year", "年份"],
  ["ts_date", "日期"],
  ["ts_hour", "时"],
  ["ts_minute_second", "分秒"],
];

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryHideAdapter) return;
  widget.__terryHideAdapter = true;

  widget.__terryOriginalComputeSize =
    typeof widget.computeSize === "function"
      ? widget.computeSize.bind(widget)
      : null;

  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    if (this.__terryOriginalComputeSize) {
      return this.__terryOriginalComputeSize(width);
    }
    return [width ?? 0, 20];
  };
}

function setWidgetHidden(node, name, hidden) {
  const w = getWidget(node, name);
  if (!w) return;

  installHideAdapter(w);
  w.hidden = hidden;

  if (w.options) w.options.hidden = hidden;
  if (w.element?.style) w.element.style.display = hidden ? "none" : "";
}

function moveWidgetAfter(node, widget, anchorName) {
  const widgets = node.widgets;
  if (!Array.isArray(widgets) || !widget) return;

  const current = widgets.indexOf(widget);
  const anchor = widgets.findIndex((w) => w?.name === anchorName);
  if (current < 0 || anchor < 0) return;

  widgets.splice(current, 1);
  const newAnchor = widgets.findIndex((w) => w?.name === anchorName);
  widgets.splice(newAnchor + 1, 0, widget);
}

function moveWidgetBefore(node, widget, anchorNames) {
  const widgets = node.widgets;
  if (!Array.isArray(widgets) || !widget) return;

  const current = widgets.indexOf(widget);
  if (current < 0) return;

  widgets.splice(current, 1);
  let anchor = -1;
  for (const name of anchorNames) {
    anchor = widgets.findIndex((w) => w?.name === name);
    if (anchor >= 0) break;
  }
  if (anchor < 0) widgets.push(widget);
  else widgets.splice(anchor, 0, widget);
}

function getGraphLink(graph, linkId) {
  if (!graph || linkId == null) return null;

  const legacy = graph.links?.[linkId];
  if (legacy) return legacy;

  const modern = graph._links?.get?.(linkId);
  if (modern) return modern;

  return graph.links?.[String(linkId)] || null;
}

function getGraphNode(graph, nodeId) {
  return graph?.getNodeById?.(nodeId) || null;
}

function isReroute(node) {
  const type = String(
    node?.type ||
    node?.constructor?.type ||
    node?.comfyClass ||
    node?.constructor?.comfyClass ||
    ""
  ).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}

function normalizeType(type) {
  let value = String(type || "").toUpperCase();
  if (value === "TEXT") value = "STRING";
  return value;
}

function resolveOriginType(graph, linkId, seen = new Set()) {
  if (linkId == null || seen.has(linkId)) return null;
  seen.add(linkId);

  const link = getGraphLink(graph, linkId);
  if (!link) return null;

  const origin = getGraphNode(graph, link.origin_id);
  const output = origin?.outputs?.[link.origin_slot];

  let type = normalizeType(link.type || output?.type);
  if (type && type !== "*" && TYPE_WIDGETS[type]) return type;

  if (origin && isReroute(origin)) {
    const upstreamLink = origin.inputs?.[0]?.link;
    const upstreamType = resolveOriginType(graph, upstreamLink, seen);
    if (upstreamType) return upstreamType;
  }

  type = normalizeType(output?.type);
  return TYPE_WIDGETS[type] ? type : null;
}

function getConnectedType(node) {
  const input = node.inputs?.find((i) => i.name === "data");
  if (!input || input.link == null) return null;

  const graph = node.graph || app.graph;
  return resolveOriginType(graph, input.link);
}

function resizeToContent(node) {
  try {
    const measured = node.computeSize?.();
    if (measured) {
      const width = Math.max(node.size?.[0] ?? 0, measured[0] ?? 0);
      node.setSize?.([width, measured[1]]);
    }
  } catch (_) {}

  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

function syncTimestampRow(node) {
  const row = node.__terryTimestampRow;
  if (!row) return;

  const enabled = getWidget(node, "use_timestamp")?.value === true;
  row.widget.hidden = !enabled;
  if (row.widget.options) row.widget.options.hidden = !enabled;
  row.element.style.display = enabled ? "flex" : "none";

  for (const [name] of TIMESTAMP_WIDGETS) {
    const checkbox = row.inputs[name];
    const widget = getWidget(node, name);
    if (checkbox && widget) checkbox.checked = widget.value === true;
  }
}

function createTimestampRow(node) {
  if (node.__terryTimestampRow || typeof node.addDOMWidget !== "function") return;

  const element = document.createElement("div");
  element.style.display = "flex";
  element.style.alignItems = "center";
  element.style.gap = "14px";
  element.style.padding = "2px 10px 2px 8px";
  element.style.height = "30px";
  element.style.boxSizing = "border-box";
  element.style.fontSize = "13px";
  element.style.color = "var(--fg-color, #ddd)";
  element.style.whiteSpace = "nowrap";
  element.style.userSelect = "none";

  const title = document.createElement("span");
  title.textContent = "时间戳：";
  title.style.opacity = "0.8";
  element.appendChild(title);

  const inputs = {};
  for (const [name, labelText] of TIMESTAMP_WIDGETS) {
    const label = document.createElement("label");
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    label.style.gap = "5px";
    label.style.cursor = "pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.margin = "0";
    checkbox.style.width = "14px";
    checkbox.style.height = "14px";
    checkbox.checked = getWidget(node, name)?.value === true;

    checkbox.addEventListener("change", () => {
      const widget = getWidget(node, name);
      if (!widget) return;
      widget.value = checkbox.checked;
      widget.callback?.(widget.value);
      node.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    });

    const text = document.createElement("span");
    text.textContent = labelText;

    label.appendChild(checkbox);
    label.appendChild(text);
    element.appendChild(label);
    inputs[name] = checkbox;
  }

  const widget = node.addDOMWidget("terry_timestamp_parts", "div", element, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return [width ?? 0, 34];
  };

  node.__terryTimestampRow = { element, widget, inputs };

  // Nodes 2.0 appends DOM widgets to the end. Put this row back into the
  // semantic position directly below the timestamp enable switch.
  moveWidgetAfter(node, widget, "use_timestamp");
  syncTimestampRow(node);
}

function createMediaSeparator(node) {
  if (node.__terryMediaSeparator || typeof node.addDOMWidget !== "function") return;

  const element = document.createElement("div");
  element.style.height = "12px";
  element.style.boxSizing = "border-box";
  element.style.margin = "0 8px";
  element.style.borderTop = "1px solid color-mix(in srgb, var(--fg-color, #aaa) 25%, transparent)";
  element.style.pointerEvents = "none";

  const widget = node.addDOMWidget("terry_media_separator", "div", element, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return [width ?? 0, 14];
  };

  node.__terryMediaSeparator = { element, widget };
  moveWidgetBefore(node, widget, ALL_TYPE_WIDGETS);
}

function syncMediaSeparator(node, type) {
  const separator = node.__terryMediaSeparator;
  if (!separator) return;

  const visible = !!type;
  separator.widget.hidden = !visible;
  if (separator.widget.options) separator.widget.options.hidden = !visible;
  separator.element.style.display = visible ? "block" : "none";
}

function applyDynamicPanel(node) {
  for (const name of ALL_TYPE_WIDGETS) {
    setWidgetHidden(node, name, true);
  }

  const type = getConnectedType(node);
  if (type) {
    for (const name of TYPE_WIDGETS[type]) {
      setWidgetHidden(node, name, false);
    }
  }

  // Keep backend booleans serialized but replace their four rows with one
  // compact row immediately below the timestamp enable switch.
  for (const [name] of TIMESTAMP_WIDGETS) {
    setWidgetHidden(node, name, true);
  }
  createTimestampRow(node);
  moveWidgetAfter(node, node.__terryTimestampRow?.widget, "use_timestamp");
  syncTimestampRow(node);

  const useSequence = getWidget(node, "append_sequence")?.value === true;
  setWidgetHidden(node, "sequence_start", !useSequence);
  setWidgetHidden(node, "sequence_padding", !useSequence);

  createMediaSeparator(node);
  moveWidgetBefore(node, node.__terryMediaSeparator?.widget, ALL_TYPE_WIDGETS);
  syncMediaSeparator(node, type);

  if (type === "AUDIO") {
    const format = getWidget(node, "audio_format")?.value;
    setWidgetHidden(node, "audio_quality", format === "flac");
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
    const extension = getWidget(node, "text_extension")?.value;
    setWidgetHidden(node, "text_custom_extension", extension !== "custom");
  }

  resizeToContent(node);
}

function hookWidget(node, name) {
  const w = getWidget(node, name);
  if (!w || w.__terryDynamicPanelHooked) return;
  w.__terryDynamicPanelHooked = true;

  const original = w.callback;
  w.callback = function(...args) {
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
  if (!node) return;

  for (const w of node.widgets ?? []) installHideAdapter(w);

  for (const name of [
    "use_timestamp",
    "append_sequence",
    "audio_format",
    "video_codec",
    "video_encoding",
    "text_extension",
  ]) {
    hookWidget(node, name);
  }

  createTimestampRow(node);
  createMediaSeparator(node);
  applyDynamicPanel(node);
  schedulePanelRefresh(node);
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DynamicPanel",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = originalCreated?.apply(this, arguments);
      initNode(this);
      return result;
    };

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const result = originalConnections?.apply(this, arguments);
      schedulePanelRefresh(this);
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = originalConfigure?.apply(this, arguments);
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
