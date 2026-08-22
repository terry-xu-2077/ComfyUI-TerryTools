import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("AUDIO")) return "audio";
  if (raw.includes("VIDEO")) return "video";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const image = (source.imgs || []).find((item) => item?.src);
  if (image?.src) return image.src;
  return "";
}

function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    const source = (node.graph || app.graph)?.getNodeById?.(sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    out.push({
      key: `${sourceId}:${slot}`,
      kind,
      index: counts[kind],
      preview: previewFromSource(source, kind),
    });
  }
  return out;
}

function boundAsset(node, subjectNumber, allAssets) {
  const map = node?.properties?.[BINDINGS_PROP];
  if (!map || typeof map !== "object") return null;
  for (const [key, list] of Object.entries(map)) {
    if (Array.isArray(list) && list.map(Number).includes(subjectNumber)) return allAssets.find((asset) => asset.key === key) || null;
    if (typeof list === "string" && Number(key) === subjectNumber) return allAssets.find((asset) => asset.key === list) || null;
  }
  return null;
}

function ensureThumb(chip, preview) {
  if (!preview) return;
  let img = chip.querySelector(":scope > img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    chip.prepend(img);
  }
  if (img.src !== preview) img.src = preview;
}

function syncGlobalThumbnails(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  const globalEditor = root?.querySelector?.(".terry-tl-section .terry-tl-rich");
  if (!globalEditor) return;
  const allAssets = assets(node);
  for (const chip of globalEditor.querySelectorAll(".terry-tl-chip")) {
    const raw = String(chip.dataset?.raw || "");
    let match = raw.match(/^<Subject\s+(\d+)>$/i);
    if (match) {
      const asset = boundAsset(node, Number(match[1]), allAssets);
      if (asset?.preview) ensureThumb(chip, asset.preview);
      continue;
    }
    match = raw.match(/^<(Picture|Video)\s+(\d+)>$/i);
    if (match) {
      const kind = match[1].toLowerCase() === "picture" ? "picture" : "video";
      const asset = allAssets.find((item) => item.kind === kind && item.index === Number(match[2]));
      if (asset?.preview) ensureThumb(chip, asset.preview);
    }
  }
}

function parseState(node) {
  try {
    const raw = widget(node, "timeline_state")?.value;
    const state = raw ? JSON.parse(raw) : null;
    return state && Array.isArray(state.shots) ? state : null;
  } catch {
    return null;
  }
}

function summary(text) {
  return String(text || "")
    .replace(/<d>\[[^\]]+\][\s\S]*?<\/d>/gi, " ")
    .replace(/<(?:Subject|Picture|Video|Audio)\s+\d+>/gi, " ")
    .replace(/\(S\d+\)/gi, " ")
    .replace(/^\s*(?:景别与构图|主体动态|运镜动态|光照|音效)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function updateLane(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  const lane = root?.querySelector?.(".terry-tl-lane");
  if (!lane) return;
  const state = parseState(node);
  if (!state) return;
  const blocks = [...lane.querySelectorAll(".terry-tl-shot")];
  blocks.forEach((block, index) => {
    let line = block.querySelector(":scope > .terry-tl-shot-summary");
    if (!line) {
      line = document.createElement("span");
      line.className = "terry-tl-shot-summary";
      block.append(line);
    }
    line.textContent = summary(state.shots[index]?.text) || "—";
    const dur = block.querySelector(":scope > small");
    if (dur) dur.classList.add("terry-tl-shot-duration");
  });
}

function syncNow(node) {
  updateLane(node);
  syncGlobalThumbnails(node);
}

function refreshSoon(node) {
  requestAnimationFrame(() => syncNow(node));
}

function bind(node) {
  if (!isTarget(node)) return false;
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return false;
  if (!root.__terryLanePolishBound) {
    root.__terryLanePolishBound = true;

    // Run synchronously in bubble phase. The core target handler has already
    // rebuilt the lane by then, but the browser has not painted yet, so there
    // is no one-frame fallback/flicker.
    root.addEventListener("click", () => syncNow(node));
    root.addEventListener("drop", (event) => {
      if (event.target?.closest?.(".terry-tl-shot")) syncNow(node);
    });
    root.addEventListener("pointerup", (event) => {
      if (event.target?.closest?.(".terry-tl-seam")) syncNow(node);
    });
    root.addEventListener("pointercancel", (event) => {
      if (event.target?.closest?.(".terry-tl-seam")) syncNow(node);
    });
    root.addEventListener("focusin", (event) => {
      if (event.target?.closest?.(".terry-tl-rich")) syncNow(node);
    });
    root.addEventListener("input", (event) => {
      if (event.target?.closest?.(".terry-tl-card .terry-tl-rich")) syncNow(node);
    });
  }

  const editor = node.__terryH3ShotTimeline;
  if (editor && !editor.__terryLanePolishRefreshWrapped) {
    editor.__terryLanePolishRefreshWrapped = true;
    for (const name of ["refresh", "refreshAssets"]) {
      const original = editor[name]?.bind(editor);
      if (!original) continue;
      editor[name] = function() {
        const result = original(...arguments);
        syncNow(node);
        return result;
      };
    }
  }
  refreshSoon(node);
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  let tries = 0;
  const run = () => {
    tries += 1;
    if (bind(node) || tries >= 12) return;
    setTimeout(run, Math.min(720, tries * 60));
  };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-lane-polish-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-lane-polish-style";
  style.textContent = `
.terry-h3-timeline-root .terry-tl-rich{cursor:text!important}
.terry-h3-timeline-root .terry-tl-lane{height:76px!important}
.terry-h3-timeline-root .terry-tl-shot{padding:8px 9px 7px!important}
.terry-h3-timeline-root .terry-tl-shot>b,
.terry-h3-timeline-root .terry-tl-shot>small{display:inline!important;font-size:11px!important;font-weight:700!important;line-height:1.2!important;color:inherit!important;opacity:1!important}
.terry-h3-timeline-root .terry-tl-shot>small{margin:0 0 0 6px!important;padding:1px 6px!important;border:1px solid rgba(255,209,102,.62)!important;border-radius:999px!important;background:rgba(245,158,11,.12)!important}
.terry-h3-timeline-root .terry-tl-shot-summary{display:block;margin-top:7px;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;line-height:1.2;opacity:.72;text-align:center;color:#f7e6ca}
.terry-h3-timeline-root .terry-tl-shot.is-selected{background:linear-gradient(180deg,rgba(245,158,11,.52),rgba(218,119,6,.34))!important;border:1px solid #ffd166!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 0 12px rgba(245,158,11,.38)!important;color:#fff7e8!important;z-index:2}
.terry-h3-timeline-root .terry-tl-shot.is-selected>b,
.terry-h3-timeline-root .terry-tl-shot.is-selected>small{font-size:11px!important;font-weight:700!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.terry-h3-timeline-root .terry-tl-shot.is-selected>small{border-color:#ffe0a3!important;background:rgba(255,209,102,.18)!important}
.terry-h3-timeline-root .terry-tl-shot.is-selected .terry-tl-shot-summary{opacity:.95;color:#fff3da}
.terry-h3-timeline-root .terry-tl-section .terry-tl-chip>img{width:26px;height:26px;object-fit:cover;border-radius:3px;margin-right:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3TimelineLanePolish",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryLanePolishInstalled) return;
    nodeType.prototype.__terryLanePolishInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        bindSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) bindSoon(node); },
});
