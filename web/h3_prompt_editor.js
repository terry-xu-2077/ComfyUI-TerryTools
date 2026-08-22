import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { attachH3Menus } from "./h3_shared_menus.js";

const NODE_ID = "TerryH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const VIEW_PROP = "terry_h3_view_mode";
const VIEW_VISUAL = "visual";
const VIEW_RAW = "raw";
const MAX_MEDIA = 32;
const CARET = "\u200B";

const SECTIONS = new Set([
  "subject_definitions", "summary", "retention_analysis",
  "detailed_description", "overall_soundscape", "non_diegetic_music"
]);
const MARKERS = new Set([
  "fully_preserved", "partially_preserved", "attribute_transfer", "weak_reference",
  "fully_copy", "partially_copy", "reference"
]);

function isTarget(node) {
  if (!node) return false;
  return [node.comfyClass, node.type, node.constructor?.type, node.constructor?.comfyClass, node.constructor?.nodeData?.name]
    .some((x) => String(x || "") === NODE_ID);
}

function getWidget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function setWidgetOption(widget, key, value) {
  if (!widget) return;
  widget.options ||= {};
  widget.options[key] = value;
  if (widget._state?.options) widget._state.options[key] = value;
}

function hidePromptWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.type = "hidden";
  setWidgetOption(widget, "hidden", true);
  setWidgetOption(widget, "canvasOnly", true);
  widget.computeSize = () => [0, -4];
  if (widget.element?.style) widget.element.style.display = "none";
  if (widget.inputEl?.style) widget.inputEl.style.display = "none";
}

function ensureLinks(node) {
  node.properties ||= {};
  if (!Array.isArray(node.properties[LINKS_PROP])) node.properties[LINKS_PROP] = [];
  return node.properties[LINKS_PROP];
}

function graphLink(graph, id) {
  if (id == null) return null;
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    if (typeof bag.get === "function") {
      const hit = bag.get(id) ?? bag.get(String(id));
      if (hit) return hit;
    }
    const hit = bag[id] ?? bag[String(id)];
    if (hit) return hit;
  }
  return null;
}

function sourceType(node, slot = 0, fallback = "") {
  const raw = String(node?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("IMAGE")) return "picture";
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  const name = String(node?.comfyClass || node?.type || "").toLowerCase();
  if (name.includes("video")) return "video";
  if (name.includes("audio")) return "audio";
  return "picture";
}

function normalizeLinks(node) {
  const graph = node?.graph || app.graph;
  const seen = new Set();
  const out = [];
  for (const link of ensureLinks(node)) {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id) || id === Number(node.id)) continue;
    const src = graph?.getNodeById?.(id);
    if (!src) continue;
    const kind = sourceType(src, slot, link?.source_type);
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source_id: id, source_slot: slot, source_type: String(src.outputs?.[slot]?.type || link?.source_type || "*"), kind });
  }
  node.properties[LINKS_PROP] = out.slice(0, MAX_MEDIA);
  return node.properties[LINKS_PROP];
}

function addVirtualLink(node, source, sourceSlot = 0, sourceTypeValue = "") {
  if (!node || !source || Number(source.id) === Number(node.id)) return false;
  const links = normalizeLinks(node);
  if (links.length >= MAX_MEDIA) return false;
  if (links.some((x) => Number(x.source_id) === Number(source.id) && Number(x.source_slot) === Number(sourceSlot))) return false;
  links.push({
    source_id: Number(source.id),
    source_slot: Number(sourceSlot) || 0,
    source_type: String(sourceTypeValue || source.outputs?.[sourceSlot]?.type || "*"),
    kind: sourceType(source, sourceSlot, sourceTypeValue),
  });
  node.properties[LINKS_PROP] = links;
  watchSourceNode(source);
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
  refreshEditorsSoon();
  return true;
}

function getMediaInputIndex(node) {
  return node?.inputs?.findIndex((x) => String(x?.name || "") === "media") ?? -1;
}

