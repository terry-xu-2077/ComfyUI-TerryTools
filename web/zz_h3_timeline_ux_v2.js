import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}
function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}
function t(zh, en) { return localeIsZh() ? zh : en; }
function graphNode(node, id) { return (node?.graph || app.graph)?.getNodeById?.(Number(id)) || null; }

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  if (raw.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("video")) return "video";
  if (name.includes("audio")) return "audio";
  return "picture";
}
function filename(source, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename", "video_file", "videofile"] : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}
function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const img = (source.imgs || []).find((x) => x?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const el = w?.element;
    const image = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}
function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 }, out = [], seen = new Set();
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id), slot = Number(link?.source_slot) || 0;
    const source = graphNode(node, sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const key = `${sourceId}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const type = kind === "picture" ? "Picture" : kind === "video" ? "Video" : "Audio";
    out.push({ key, kind, index, tag: `<${type} ${index}>`, label: `${type} ${index}`,
      source, name: filename(source, kind).split(/[\\/]/).pop() || source.title || `${type} ${index}`, preview: preview(source, kind) });
  }
  return out;
}
function bindingMap(node) {
  const raw = node?.properties?.[BINDINGS_PROP];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function boundAsset(node, subjectNumber, list = assets(node)) {
  const entry = Object.entries(bindingMap(node)).find(([, subjects]) => Array.isArray(subjects) && subjects.map(Number).includes(subjectNumber));
  return entry ? list.find((asset) => asset.key === entry[0]) || null : null;
}
function parseChip(chip) {
  const raw = String(chip?.dataset?.raw || "");
  let m = raw.match(/^<Subject\s+(\d+)>$/i);
  if (m) return { type: "subject", number: Number(m[1]), raw };
  m = raw.match(/^<(Picture|Video|Audio)\s+(\d+)>$/i);
  if (m) return { type: m[1].toLowerCase(), number: Number(m[2]), raw };
  return null;
}
function renderChip(chip, info, asset) {
  if (!chip || !info) return;
  if (info.type === "subject") {
    chip.className = "terry-tl-chip terry-h3-chip terry-h3-subject-asset-chip terry-h3-strong terry-h3-type-subject";
    chip.dataset.raw = `<Subject ${info.number}>`;
  } else {
    if (!asset) return;
    chip.className = `terry-tl-chip terry-h3-chip terry-h3-media-chip terry-h3-type-${asset.kind}`;
    chip.dataset.raw = asset.tag;
  }
  chip.replaceChildren();
  if (asset?.preview && asset.kind !== "audio") {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon";
    icon.textContent = info.type === "subject" ? "◇" : asset?.kind === "audio" ? "♪" : asset?.kind === "video" ? "▶" : "▧"; chip.append(icon);
  }
  const label = document.createElement("span");
  label.textContent = info.type === "subject" ? `Subject ${info.number}` : asset.label;
  chip.append(label);
  chip.title = info.type === "subject"
    ? (asset ? t(`Subject ${info.number} · 来源 ${asset.name}`, `Subject ${info.number} · source ${asset.name}`) : t("点击选择来源资产", "Click to choose source asset"))
    : asset.name;
}
function syncChips(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  const list = assets(node);
  for (const chip of root.querySelectorAll(".terry-tl-chip")) {
    const info = parseChip(chip);
    if (!info) continue;
    if (info.type === "subject") renderChip(chip, info, boundAsset(node, info.number, list));
    else {
      const asset = list.find((item) => item.kind === info.type && item.index === info.number);
      if (asset) renderChip(chip, info, asset);
    }
  }
}

function clearOuterScroll(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  root.style.setProperty("max-height", "none", "important");
  root.style.setProperty("overflow", "visible", "important");
  const rootRect = root.getBoundingClientRect();
  let parent = root.parentElement;
  for (let depth = 0; parent && parent !== document.body && depth < 7; depth += 1, parent = parent.parentElement) {
    const rect = parent.getBoundingClientRect();
    const computed = getComputedStyle(parent);
    const nearWidth = !rootRect.width || (rect.width >= rootRect.width * .82 && rect.width <= rootRect.width * 1.22);
    const scrollish = computed.overflowY === "auto" || computed.overflowY === "scroll" || parent.scrollHeight > parent.clientHeight + 3;
    if (!nearWidth || !scrollish) continue;
    parent.style.setProperty("overflow-y", "visible", "important");
    parent.style.setProperty("overflow-x", "visible", "important");
    parent.style.setProperty("max-height", "none", "important");
    parent.style.setProperty("scrollbar-gutter", "auto", "important");
  }
}

function closeTypeMenu(node) {
  node.__terryTimelineTypeMenu?.remove?.();
  node.__terryTimelineTypeMenu = null;
}
function openGlobalAssetMenu(node, chip) {
  closeTypeMenu(node);
  const list = assets(node);
  if (!list.length) return;
  const menu = document.createElement("div"); menu.className = "terry-h3-rebind-menu terry-h3-timeline-type-menu"; node.__terryTimelineTypeMenu = menu;
  const head = document.createElement("div"); head.className = "terry-h3-rebind-head";
  const title = document.createElement("b"); title.textContent = t("切换资产 / 类型", "Change asset / type");
  const hint = document.createElement("small"); hint.textContent = t("图片、视频、音频均可切换", "Switch between image, video, and audio");
  head.append(title, hint); menu.append(head);
  for (const asset of list) {
    const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
    const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
    if (asset.preview && asset.kind !== "audio") { const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img); }
    else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const text = document.createElement("span"); const main = document.createElement("b"); main.textContent = asset.label;
    const sub = document.createElement("small"); sub.textContent = asset.name; text.append(main, sub); item.append(thumb, text);
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const info = parseChip(chip); if (!info) return;
      renderChip(chip, { ...info, type: asset.kind, number: asset.index }, asset);
      closeTypeMenu(node);
      chip.closest(".terry-tl-rich")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
      requestAnimationFrame(() => syncChips(node));
    });
    menu.append(item);
  }
  document.body.append(menu);
  const rect = chip.getBoundingClientRect(), width = 300;
  let left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top = rect.bottom + 6;
  const height = Math.min(340, menu.offsetHeight || 280);
  if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.round(left)}px`; menu.style.top = `${Math.round(top)}px`;
}

