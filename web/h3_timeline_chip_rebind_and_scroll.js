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

function virtualLinks(node) {
  node.properties ||= {};
  const links = Array.isArray(node.properties[LINKS_PROP]) ? node.properties[LINKS_PROP] : [];
  return links.filter((link) => (node.graph || app.graph)?.getNodeById?.(Number(link?.source_id)));
}

function kindFor(source, slot, fallback = "") {
  const type = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  if (type.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("audio")) return "audio";
  if (name.includes("video")) return "video";
  return "picture";
}

function filename(source, kind) {
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
  const counts = { picture: 0, video: 0, audio: 0 };
  return virtualLinks(node).map((link) => {
    const source = (node.graph || app.graph)?.getNodeById?.(Number(link.source_id));
    const slot = Number(link.source_slot) || 0;
    const kind = link.kind || kindFor(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    return {
      key: `${Number(link.source_id)}:${slot}`,
      kind,
      index,
      source,
      name: filename(source, kind).split(/[\\/]/).pop() || source?.title || `${kind} ${index}`,
      preview: preview(source, kind),
      tag: kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`,
    };
  });
}

function bindings(node) {
  node.properties ||= {};
  let map = node.properties[BINDINGS_PROP];
  if (!map || typeof map !== "object" || Array.isArray(map)) map = {};

  // Migrate the first timeline implementation (SubjectNumber -> assetKey)
  // into the exact structure used by Terry | H3 Prompt Editor (assetKey -> SubjectNumber[]).
  const values = Object.values(map);
  if (values.some((value) => typeof value === "string")) {
    const migrated = {};
    for (const [subject, key] of Object.entries(map)) {
      if (typeof key !== "string") continue;
      migrated[key] ||= [];
      migrated[key].push(Number(subject));
    }
    map = migrated;
  }
  node.properties[BINDINGS_PROP] = map;
  return map;
}

function bindSubject(node, subjectNumber, asset) {
  const map = bindings(node);
  for (const key of Object.keys(map)) {
    const list = Array.isArray(map[key]) ? map[key].map(Number) : [];
    const next = list.filter((value) => value !== subjectNumber);
    if (next.length) map[key] = next;
    else delete map[key];
  }
  map[asset.key] ||= [];
  if (!map[asset.key].map(Number).includes(subjectNumber)) map[asset.key].push(subjectNumber);
}

function boundAsset(node, subjectNumber) {
  const map = bindings(node);
  const entry = Object.entries(map).find(([, list]) => Array.isArray(list) && list.map(Number).includes(subjectNumber));
  if (!entry) return null;
  return assets(node).find((asset) => asset.key === entry[0]) || null;
}

function parseChip(chip) {
  const raw = String(chip?.dataset?.raw || "");
  let match = raw.match(/^<Picture\s+(\d+)>$/i);
  if (match) return { type: "picture", number: Number(match[1]), raw };
  match = raw.match(/^<Video\s+(\d+)>$/i);
  if (match) return { type: "video", number: Number(match[1]), raw };
  match = raw.match(/^<Audio\s+(\d+)>$/i);
  if (match) return { type: "audio", number: Number(match[1]), raw };
  match = raw.match(/^<Subject\s+(\d+)>$/i);
  if (match) return { type: "subject", number: Number(match[1]), raw };
  return null;
}

function compatibleAssets(node, chipInfo) {
  const list = assets(node);
  if (chipInfo.type === "subject") return list.filter((asset) => asset.kind === "picture" || asset.kind === "video");
  return list.filter((asset) => asset.kind === chipInfo.type);
}

function closePicker(node) {
  node.__terryTimelineRebindMenu?.remove?.();
  node.__terryTimelineRebindMenu = null;
}

function renderChipForAsset(chip, info, asset) {
  if (info.type === "subject") {
    chip.className = "terry-tl-chip terry-h3-chip terry-h3-subject-asset-chip terry-h3-strong terry-h3-type-subject";
    chip.dataset.raw = `<Subject ${info.number}>`;
    chip.replaceChildren();
    if (asset.preview) {
      const img = document.createElement("img");
      img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
    } else {
      const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = "◇"; chip.append(icon);
    }
    const label = document.createElement("span"); label.textContent = `Subject ${info.number}`; chip.append(label);
    chip.title = t(`Subject ${info.number} · 来源 ${asset.name}`, `Subject ${info.number} · source ${asset.name}`);
    return;
  }

  chip.dataset.raw = asset.tag;
  chip.className = `terry-tl-chip terry-h3-chip terry-h3-media-chip terry-h3-type-${asset.kind}`;
  chip.replaceChildren();
  if (asset.preview && asset.kind !== "audio") {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧"; chip.append(icon);
  }
  const label = document.createElement("span"); label.textContent = asset.tag.slice(1, -1); chip.append(label);
  chip.title = asset.name;
}

function syncRoot(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  for (const chip of root.querySelectorAll(".terry-tl-chip")) {
    const info = parseChip(chip);
    if (!info) continue;
    if (info.type === "subject") {
      const asset = boundAsset(node, info.number);
      if (asset) renderChipForAsset(chip, info, asset);
      else {
        chip.classList.add("terry-h3-chip", "terry-h3-subject-asset-chip", "terry-h3-strong", "terry-h3-type-subject");
        chip.classList.remove("is-subject");
        chip.title = t(`Subject ${info.number} · 尚未绑定来源 · 点击选择图片/视频`, `Subject ${info.number} · no source bound · click to choose image/video`);
      }
    } else {
      chip.classList.add("terry-h3-chip", "terry-h3-media-chip", `terry-h3-type-${info.type}`);
      chip.classList.remove(`is-${info.type}`);
    }
  }
}

function syncTimeline(node) {
  node.__terryH3ShotTimeline?.save?.();
  syncRoot(node);
  node.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function chooseAsset(node, chip, info, asset) {
  if (info.type === "subject") bindSubject(node, info.number, asset);
  renderChipForAsset(chip, info, asset);
  closePicker(node);
  if (info.type !== "subject") {
    chip.closest(".terry-tl-rich")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  }
  syncTimeline(node);
}

function openPicker(node, chip, info) {
  closePicker(node);
  const options = compatibleAssets(node, info);
  const menu = document.createElement("div");
  menu.className = "terry-h3-rebind-menu";
  node.__terryTimelineRebindMenu = menu;

  const head = document.createElement("div");
  head.className = "terry-h3-rebind-head";
  const title = document.createElement("b");
  title.textContent = info.type === "subject"
    ? t(`Subject ${info.number} · 切换来源资产`, `Subject ${info.number} · Change Source Asset`)
    : t(`${info.raw.slice(1, -1)} · 切换资产`, `${info.raw.slice(1, -1)} · Change Asset`);
  const hint = document.createElement("small");
  hint.textContent = info.type === "subject"
    ? t("仅显示图片 / 视频", "Images / videos only")
    : t(`仅显示 ${info.type === "picture" ? "图片" : info.type === "video" ? "视频" : "音频"}`, `Only ${info.type}`);
  head.append(title, hint); menu.append(head);

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "terry-h3-rebind-empty";
    empty.textContent = t("没有可用的兼容资产", "No compatible assets available");
    menu.append(empty);
  }

  for (const asset of options) {
    const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
    const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
    if (asset.preview && asset.kind !== "audio") {
      const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img);
    } else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const text = document.createElement("span");
    const main = document.createElement("b"); main.textContent = asset.tag.slice(1, -1);
    const sub = document.createElement("small"); sub.textContent = asset.name;
    text.append(main, sub); item.append(thumb, text);
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); chooseAsset(node, chip, info, asset);
    });
    menu.append(item);
  }

  document.body.append(menu);
  const rect = chip.getBoundingClientRect();
  const width = 300;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const height = Math.min(340, menu.offsetHeight || 260);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.max(8, Math.round(left))}px`;
  menu.style.top = `${Math.max(8, Math.round(top))}px`;
}

function bindRoot(node) {
  const editor = node?.__terryH3ShotTimeline;
  const root = editor?.root;
  if (!root) return false;

  // Same interaction pattern as Terry | H3 Prompt Editor: bind pointer handling
  // once to the editor itself. No MutationObserver and no DOM polling.
  if (!root.__terryH3RebindBound) {
    root.__terryH3RebindBound = true;
    root.addEventListener("pointerdown", (event) => {
      const chip = event.target?.closest?.(".terry-tl-chip");
      if (!chip || !root.contains(chip)) return;
      const info = parseChip(chip);
      if (!info) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      openPicker(node, chip, info);
    }, true);
  }

  // Parser/render explicitly call refresh. Hook that existing lifecycle instead of
  // observing arbitrary DOM mutations, then re-apply the same chip rendering logic.
  if (!editor.__terryRebindRefreshWrapped) {
    editor.__terryRebindRefreshWrapped = true;
    const refresh = editor.refresh?.bind(editor);
    if (refresh) editor.refresh = function() {
      const result = refresh(...arguments);
      requestAnimationFrame(() => syncRoot(node));
      return result;
    };
    const refreshAssets = editor.refreshAssets?.bind(editor);
    if (refreshAssets) editor.refreshAssets = function() {
      const result = refreshAssets(...arguments);
      requestAnimationFrame(() => syncRoot(node));
      return result;
    };
  }

  syncRoot(node);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    if (bindRoot(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(900, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-chip-rebind-scroll-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-chip-rebind-scroll-style";
  style.textContent = `
.terry-h3-timeline-root{max-height:720px!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain;padding-right:5px!important}
.terry-h3-timeline-root::-webkit-scrollbar{width:8px}.terry-h3-timeline-root::-webkit-scrollbar-track{background:rgba(255,255,255,.025);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.25)}
.terry-h3-timeline-root .terry-h3-chip{margin:1px 2px;vertical-align:middle}.terry-h3-timeline-root .terry-h3-media-chip,.terry-h3-timeline-root .terry-h3-subject-asset-chip{cursor:pointer!important}
.terry-h3-timeline-root .terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-timeline-root .terry-h3-media-chip:hover,.terry-h3-timeline-root .terry-h3-subject-asset-chip:hover{box-shadow:inset 0 0 0 1px rgba(0,226,187,.38),0 0 0 1px rgba(0,226,187,.12)!important}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3TimelineChipRebindAndScroll",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        const menu = node?.__terryTimelineRebindMenu;
        if (!menu || menu.contains(event.target) || event.target?.closest?.(".terry-h3-media-chip,.terry-h3-subject-asset-chip")) continue;
        closePicker(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineChipRebindInstalled) return;
    nodeType.prototype.__terryTimelineChipRebindInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});