function ensureSingleMediaInput(node) {
  if (!node) return;
  node.inputs ||= [];
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const name = String(node.inputs[i]?.name || "");
    if (/^asset\d*$/i.test(name) || /^assets$/i.test(name)) {
      try { if (node.inputs[i]?.link != null) node.disconnectInput?.(i); } catch {}
      if (typeof node.removeInput === "function") node.removeInput(i);
      else node.inputs.splice(i, 1);
    }
  }
  if (getMediaInputIndex(node) < 0) {
    if (typeof node.addInput === "function") node.addInput("media", "*");
    else node.inputs.unshift({ name: "media", type: "*", link: null });
  }
  const input = node.inputs[getMediaInputIndex(node)];
  if (input) {
    input.name = "media";
    input.type = "*";
    input.label = "参考 · 多路输入";
    input.localized_name = "参考 · 多路输入";
  }
  node._widgetSlotsDirty = true;
}

function convertNativeMediaConnection(node, inputIndex, info = null) {
  if (!isTarget(node) || node.__terryClearingLink) return false;
  const input = node.inputs?.[inputIndex];
  if (String(input?.name || "") !== "media") return false;
  const graph = node.graph || app.graph;
  const native = graphLink(graph, input?.link) || info;
  if (!native) return false;
  const sourceId = native.origin_id ?? native.originId ?? native.from_id ?? native.fromId;
  const src = native.origin_node || native.originNode || native.fromNode || graph?.getNodeById?.(Number(sourceId));
  if (!src) return false;
  const rawSlot = native.origin_slot ?? native.originSlot ?? native.from_slot ?? native.fromSlot ?? 0;
  const slot = Number(rawSlot) || 0;
  const added = addVirtualLink(node, src, slot, native.type || src.outputs?.[slot]?.type || "*");
  node.__terryClearingLink = true;
  try {
    if (node.inputs?.[inputIndex]?.link != null) node.disconnectInput?.(inputIndex);
  } finally {
    node.__terryClearingLink = false;
  }
  return added;
}

function connectionPos(node, input, slotIndex) {
  const modern = input ? node?.getInputPos?.(slotIndex) : node?.getOutputPos?.(slotIndex);
  if (Array.isArray(modern) && Number.isFinite(modern[0])) return modern;
  const out = [0, 0];
  try {
    const legacy = node?.getConnectionPos?.(input, slotIndex, out);
    if (Array.isArray(legacy)) return legacy;
  } catch {}
  return input
    ? [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20]
    : [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 200), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20];
}

function drawVirtualLinks(canvas, ctx) {
  if (!ctx) return;
  for (const target of canvas?.graph?._nodes || app.graph?._nodes || []) {
    if (!isTarget(target)) continue;
    const inputIndex = getMediaInputIndex(target);
    if (inputIndex < 0) continue;
    const end = connectionPos(target, true, inputIndex);
    for (const link of normalizeLinks(target)) {
      const src = app.graph?.getNodeById?.(Number(link.source_id));
      if (!src) continue;
      const start = connectionPos(src, false, Number(link.source_slot) || 0);
      const colorMap = globalThis.LGraphCanvas?.link_type_colors || {};
      const type = String(link.source_type || "");
      const color = colorMap[type] || colorMap[type.toUpperCase()] || globalThis.LiteGraph?.LINK_COLOR || "#9A9";
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = canvas?.connections_width || 3;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3CanvasPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3CanvasPatched = true;
  const old = canvas.drawConnections;
  canvas.drawConnections = function(ctx) {
    const r = old.apply(this, arguments);
    drawVirtualLinks(this, ctx || this.bgctx || this.ctx);
    return r;
  };
}

function patchGraphToPrompt() {
  if (app.__terryH3GraphToPromptPatched || typeof app.graphToPrompt !== "function") return;
  app.__terryH3GraphToPromptPatched = true;
  const old = app.graphToPrompt;
  app.graphToPrompt = async function() {
    const data = await old.apply(this, arguments);
    const output = data?.output || {};
    for (const node of app.graph?._nodes || []) {
      if (!isTarget(node)) continue;
      syncFromEditor(node, false);
      const dst = output[String(node.id)];
      if (!dst) continue;
      dst.inputs ||= {};
      delete dst.inputs.media;
      for (const key of Object.keys(dst.inputs)) if (/^asset\d+$/i.test(key)) delete dst.inputs[key];
      normalizeLinks(node).forEach((link, i) => {
        if (!output[String(link.source_id)]) return;
        dst.inputs[`asset${i + 1}`] = [String(link.source_id), Number(link.source_slot) || 0];
      });
    }
    return data;
  };
}

function filenameFromSource(node, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename"] : ["audio", "file", "filename"];
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const v = w?.value;
    const f = typeof v === "object" ? (v?.filename || v?.name) : v;
    if (!f || /^(data:|blob:|https?:)/i.test(String(f))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(f))) return String(f);
  }
  return "";
}

