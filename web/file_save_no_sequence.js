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
  return node.widgets?.find((w) => w?.name === name) || null;
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryNoSeqHideAdapter) return;
  widget.__terryNoSeqHideAdapter = true;
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

function classicBounds(node, names) {
  const ys = [];
  for (const name of names) {
    const widget = getWidget(node, name);
    if (!widget || widget.hidden || widget.options?.hidden) continue;
    const y = widgetY(widget);
    if (y != null) ys.push(y);
  }
  if (!ys.length) return null;
  const sorted = ys.sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let step = 28;
  if (sorted.length > 1) {
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]).filter((v) => v > 8 && v < 80);
    if (gaps.length) step = Math.min(...gaps);
  }
  const rowHeight = Math.min(28, Math.max(20, step - 6));
  const pad = 7;
  return { top: first - pad, bottom: last + rowHeight + pad };
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
  if (width <= 40 || bounds.bottom <= bounds.top) return;
  ctx.save();
  roundedRectPath(ctx, 10, bounds.top, width - 20, bounds.bottom - bounds.top, 10);
  ctx.strokeStyle = "rgba(180,180,180,.24)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawParameterGroups(node, ctx) {
  const type = connectedType(node);
  let media = type ? classicBounds(node, TYPE_WIDGETS[type]) : null;
  let file = classicBounds(node, FILE_WIDGETS);
  if (media && file && media.bottom > file.top - 6) {
    const middle = (media.bottom + file.top) / 2;
    media = { ...media, bottom: middle - 3 };
    file = { ...file, top: middle + 3 };
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
  const roots = [];
  for (const el of document.querySelectorAll("[data-node-id]")) {
    if (isTargetRoot(el)) roots.push(el);
  }
  return roots;
}

function labelRect(root, label) {
  const rootRect = root.getBoundingClientRect();
  let best = null;
  for (const el of root.querySelectorAll("*")) {
    if (normalizedText(el) !== label) continue;
    let row = el;
    for (let i = 0; i < 5 && row?.parentElement && row.parentElement !== root; i++) {
      const pr = row.parentElement.getBoundingClientRect();
      if (pr.width >= rootRect.width * 0.55 && pr.height >= 22 && pr.height <= 72) row = row.parentElement;
      else break;
    }
    const r = row.getBoundingClientRect();
    if (!best || r.width > best.width) best = r;
  }
  return best;
}

function screenBounds(root, labels) {
  const rects = [];
  for (const label of labels) {
    const r = labelRect(root, label);
    if (r && r.width > 0 && r.height > 0) rects.push(r);
  }
  if (!rects.length) return null;
  return {
    top: Math.min(...rects.map((r) => r.top)) - 6,
    bottom: Math.max(...rects.map((r) => r.bottom)) + 6,
  };
}

function ensureFixedOverlay(key) {
  const id = `terry-no-seq-fixed-${key}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    Object.assign(el.style, {
      position: "fixed",
      border: "1px solid rgba(180,180,180,.24)",
      borderRadius: "10px",
      pointerEvents: "none",
      boxSizing: "border-box",
      zIndex: "9999",
      display: "none",
    });
    document.body.appendChild(el);
  }
  return el;
}

function updateNodes2Boxes() {
  const roots = findNodeRoots();
  const mediaOverlays = [];
  const fileOverlays = [];
  roots.forEach((root, index) => {
    const rootRect = root.getBoundingClientRect();
    const mediaRaw = screenBounds(root, MEDIA_LABELS);
    const fileRaw = screenBounds(root, FILE_LABELS);
    let media = mediaRaw;
    let file = fileRaw;
    if (media && file && media.bottom > file.top - 6) {
      const middle = (media.bottom + file.top) / 2;
      media = { ...media, bottom: middle - 3 };
      file = { ...file, top: middle + 3 };
    }
    for (const [kind, bounds, bucket] of [["media", media, mediaOverlays], ["file", file, fileOverlays]]) {
      const el = ensureFixedOverlay(`${kind}-${index}`);
      bucket.push(el);
      if (!bounds || bounds.bottom <= bounds.top) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "block";
      el.style.left = `${rootRect.left + 10}px`;
      el.style.width = `${Math.max(0, rootRect.width - 20)}px`;
      el.style.top = `${bounds.top}px`;
      el.style.height = `${bounds.bottom - bounds.top}px`;
    }
  });
  for (const el of document.querySelectorAll('[id^="terry-no-seq-fixed-"]')) {
    if (![...mediaOverlays, ...fileOverlays].includes(el)) el.style.display = "none";
  }
}

let domQueued = false;
function queueNodes2Refresh() {
  if (domQueued) return;
  domQueued = true;
  requestAnimationFrame(() => {
    domQueued = false;
    updateNodes2Boxes();
  });
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

function schedulePanelRefresh(node) {
  queueMicrotask(() => applyDynamicPanel(node));
  requestAnimationFrame(() => applyDynamicPanel(node));
  setTimeout(() => applyDynamicPanel(node), 50);
  setTimeout(() => applyDynamicPanel(node), 180);
  setTimeout(queueNodes2Refresh, 300);
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
  window.addEventListener("resize", queueNodes2Refresh, { passive: true });
  window.addEventListener("scroll", queueNodes2Refresh, { passive: true, capture: true });
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
