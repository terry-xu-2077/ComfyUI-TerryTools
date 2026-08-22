import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
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
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v)$/i.test(String(file))) return String(file);
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
  return (source.imgs || []).find((item) => item?.src)?.src || "";
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
    out.push({ key: `${sourceId}:${slot}`, kind, index: counts[kind], preview: previewFromSource(source, kind) });
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

function syncThumbnails(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  const allAssets = assets(node);
  for (const chip of root.querySelectorAll(".terry-tl-rich .terry-tl-chip")) {
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

function endsWithNewline(fragment) {
  const last = fragment.lastChild;
  return last?.nodeType === Node.TEXT_NODE && String(last.nodeValue || "").endsWith("\n");
}

function flattenInto(fragment, node) {
  if (node.nodeType === Node.TEXT_NODE) {
    fragment.append(document.createTextNode(node.nodeValue || ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.tagName === "BR") {
    fragment.append(document.createTextNode("\n"));
    return;
  }
  if (node.tagName === "DIV" || node.tagName === "P") {
    if (fragment.childNodes.length && !endsWithNewline(fragment)) fragment.append(document.createTextNode("\n"));
    for (const child of [...node.childNodes]) flattenInto(fragment, child);
    return;
  }
  fragment.append(node);
}

function normalizeEditorLines(editor) {
  if (!editor?.querySelector?.("div,p,br")) return;
  const selection = window.getSelection?.();
  let marker = null;
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
    marker = document.createElement("span");
    marker.dataset.terryTimelineCaret = "1";
    marker.textContent = "";
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    range.insertNode(marker);
  }

  const fragment = document.createDocumentFragment();
  for (const child of [...editor.childNodes]) flattenInto(fragment, child);
  editor.replaceChildren(fragment);

  if (marker?.isConnected && selection) {
    const range = document.createRange();
    range.setStartBefore(marker);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    marker.remove();
  }
}

function bind(node) {
  if (!isTarget(node)) return false;
  const editorApi = node?.__terryH3ShotTimeline;
  const root = editorApi?.root;
  if (!root) return false;

  if (!root.__terryTimelineIntegrityBound) {
    root.__terryTimelineIntegrityBound = true;
    // Run before the timeline core's bubbling input listener serializes the rich editor.
    root.addEventListener("input", (event) => {
      const editor = event.target?.closest?.(".terry-tl-rich");
      if (editor && root.contains(editor)) normalizeEditorLines(editor);
    }, true);
  }

  if (!editorApi.__terryTimelineIntegrityRefreshWrapped) {
    editorApi.__terryTimelineIntegrityRefreshWrapped = true;
    for (const name of ["refresh", "refreshAssets"]) {
      const original = editorApi[name]?.bind(editorApi);
      if (!original) continue;
      editorApi[name] = function() {
        const result = original(...arguments);
        // Re-apply bindings synchronously so rebuilt rich editors never paint a frame without thumbnails.
        syncThumbnails(node);
        return result;
      };
    }
  }

  syncThumbnails(node);
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

app.registerExtension({
  name: "TerryTools.H3TimelineEditorIntegrity",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineIntegrityInstalled) return;
    nodeType.prototype.__terryTimelineIntegrityInstalled = true;
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
