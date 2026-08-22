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
const MEDIA_LABELS = [
  "PNG 压缩等级", "PNG Compression Level",
  "音频格式", "Audio Format", "音频质量", "Audio Quality",
  "视频容器", "Video Container", "视频编码", "Video Codec",
  "H.264 编码模式", "H.264 Encoding Mode", "H.264 CRF",
  "文本后缀", "Text Extension", "自定义文本后缀", "Custom Text Extension",
];
const FILE_LABELS = ["文件名", "Filename"];

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) || null;
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryNoSeqHideAdapter) return;
  widget.__terryNoSeqHideAdapter = true;
  widget.__terryNoSeqOriginalComputeSize = typeof widget.computeSize === "function" ? widget.computeSize.bind(widget) : null;
  widget.computeSize = function(width) {
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

function widgetY(widget) {
  for (const value of [widget?.last_y, widget?.y, widget?.pos?.[1]]) {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 0) return y;
  }
  return null;
}

function rawBounds(node, names) {
  const entries = [];
  for (const name of names) {
    const widget = getWidget(node, name);
    if (!widget || widget.hidden || widget.options?.hidden) continue;
    const y = widgetY(widget);
    if (y == null) continue;
    let h = 24;
    try {
      const size = widget.computeSize?.(Math.max(0, (node.size?.[0] || 0) - 24));
      if (Array.isArray(size) && Number(size[1]) > 0) h = Number(size[1]);
    } catch {}
    entries.push({ y, h });
  }
  if (!entries.length) return null;
  return {
    top: Math.min(...entries.map((e) => e.y)),
    bottom: Math.max(...entries.map((e) => e.y + e.h)),
  };
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

function drawBox(node, ctx, bounds) {
  if (!bounds || !ctx) return;
  const width = Number(node.size?.[0]) || 0;
  if (width <= 40) return;
  const top = bounds.top;
  const bottom = bounds.bottom;
  if (bottom <= top) return;
  ctx.save();
  roundedRectPath(ctx, 10, top, width - 20, bottom - top, 10);
  ctx.strokeStyle = "rgba(180,180,180,.24)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawParameterGroups(node, ctx) {
  const type = connectedType(node);
  const mediaRaw = type ? rawBounds(node, TYPE_WIDGETS[type]) : null;
  const fileRaw = rawBounds(node, FILE_WIDGETS);
  let media = mediaRaw ? { top: mediaRaw.top - 5, bottom: mediaRaw.bottom + 5 } : null;
  let file = fileRaw ? { top: fileRaw.top - 5, bottom: fileRaw.bottom + 5 } : null;
  if (mediaRaw && fileRaw) {
    const split = (mediaRaw.bottom + fileRaw.top) / 2;
    media.bottom = Math.min(media.bottom, split - 3);
    file.top = Math.max(file.top, split + 3);
  }
  drawBox(node, ctx, media);
  drawBox(node, ctx, file);
}

function normalizedText(el) {
  return String(el?.textContent || "").replace(/\s+/g, " ").trim();
}

function isTargetRoot(root) {
  const text = normalizedText(root);
  return text.includes("Terry 文件保存（无序号）") || text.includes("Terry File Save (No Sequence)");
}

function findNodeRoots() {
  const roots = new Set();
  for (const el of document.querySelectorAll("[data-node-id]")) {
    if (isTargetRoot(el)) roots.add(el);
  }
  if (roots.size) return [...roots];
  for (const el of document.querySelectorAll("div")) {
    if (!isTargetRoot(el)) continue;
    let p = el;
    while (p?.parentElement && isTargetRoot(p.parentElement)) p = p.parentElement;
    if (p && p !== document.body) roots.add(p);
  }
  return [...roots];
}

function labelRow(root, label) {
  const rootRect = root.getBoundingClientRect();
  for (const el of root.querySelectorAll("*")) {
    if (normalizedText(el) !== label) continue;
    let row = el;
    for (let i = 0; i < 6 && row?.parentElement && row.parentElement !== root; i++) {
      const pr = row.parentElement.getBoundingClientRect();
      if (pr.width >= rootRect.width * 0.65 && pr.height >= 20 && pr.height <= 80) row = row.parentElement;
      else break;
    }
    return row;
  }
  return null;
}

function domBounds(root, labels) {
  const rootRect = root.getBoundingClientRect();
  const rects = [];
  const seen = new Set();
  for (const label of labels) {
    const row = labelRow(root, label);
    if (!row || seen.has(row)) continue;
    seen.add(row);
    const r = row.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push(r);
  }
  if (!rects.length) return null;
  return {
    top: Math.min(...rects.map((r) => r.top)) - rootRect.top,
    bottom: Math.max(...rects.map((r) => r.bottom)) - rootRect.top,
  };
}

function ensureOverlay(root, key) {
  let el = root.querySelector(`:scope > .terry-group-box-${key}`);
  if (!el) {
    el = document.createElement("div");
    el.className = `terry-group-box-${key}`;
    Object.assign(el.style, {
      position: "absolute", left: "10px", right: "10px",
      border: "1px solid rgba(180,180,180,.24)", borderRadius: "10px",
      pointerEvents: "none", boxSizing: "border-box", zIndex: "2",
    });
    root.appendChild(el);
  }
  return el;
}

function updateNodes2Boxes() {
  for (const root of findNodeRoots()) {
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    const mediaRaw = domBounds(root, MEDIA_LABELS);
    const fileRaw = domBounds(root, FILE_LABELS);
    const mediaEl = ensureOverlay(root, "media");
    const fileEl = ensureOverlay(root, "file");
    let media = mediaRaw ? { top: mediaRaw.top - 5, bottom: mediaRaw.bottom + 5 } : null;
    let file = fileRaw ? { top: fileRaw.top - 5, bottom: fileRaw.bottom + 5 } : null;
    if (mediaRaw && fileRaw) {
      const split = (mediaRaw.bottom + fileRaw.top) / 2;
      media.bottom = Math.min(media.bottom, split - 3);
      file.top = Math.max(file.top, split + 3);
    }
    for (const [el, b] of [[mediaEl, media], [fileEl, file]]) {
      if (!b || b.bottom <= b.top) { el.style.display = "none"; continue; }
      el.style.display = "block";
      el.style.top = `${b.top}px`;
      el.style.height = `${b.bottom - b.top}px`;
    }
  }
}

let domQueued = false;
function queueNodes2Refresh() {
  if (domQueued) return;
  domQueued = true;
  requestAnimationFrame(() => { domQueued = false; updateNodes2Boxes(); });
}

function schedulePanelRefresh(node) {
  queueMicrotask(() => applyDynamicPanel(node));
  requestAnimationFrame(() => applyDynamicPanel(node));
  setTimeout(() => applyDynamicPanel(node), 50);
  setTimeout(() => applyDynamicPanel(node), 180);
  queueNodes2Refresh();
  setTimeout(queueNodes2Refresh, 80);
  setTimeout(queueNodes2Refresh, 250);
}

function applyDynamicPanel(node) {
  for (const name of ALL_TYPE_WIDGETS) setWidgetHidden(node, name, true);
  const type = connectedType(node);
  if (type) for (const name of TYPE_WIDGETS[type]) setWidgetHidden(node, name, false);
  if (type === "AUDIO") setWidgetHidden(node, "audio_quality", getWidget(node, "audio_format")?.value === "flac");
  if (type === "VIDEO") {
    const codec = getWidget(node, "video_codec")?.value;
    const encoding = getWidget(node, "video_encoding")?.value;
    setWidgetHidden(node, "video_encoding", codec !== "h264");
    setWidgetHidden(node, "video_crf", !(codec === "h264" && encoding === "re-encode"));
  }
  if (type === "STRING") setWidgetHidden(node, "text_custom_extension", getWidget(node, "text_extension")?.value !== "custom");
  resizeToContent(node);
  queueNodes2Refresh();
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

function initNode(node) {
  for (const widget of node.widgets || []) installHideAdapter(widget);
  for (const name of ["audio_format", "video_codec", "video_encoding", "text_extension"]) hookWidget(node, name);
  applyDynamicPanel(node);
  schedulePanelRefresh(node);
}

let observer = null;
function installObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver(queueNodes2Refresh);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

app.registerExtension({
  name: "TerryTools.FileSaveNoSequence.DynamicPanel",
  setup() { installObserver(); queueNodes2Refresh(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() { const r = created?.apply(this, arguments); initNode(this); return r; };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() { const r = connections?.apply(this, arguments); schedulePanelRefresh(this); return r; };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const r = configure?.apply(this, arguments); queueMicrotask(() => initNode(this)); return r; };
    const drawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function(ctx) { const r = drawForeground?.apply(this, arguments); drawParameterGroups(this, ctx); return r; };
  },
  nodeCreated(node) { if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) queueMicrotask(() => initNode(node)); },
  loadedGraphNode(node) { if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) queueMicrotask(() => initNode(node)); },
});