function installNode(node) {
  if (!isTarget(node)) return false;
  const editor = node.__terryH3ShotTimeline, root = editor?.root;
  if (!root) return false;
  if (!root.__terryTimelineUxV2Bound) {
    root.__terryTimelineUxV2Bound = true;
    const refreshSoon = () => requestAnimationFrame(() => { syncChips(node); clearOuterScroll(node); });
    root.addEventListener("click", (event) => {
      if (event.target?.closest?.(".terry-tl-shot,.terry-tl-meta,.terry-tl-delete")) refreshSoon();
    });
    root.addEventListener("focusin", (event) => {
      if (event.target?.closest?.(".terry-tl-rich")) refreshSoon();
    });
  }
  if (!editor.__terryUxRefreshWrapped) {
    editor.__terryUxRefreshWrapped = true;
    for (const key of ["refresh", "refreshAssets"]) {
      const old = editor[key]?.bind(editor);
      if (!old) continue;
      editor[key] = function() {
        const result = old(...arguments);
        requestAnimationFrame(() => { syncChips(node); clearOuterScroll(node); });
        return result;
      };
    }
  }
  node.__terryTimelineSyncChips = () => syncChips(node);
  syncChips(node); clearOuterScroll(node);
  return true;
}
function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => { attempts += 1; if (installNode(node) || attempts >= 16) return; setTimeout(run, Math.min(800, attempts * 60)); };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-ux-v2-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-ux-v2-style";
  style.textContent = `
.terry-h3-timeline-root{max-height:none!important;overflow:visible!important;scrollbar-gutter:auto!important}
.terry-h3-timeline-root .terry-tl-cards{max-height:none!important;overflow:visible!important;scrollbar-gutter:auto!important;padding:7px!important}
.terry-h3-timeline-root .terry-tl-card{display:none!important;margin:0!important}
.terry-h3-timeline-root .terry-tl-card.is-selected{display:grid!important;border-color:rgba(216,170,255,.72)!important;background:rgba(151,86,205,.18)!important;box-shadow:0 0 0 1px rgba(192,132,252,.18),0 5px 18px rgba(0,0,0,.18)!important}
.terry-h3-timeline-root .terry-tl-shot{opacity:.68;filter:saturate(.72);transition:background .12s ease,box-shadow .12s ease,opacity .12s ease,filter .12s ease,transform .12s ease}
.terry-h3-timeline-root .terry-tl-shot:hover{opacity:.9;filter:saturate(1)}
.terry-h3-timeline-root .terry-tl-shot.is-selected{opacity:1!important;filter:saturate(1.35) brightness(1.08)!important;background:linear-gradient(180deg,rgba(255,177,28,.55),rgba(215,116,4,.42))!important;box-shadow:inset 0 0 0 2px rgba(255,211,114,.88),0 0 16px rgba(245,158,11,.32)!important;color:#fff5dd!important;z-index:3}
.terry-h3-timeline-root .terry-tl-shot.is-selected b{font-weight:800!important;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich{max-height:190px!important;overflow-y:auto!important}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich{max-height:260px!important;overflow-y:auto!important;min-height:120px!important}
.terry-h3-timeline-root .terry-h3-media-chip img,.terry-h3-timeline-root .terry-h3-subject-asset-chip img{width:26px!important;height:26px!important;object-fit:cover;border-radius:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3TimelineUxV2",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      const chip = event.target?.closest?.(".terry-h3-timeline-root .terry-tl-section .terry-tl-chip");
      const info = parseChip(chip);
      if (chip && info && info.type !== "subject") {
        const root = chip.closest(".terry-h3-timeline-root");
        const node = (app.graph?._nodes || []).find((n) => isTarget(n) && n.__terryH3ShotTimeline?.root === root);
        if (node) {
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
          openGlobalAssetMenu(node, chip); return;
        }
      }
      for (const node of app.graph?._nodes || []) {
        if (node?.__terryTimelineTypeMenu && !node.__terryTimelineTypeMenu.contains(event.target)) closeTypeMenu(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineUxV2Installed) return;
    nodeType.prototype.__terryTimelineUxV2Installed = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() { const result = old?.apply(this, arguments); installSoon(this); return result; };
    }
    const resized = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function() { const result = resized?.apply(this, arguments); installSoon(this); return result; };
  },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});