function previewFromSource(node, kind) {
  if (!node || kind === "audio") return "";
  const filename = filenameFromSource(node, kind);
  if (filename) {
    const w = (node.widgets || []).find((x) => {
      const v = x?.value;
      return String(typeof v === "object" ? (v?.filename || v?.name || "") : (v || "")) === filename;
    });
    const v = w?.value;
    const q = new URLSearchParams({ filename, type: typeof v === "object" ? String(v.type || "input") : "input" });
    if (typeof v === "object" && v.subfolder) q.set("subfolder", String(v.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const img = (node.imgs || []).find((x) => x?.src);
  if (img?.src) return img.src;
  for (const w of node.widgets || []) {
    const el = w?.element;
    const im = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (im?.src) return im.src;
    const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}

function mediaOptions(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return normalizeLinks(node).map((link) => {
    const kind = link.kind || "picture";
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const src = app.graph?.getNodeById?.(Number(link.source_id));
    const tag = kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`;
    const label = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    return { kind, index, tag, label, source: filenameFromSource(src, kind).split(/[\\/]/).pop() || src?.title || label, preview: previewFromSource(src, kind) };
  });
}

function watchSourceNode(node) {
  if (!node) return;
  for (const w of node.widgets || []) {
    if (w?.__terryH3Watch) continue;
    w.__terryH3Watch = true;
    const old = w.callback;
    w.callback = function() {
      const r = old?.apply(this, arguments);
      refreshEditorsSoon();
      return r;
    };
    const el = w.inputEl || w.element;
    el?.addEventListener?.("change", refreshEditorsSoon, true);
    el?.addEventListener?.("input", refreshEditorsSoon, true);
  }
}

let refreshTimer = null;
function refreshEditorsSoon() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    for (const node of app.graph?._nodes || []) if (isTarget(node)) refreshEditor(node);
  }, 0);
}

function makeChip(text, raw, className = "") {
  const el = document.createElement("span");
  el.className = `terry-h3-chip ${className}`;
  el.contentEditable = "false";
  el.dataset.raw = raw;
  el.textContent = text;
  return el;
}

function makeMediaChip(node, kind, index, raw) {
  const option = mediaOptions(node).find((x) => x.kind === kind && x.index === index);
  const el = makeChip("", raw, "terry-h3-media-chip");
  if (option?.preview && kind !== "audio") {
    const img = document.createElement("img");
    img.src = option.preview;
    img.alt = "";
    img.draggable = false;
    el.append(img);
  } else {
    const icon = document.createElement("span");
    icon.className = "terry-h3-media-icon";
    icon.textContent = kind === "audio" ? "♪" : kind === "video" ? "▶" : "▧";
    el.append(icon);
  }
  const label = document.createElement("span");
  label.textContent = option?.label || (kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`);
  el.append(label);
  el.title = option?.source || raw;
  return el;
}

function appendText(container, text) {
  String(text || "").split("\n").forEach((part, i) => {
    if (i) container.append(document.createElement("br"));
    if (part) container.append(document.createTextNode(part));
  });
}

function renderVisual(node, raw) {
  const editor = node.__terryH3Editor;
  if (!editor) return;
  editor.replaceChildren();
  const rx = /<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>|<(Subject|Picture|Video|Audio)\s+(\d+)>|\[Shot\s+\d+\]|\(S\d+\)|<scenetrans>|<cutoff>|\b(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b|\b\d{2}:\d{2}\.\d{3}\b|^[a-z_]+:/gmi;
  let last = 0, m;
  while ((m = rx.exec(raw))) {
    appendText(editor, raw.slice(last, m.index));
    const token = m[0];
    if (m[1] != null) {
      const d = makeChip(`[${m[1]}] ${m[2] || ""}`, token, "terry-h3-dialogue");
      editor.append(d);
    } else if (m[3]) {
      const kind = m[3].toLowerCase();
      if (kind === "picture" || kind === "video" || kind === "audio") editor.append(makeMediaChip(node, kind, Number(m[4]), token));
      else editor.append(makeChip(`◇ Subject ${m[4]}`, token, "terry-h3-strong"));
    } else if (/^\[Shot/i.test(token)) editor.append(makeChip(`🎬 ${token.slice(1, -1)}`, token, "terry-h3-strong"));
    else if (/^\(S\d+\)$/i.test(token)) editor.append(makeChip(`🎙 ${token.slice(1, -1)}`, token));
    else if (token === "<scenetrans>") editor.append(makeChip("↪ scene transition", token));
    else if (token === "<cutoff>") editor.append(makeChip("✂ cutoff", token));
    else if (MARKERS.has(token)) editor.append(makeChip(token.replaceAll("_", " "), token));
    else if (/^\d{2}:\d{2}\.\d{3}$/.test(token)) editor.append(makeChip(`⏱ ${token}`, token));
    else if (/^[a-z_]+:$/i.test(token) && SECTIONS.has(token.slice(0, -1).toLowerCase())) editor.append(makeChip(token.slice(0, -1).replaceAll("_", " "), token, "terry-h3-strong"));
    else appendText(editor, token);
    last = rx.lastIndex;
  }
  appendText(editor, raw.slice(last));
}

function editorRaw(editor) {
  let out = "";
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === Node.TEXT_NODE) out += String(child.nodeValue || "").replaceAll(CARET, "");
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.dataset?.raw != null) out += child.dataset.raw;
        else if (child.tagName === "BR") out += "\n";
        else walk(child);
      }
    }
  };
  walk(editor);
  return out;
}

function currentRaw(node) {
  const w = getWidget(node, "prompt");
  return String(w?.value ?? "");
}

function setRaw(node, text, dirty = true) {
  const w = getWidget(node, "prompt");
  if (!w) return;
  w.value = String(text || "");
  if (w._state) w._state.value = w.value;
  if (dirty) {
    node.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
  }
}

function syncFromEditor(node, dirty = true) {
  const editor = node.__terryH3Editor;
  if (!editor || node.__terryH3Rendering) return;
  setRaw(node, editorRaw(editor), dirty);
}

function viewMode(node) {
  return node?.properties?.[VIEW_PROP] === VIEW_RAW ? VIEW_RAW : VIEW_VISUAL;
}

function setView(node, mode) {
  if (!node.__terryH3Editor) return;
  if (viewMode(node) === VIEW_VISUAL) syncFromEditor(node, false);
  node.properties ||= {};
  node.properties[VIEW_PROP] = mode === VIEW_RAW ? VIEW_RAW : VIEW_VISUAL;
  refreshEditor(node, true);
  node.__terryH3Editor.focus({ preventScroll: true });
}

function refreshEditor(node, force = false) {
  const editor = node.__terryH3Editor;
  if (!editor) return;
  if (!force && document.activeElement === editor) return;
  node.__terryH3Rendering = true;
  try {
    const raw = currentRaw(node);
    if (viewMode(node) === VIEW_RAW) appendRawEditor(editor, raw);
    else renderVisual(node, raw);
    const btn = node.__terryH3ViewButton;
    if (btn) {
      btn.textContent = viewMode(node) === VIEW_RAW ? "@" : "</>";
      btn.title = viewMode(node) === VIEW_RAW ? "返回可视化预览" : "显示纯文本原文";
    }
    const count = mediaOptions(node);
    if (node.__terryH3AssetState) {
      const pc = count.filter((x) => x.kind === "picture").length;
      const vc = count.filter((x) => x.kind === "video").length;
      const ac = count.filter((x) => x.kind === "audio").length;
      node.__terryH3AssetState.textContent = `参考：图片 ${pc} · 视频 ${vc} · 音频 ${ac}`;
    }
  } finally {
    node.__terryH3Rendering = false;
  }
}

function appendRawEditor(editor, raw) {
  editor.replaceChildren();
  appendText(editor, raw);
}

function parsePasted(node, editor, text) {
  const sel = window.getSelection?.();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  range.deleteContents();
  const frag = document.createDocumentFragment();
  const rx = /<(Picture|Video|Audio)\s+(\d+)>/gi;
  let last = 0, m;
  while ((m = rx.exec(text))) {
    appendText(frag, text.slice(last, m.index));
    const kind = m[1].toLowerCase() === "picture" ? "picture" : m[1].toLowerCase();
    frag.append(makeMediaChip(node, kind, Number(m[2]), m[0]));
    last = rx.lastIndex;
  }
  appendText(frag, text.slice(last));
  const marker = document.createTextNode(CARET); frag.append(marker); range.insertNode(frag);
  const r = document.createRange(); r.setStart(marker, marker.textContent.length); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
  return true;
}

function ensureEditor(node) {
  if (node.__terryH3Editor) return true;
  if (typeof document === "undefined" || typeof node.addDOMWidget !== "function") return false;
  const prompt = getWidget(node, "prompt");
  if (!prompt) return false;
  hidePromptWidget(prompt);

  const wrap = document.createElement("div");
  wrap.className = "terry-h3-wrap";
  const editor = document.createElement("div");
  editor.className = "comfy-multiline-input terry-h3-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.tabIndex = 0;
  editor.dataset.placeholder = "粘贴 MiniMax H3 提示词，输入 @ 引用素材…";
  const tools = document.createElement("div"); tools.className = "terry-h3-tools";
  const viewBtn = document.createElement("button"); viewBtn.type = "button"; viewBtn.className = "terry-h3-view";
  viewBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
  viewBtn.addEventListener("click", () => setView(node, viewMode(node) === VIEW_RAW ? VIEW_VISUAL : VIEW_RAW));
  const assetState = document.createElement("span"); assetState.className = "terry-h3-state";
  tools.append(assetState, viewBtn); wrap.append(editor, tools);

  editor.addEventListener("input", () => syncFromEditor(node));
  editor.addEventListener("keydown", (e) => e.stopPropagation());
  editor.addEventListener("paste", (e) => {
    e.preventDefault(); e.stopPropagation();
    const text = e.clipboardData?.getData("text/plain") || "";
    if (viewMode(node) === VIEW_RAW) {
      document.execCommand?.("insertText", false, text);
    } else {
      parsePasted(node, editor, text);
    }
    syncFromEditor(node);
    if (viewMode(node) === VIEW_VISUAL) renderVisual(node, currentRaw(node));
  });
  editor.addEventListener("blur", () => syncFromEditor(node));
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());

  node.__terryH3Editor = editor;
  node.__terryH3ViewButton = viewBtn;
  node.__terryH3AssetState = assetState;
  node.__terryH3Wrap = wrap;
  node.__terryH3MenuController = attachH3Menus({
    node,
    editor,
    mode: "prompt",
    onChange: () => syncFromEditor(node),
  });

  const dom = node.addDOMWidget("terry_h3_editor", "terry_h3_editor", wrap, {
    serialize: false,
    margin: 10,
    getMinHeight: () => 280,
    getMaxHeight: () => 800,
    getValue: () => currentRaw(node),
    setValue: (v) => { setRaw(node, v, false); refreshEditor(node, true); },
  });
  if (!dom) {
    node.__terryH3Editor = null; node.__terryH3Wrap = null; wrap.remove(); return false;
  }
  dom.serialize = false;
  node.__terryH3DomWidget = dom;
  node.setSize?.([Math.max(520, Number(node.size?.[0]) || 0), Math.max(430, Number(node.size?.[1]) || 0)]);
  refreshEditor(node, true);
  return true;
}

function installEditorSoon(node) {
  if (!node || node.__terryH3InstallPending || node.__terryH3Editor) return;
  node.__terryH3InstallPending = true;
  const run = () => {
    node.__terryH3InstallPending = false;
    if (ensureEditor(node)) return;
    node.__terryH3InstallAttempts = (node.__terryH3InstallAttempts || 0) + 1;
    if (node.__terryH3InstallAttempts < 8) setTimeout(() => installEditorSoon(node), Math.min(1200, 80 * node.__terryH3InstallAttempts));
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-style";
  style.textContent = `
.terry-h3-wrap{position:relative;width:100%;height:100%;min-height:280px;box-sizing:border-box;overflow:hidden;color:var(--input-text,#ddd)}
.terry-h3-editor{width:100%;height:100%;min-height:280px;box-sizing:border-box;padding:10px 10px 34px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;border:0;background:var(--comfy-input-bg,#222);font:12px/1.6 Consolas,"Courier New",monospace}
.terry-h3-editor:empty:before{content:attr(data-placeholder);opacity:.4;pointer-events:none}
.terry-h3-tools{position:absolute;left:8px;right:8px;bottom:5px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.terry-h3-state{font-size:10px;opacity:.5;pointer-events:none}
.terry-h3-view{pointer-events:auto;width:34px;height:23px;padding:0;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font:600 10px Consolas,monospace}
.terry-h3-chip{display:inline-flex;align-items:center;gap:4px;margin:0 2px;padding:1px 5px;border-radius:5px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);vertical-align:middle;white-space:nowrap;font:11px/1.5 Consolas,monospace}
.terry-h3-strong{font-weight:700;background:rgba(255,255,255,.12)}
.terry-h3-dialogue{background:rgba(0,226,187,.12);color:rgba(190,255,244,.98)}
.terry-h3-media-chip{color:rgba(190,255,244,.98);background:rgba(0,226,187,.09)}
.terry-h3-media-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-media-icon{display:grid;place-items:center;width:24px;height:24px;border-radius:3px;background:rgba(255,255,255,.09)}
`;
  document.head.append(style);
}

function installNode(nodeType, nodeData) {
  if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3Installed) return;
  nodeType.prototype.__terryH3Installed = true;
  const created = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function() {
    const r = created?.apply(this, arguments);
    ensureLinks(this); ensureSingleMediaInput(this); installEditorSoon(this); patchCanvas(); patchGraphToPrompt();
    return r;
  };
  const added = nodeType.prototype.onAdded;
  nodeType.prototype.onAdded = function() {
    const r = added?.apply(this, arguments);
    ensureLinks(this); ensureSingleMediaInput(this); installEditorSoon(this); return r;
  };
  const configure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function(info) {
    const r = configure?.apply(this, arguments);
    ensureLinks(this); normalizeLinks(this); ensureSingleMediaInput(this); installEditorSoon(this); refreshEditorsSoon(); return r;
  };
  const connections = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
    const r = connections?.apply(this, arguments);
    const inputIndex = Number(index);
    if (connected && !this.__terryClearingLink && String(this.inputs?.[inputIndex]?.name || "") === "media") {
      setTimeout(() => convertNativeMediaConnection(this, inputIndex, linkInfo), 0);
      setTimeout(() => convertNativeMediaConnection(this, inputIndex), 40);
    }
    return r;
  };
  const draw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function() {
    const r = draw?.apply(this, arguments);
    if (!this.__terryH3Editor) installEditorSoon(this);
    return r;
  };
  const serialize = nodeType.prototype.onSerialize;
  nodeType.prototype.onSerialize = function(info) {
    syncFromEditor(this, false);
    const r = serialize?.apply(this, arguments);
    if (info) { info.properties ||= {}; info.properties[LINKS_PROP] = ensureLinks(this); info.properties[VIEW_PROP] = viewMode(this); }
    return r;
  };
}

app.registerExtension({
  name: "TerryTools.H3PromptEditor",
  setup() {
    installStyle(); patchCanvas(); patchGraphToPrompt();
    for (const delay of [0, 100, 400, 1000]) setTimeout(() => { patchCanvas(); patchGraphToPrompt(); refreshEditorsSoon(); }, delay);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    const name = String(nodeData?.name || "").toLowerCase();
    if (name.includes("loadimage") || name.includes("loadvideo") || name.includes("loadaudio")) {
      const created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function() { const r = created?.apply(this, arguments); watchSourceNode(this); return r; };
    }
    installNode(nodeType, nodeData);
  },
});