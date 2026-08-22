import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { attachH3Menus } from "./h3_shared_menus.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const MIN_SHOT = 0.5;
const MAX_DURATION = 30;
const MAX_MEDIA = 32;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function hideWidget(w) {
  if (!w || w.__terryTimelineHidden) return;
  w.__terryTimelineHidden = true;
  w.hidden = true;
  w.type = "hidden";
  w.options ||= {};
  w.options.hidden = true;
  w.computeSize = () => [0, -4];
  if (w.element?.style) w.element.style.display = "none";
  if (w.inputEl?.style) w.inputEl.style.display = "none";
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

function t(zh, en) { return localeIsZh() ? zh : en; }

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const sec = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

function parseTime(text) {
  const m = String(text || "").match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000 : null;
}

function clean(text) { return String(text || "").replace(/\r\n?/g, "\n").trim(); }

function normalizeDurations(shots, total) {
  total = Math.max(1, Math.min(MAX_DURATION, Number(total) || 15));
  if (!shots.length) shots.push({ text: "", duration: total });
  if (shots.length * MIN_SHOT > total) shots.splice(Math.max(1, Math.floor(total / MIN_SHOT)));
  for (const shot of shots) shot.duration = Math.max(MIN_SHOT, Number(shot.duration) || MIN_SHOT);
  let sum = shots.reduce((a, s) => a + s.duration, 0);
  if (!sum) return;
  let remaining = total;
  let flex = sum;
  for (const shot of shots) shot.duration = shot.duration / flex * remaining;
  for (let pass = 0; pass < 5; pass++) {
    const low = shots.filter((s) => s.duration < MIN_SHOT);
    if (!low.length) break;
    const fixed = low.length * MIN_SHOT;
    for (const s of low) s.duration = MIN_SHOT;
    const high = shots.filter((s) => s.duration > MIN_SHOT);
    const highSum = high.reduce((a, s) => a + s.duration, 0);
    const target = total - fixed - shots.filter((s) => s.duration === MIN_SHOT && !low.includes(s)).length * MIN_SHOT;
    if (highSum > 0 && target > 0) for (const s of high) s.duration = Math.max(MIN_SHOT, s.duration / highSum * target);
  }
  sum = shots.reduce((a, s) => a + s.duration, 0);
  shots[shots.length - 1].duration += total - sum;
}

function parsePrompt(raw, total) {
  const source = clean(raw);
  const soundMatch = source.match(/(?:^|\n)overall_soundscape:\s*\n?([\s\S]*?)(?=\nnon_diegetic_music:|$)/i);
  const musicMatch = source.match(/(?:^|\n)non_diegetic_music:\s*\n?([\s\S]*?)$/i);
  let detailed = source.replace(/(?:^|\n)overall_soundscape:[\s\S]*$/i, "").trim();
  detailed = detailed.replace(/^detailed_description:\s*/i, "");
  const re = /\[Shot\s+(\d+)\]/gi;
  const matches = [...detailed.matchAll(re)];
  if (!matches.length) {
    return {
      global: detailed,
      shots: [{ text: "", duration: total }],
      soundEnabled: Boolean(soundMatch), soundscape: clean(soundMatch?.[1] || ""),
      musicEnabled: Boolean(musicMatch), music: clean(musicMatch?.[1] || ""),
    };
  }
  const global = detailed.slice(0, matches[0].index).trim();
  const starts = [];
  const shots = [];
  matches.forEach((m, i) => {
    const begin = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : detailed.length;
    let body = detailed.slice(begin, end).trim();
    let start = i === 0 ? 0 : null;
    const tm = body.match(/^At\s+(\d{1,2}:\d{2}\.\d{3})\s*,\s*/i);
    if (tm) { start = parseTime(tm[1]); body = body.slice(tm[0].length).trim(); }
    starts.push(start); shots.push({ text: body, duration: 0 });
  });
  const valid = starts.slice(1).every((v, i) => v != null && v > (starts[i] ?? 0));
  if (valid) {
    for (let i = 0; i < shots.length; i++) {
      const a = starts[i] ?? 0;
      const b = i + 1 < shots.length ? starts[i + 1] : total;
      shots[i].duration = Math.max(MIN_SHOT, b - a);
    }
  } else {
    for (const shot of shots) shot.duration = total / shots.length;
  }
  normalizeDurations(shots, total);
  return {
    global, shots,
    soundEnabled: Boolean(soundMatch), soundscape: clean(soundMatch?.[1] || ""),
    musicEnabled: Boolean(musicMatch), music: clean(musicMatch?.[1] || ""),
  };
}

function compile(state) {
  const parts = ["detailed_description:"];
  if (clean(state.global)) parts.push(clean(state.global));
  let cursor = 0;
  state.shots.forEach((shot, index) => {
    const body = clean(shot.text);
    if (index === 0) parts.push(`[Shot 1]${body ? ` ${body}` : ""}`);
    else parts.push(`[Shot ${index + 1}] At ${formatTime(cursor)},${body ? ` ${body}` : ""}`);
    cursor += shot.duration;
  });
  if (state.soundEnabled) parts.push(`overall_soundscape:\n${clean(state.soundscape)}`);
  if (state.musicEnabled) parts.push(`non_diegetic_music:\n${clean(state.music)}`);
  return parts.join("\n\n");
}

function parseSavedState(raw, fallbackText, fallbackDuration) {
  const total = Math.max(1, Math.min(MAX_DURATION, Number(fallbackDuration) || 15));
  try {
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.shots)) {
        const state = {
          total: Math.max(1, Math.min(MAX_DURATION, Number(data.total) || total)),
          global: String(data.global ?? data.intro ?? ""),
          shots: data.shots.map((s) => ({ text: String(s?.text || ""), duration: Number(s?.duration) || MIN_SHOT })),
          selected: Math.max(0, Number(data.selected) || 0),
          soundEnabled: Boolean(data.soundEnabled), soundscape: String(data.soundscape || ""),
          musicEnabled: Boolean(data.musicEnabled), music: String(data.music || ""),
        };
        normalizeDurations(state.shots, state.total);
        return state;
      }
    }
  } catch {}
  const parsed = parsePrompt(fallbackText, total);
  return { total, selected: 0, ...parsed };
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

function sourceKind(node, slot = 0, fallback = "") {
  const raw = String(node?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  return "picture";
}

function normalizeLinks(node) {
  const graph = node?.graph || app.graph;
  const out = [];
  const seen = new Set();
  for (const link of ensureLinks(node)) {
    const id = Number(link?.source_id), slot = Number(link?.source_slot) || 0;
    const src = graph?.getNodeById?.(id);
    if (!Number.isFinite(id) || !src || id === Number(node.id)) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source_id: id, source_slot: slot, source_type: String(src.outputs?.[slot]?.type || link.source_type || "*"), kind: sourceKind(src, slot, link.source_type) });
  }
  node.properties[LINKS_PROP] = out.slice(0, MAX_MEDIA);
  return node.properties[LINKS_PROP];
}

function addVirtualLink(node, src, slot = 0, type = "") {
  const links = normalizeLinks(node);
  if (!src || links.length >= MAX_MEDIA || links.some((x) => Number(x.source_id) === Number(src.id) && x.source_slot === slot)) return false;
  links.push({ source_id: Number(src.id), source_slot: slot, source_type: String(type || src.outputs?.[slot]?.type || "*"), kind: sourceKind(src, slot, type) });
  node.properties[LINKS_PROP] = links;
  node.__terryH3ShotTimeline?.refreshAssets?.();
  app.graph?.change?.();
  return true;
}

function getMediaInputIndex(node) { return node?.inputs?.findIndex((x) => String(x?.name || "") === "media") ?? -1; }

function ensureSingleMediaInput(node) {
  node.inputs ||= [];
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const name = String(node.inputs[i]?.name || "");
    if (/^asset\d*$/i.test(name) || name === "assets") {
      try { if (node.inputs[i]?.link != null) node.disconnectInput?.(i); } catch {}
      if (typeof node.removeInput === "function") node.removeInput(i); else node.inputs.splice(i, 1);
    }
  }
  if (getMediaInputIndex(node) < 0) node.addInput?.("media", "*");
  const input = node.inputs[getMediaInputIndex(node)];
  if (input) {
    input.name = "media"; input.type = "*";
    input.label = t("参考 · 多路输入", "References · Multi-input");
    input.localized_name = input.label;
  }
}

function convertConnection(node, inputIndex, info = null) {
  if (!isTarget(node) || node.__terryClearingLink) return false;
  const input = node.inputs?.[inputIndex];
  if (String(input?.name || "") !== "media") return false;
  const graph = node.graph || app.graph;
  const native = graphLink(graph, input?.link) || info;
  if (!native) return false;
  const sourceId = native.origin_id ?? native.originId ?? native.from_id ?? native.fromId;
  const src = native.origin_node || native.originNode || graph?.getNodeById?.(Number(sourceId));
  if (!src) return false;
  const slot = Number(native.origin_slot ?? native.originSlot ?? native.from_slot ?? 0) || 0;
  const added = addVirtualLink(node, src, slot, native.type || src.outputs?.[slot]?.type || "*");
  node.__terryClearingLink = true;
  try { if (node.inputs?.[inputIndex]?.link != null) node.disconnectInput?.(inputIndex); } finally { node.__terryClearingLink = false; }
  return added;
}

function patchGraphToPrompt() {
  if (app.__terryH3TimelineGraphToPromptPatched || typeof app.graphToPrompt !== "function") return;
  app.__terryH3TimelineGraphToPromptPatched = true;
  const old = app.graphToPrompt;
  app.graphToPrompt = async function() {
    const data = await old.apply(this, arguments);
    const output = data?.output || {};
    for (const node of app.graph?._nodes || []) {
      if (!isTarget(node)) continue;
      node.__terryH3ShotTimeline?.save?.();
      const dst = output[String(node.id)];
      if (!dst) continue;
      dst.inputs ||= {};
      delete dst.inputs.media;
      for (const key of Object.keys(dst.inputs)) if (/^asset\d+$/i.test(key)) delete dst.inputs[key];
      normalizeLinks(node).forEach((link, i) => {
        if (output[String(link.source_id)]) dst.inputs[`asset${i + 1}`] = [String(link.source_id), Number(link.source_slot) || 0];
      });
    }
    return data;
  };
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3TimelineLinksPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3TimelineLinksPatched = true;
  const old = canvas.drawConnections;
  canvas.drawConnections = function(ctx) {
    const r = old.apply(this, arguments);
    const graph = this.graph || app.graph;
    for (const target of graph?._nodes || []) {
      if (!isTarget(target)) continue;
      const idx = getMediaInputIndex(target);
      if (idx < 0) continue;
      const end = target.getInputPos?.(idx) || [target.pos[0], target.pos[1] + 40 + idx * 20];
      for (const link of normalizeLinks(target)) {
        const src = graph.getNodeById?.(Number(link.source_id));
        if (!src) continue;
        const start = src.getOutputPos?.(Number(link.source_slot) || 0) || [src.pos[0] + src.size[0], src.pos[1] + 40];
        ctx.save(); ctx.beginPath(); ctx.moveTo(start[0], start[1]);
        ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
        ctx.strokeStyle = globalThis.LGraphCanvas?.link_type_colors?.[link.source_type] || "#999";
        ctx.lineWidth = this.connections_width || 3; ctx.stroke(); ctx.restore();
      }
    }
    return r;
  };
}

function filenameFromSource(node, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename"] : ["audio", "file", "filename"];
  for (const w of node?.widgets || []) {
    const v = w?.value; const f = typeof v === "object" ? (v?.filename || v?.name) : v;
    if (!f || /^(data:|blob:|https?:)/i.test(String(f))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|flac|ogg|m4a)$/i.test(String(f))) return String(f);
  }
  return "";
}

function previewFromSource(node, kind) {
  if (!node || kind === "audio") return "";
  const filename = filenameFromSource(node, kind);
  if (filename) {
    const w = (node.widgets || []).find((x) => {
      const v = x?.value; return String(typeof v === "object" ? (v?.filename || v?.name || "") : (v || "")) === filename;
    });
    const v = w?.value;
    const q = new URLSearchParams({ filename, type: typeof v === "object" ? String(v.type || "input") : "input" });
    if (typeof v === "object" && v.subfolder) q.set("subfolder", String(v.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  return (node.imgs || []).find((x) => x?.src)?.src || "";
}

function mediaOptions(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return normalizeLinks(node).map((link) => {
    const kind = link.kind || "picture"; counts[kind] += 1;
    const index = counts[kind]; const src = (node.graph || app.graph)?.getNodeById?.(Number(link.source_id));
    const label = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    return { kind, index, raw: `<${label}>`, label, source: filenameFromSource(src, kind).split(/[\\/]/).pop() || src?.title || label, preview: previewFromSource(src, kind) };
  });
}

const TOKEN_RE = /(<(?:Subject|Picture|Video|Audio)\s+\d+>|\(S\d+\)|<d>\[[^\]]+\][\s\S]*?<\/d>)/gi;

function makeChip(raw, text, cls = "") {
  const el = document.createElement("span");
  el.className = `terry-tl-chip ${cls}`; el.contentEditable = "false"; el.dataset.raw = raw; el.textContent = text;
  return el;
}

function dialogueChip(raw) {
  const m = String(raw).match(/^<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>$/i);
  if (!m) return makeChip(raw, raw, "is-dialogue");
  const wrap = makeChip(raw, "", "is-dialogue"); wrap.replaceChildren();
  const lang = document.createElement("span"); lang.className = "terry-tl-dialogue-lang"; lang.textContent = m[1];
  const text = document.createElement("span"); text.className = "terry-tl-dialogue-text"; text.contentEditable = "true"; text.textContent = m[2];
  text.addEventListener("input", () => { wrap.dataset.raw = `<d>[${lang.textContent}] ${text.innerText.replaceAll("\n", " ")}</d>`; wrap.dispatchEvent(new Event("terrychange", { bubbles: true })); });
  text.addEventListener("pointerdown", (e) => e.stopPropagation());
  wrap.append(lang, text); return wrap;
}

function tokenNode(raw, node) {
  if (/^<d>/i.test(raw)) return dialogueChip(raw);
  const asset = raw.match(/^<(Picture|Video|Audio)\s+(\d+)>$/i);
  if (asset) {
    const kind = asset[1].toLowerCase() === "picture" ? "picture" : asset[1].toLowerCase();
    const option = mediaOptions(node).find((x) => x.kind === kind && x.index === Number(asset[2]));
    const chip = makeChip(raw, option?.label || raw.slice(1, -1), `is-${kind}`);
    if (option?.preview && kind !== "audio") {
      const img = document.createElement("img"); img.src = option.preview; img.alt = ""; chip.prepend(img);
    }
    return chip;
  }
  if (/^<Subject\s+\d+>$/i.test(raw)) return makeChip(raw, raw.slice(1, -1), "is-subject");
  if (/^\(S\d+\)$/i.test(raw)) return makeChip(raw, `🎙 ${raw.slice(1, -1)}`, "is-speaker");
  return document.createTextNode(raw);
}

function renderRich(editor, raw, node) {
  editor.replaceChildren();
  const source = String(raw || ""); let last = 0;
  for (const m of source.matchAll(TOKEN_RE)) {
    if (m.index > last) editor.append(document.createTextNode(source.slice(last, m.index)));
    editor.append(tokenNode(m[0], node)); last = m.index + m[0].length;
  }
  if (last < source.length) editor.append(document.createTextNode(source.slice(last)));
  if (!source) editor.append(document.createTextNode(""));
}

function serializeRich(editor) {
  let out = "";
  for (const child of editor.childNodes) out += child.nodeType === Node.TEXT_NODE ? child.nodeValue : (child.dataset?.raw ?? child.innerText ?? "");
  return out.replace(/\u200B/g, "");
}

function createRichEditor(node, value, placeholder, onChange) {
  const editor = document.createElement("div"); editor.className = "terry-tl-rich"; editor.contentEditable = "true"; editor.dataset.placeholder = placeholder;
  renderRich(editor, value, node);
  let lastValue = value;
  const commit = () => { lastValue = serializeRich(editor); onChange(lastValue); };
  editor.addEventListener("input", commit);
  editor.addEventListener("terrychange", commit);
  editor.addEventListener("keydown", (e) => { if (e.key === "Enter") e.stopPropagation(); });
  editor.addEventListener("blur", () => setTimeout(() => {
    const valueNow = serializeRich(editor);
    if (TOKEN_RE.test(valueNow)) { TOKEN_RE.lastIndex = 0; renderRich(editor, valueNow, node); }
  }, 100));
  const menuController = attachH3Menus({ node, editor, mode: "timeline", onChange: commit });
  return { editor, menuController, setValue(v) { if (v === lastValue) return; lastValue = v; renderRich(editor, v, node); }, refreshAssets() { const v = serializeRich(editor); renderRich(editor, v, node); } };
}

function createEditor(node) {
  const textWidget = widget(node, "compiled_prompt");
  const durationWidget = widget(node, "duration");
  const stateWidget = widget(node, "timeline_state");
  hideWidget(textWidget); hideWidget(durationWidget); hideWidget(stateWidget);
  ensureSingleMediaInput(node);

  let state = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value);
  let dragBoundary = null, raf = 0, dragShot = null;
  const richEditors = new Set();

  const root = document.createElement("div"); root.className = "terry-h3-timeline-root";
  const header = document.createElement("div"); header.className = "terry-tl-header";
  const title = document.createElement("b"); title.textContent = t("H3 提示词编辑器（时间轴）", "H3 Prompt Editor (Timeline)");
  const durationLabel = document.createElement("span");
  const durationRange = document.createElement("input"); durationRange.type = "range"; durationRange.min = "1"; durationRange.max = String(MAX_DURATION); durationRange.step = "1";
  const durationNumber = document.createElement("input"); durationNumber.type = "number"; durationNumber.min = "1"; durationNumber.max = String(MAX_DURATION); durationNumber.step = "1";
  header.append(title, durationLabel, durationRange, durationNumber);

  const globalWrap = document.createElement("section"); globalWrap.className = "terry-tl-section";
  const globalLabel = document.createElement("label"); globalLabel.textContent = t("全局描述", "Global description");
  const globalRich = createRichEditor(node, state.global, t("描述整体风格、场景规则、摄影方式等；@ 插入参考标签", "Describe overall style, scene rules, camera language, etc.; @ inserts references"), (v) => { state.global = v; save(); });
  richEditors.add(globalRich); globalWrap.append(globalLabel, globalRich.editor);

  const laneHead = document.createElement("div"); laneHead.className = "terry-tl-lane-head";
  const laneTitle = document.createElement("span"); laneTitle.textContent = t("镜头时间轴", "Shot timeline");
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.textContent = t("+ 镜头", "+ Shot"); laneHead.append(laneTitle, addBtn);
  const lane = document.createElement("div"); lane.className = "terry-tl-lane";
  const cards = document.createElement("div"); cards.className = "terry-tl-cards";

  const audio = document.createElement("section"); audio.className = "terry-tl-audio";
  const soundToggle = optionToggle(t("整体声音环境", "overall_soundscape"), state.soundEnabled, (checked) => { state.soundEnabled = checked; renderAudio(); save(); });
  const musicToggle = optionToggle(t("非剧情内音乐", "non_diegetic_music"), state.musicEnabled, (checked) => { state.musicEnabled = checked; renderAudio(); save(); });
  const soundBox = document.createElement("textarea"); soundBox.rows = 2; soundBox.placeholder = t("环境声、动作声、呼吸等", "Ambience, action sounds, breathing, etc."); soundBox.value = state.soundscape;
  const musicBox = document.createElement("textarea"); musicBox.rows = 2; musicBox.placeholder = t("非剧情内音乐；无则可写 N/A", "Non-diegetic music; use N/A for none"); musicBox.value = state.music;
  soundBox.addEventListener("input", () => { state.soundscape = soundBox.value; save(); }); musicBox.addEventListener("input", () => { state.music = musicBox.value; save(); });
  audio.append(soundToggle.wrap, soundBox, musicToggle.wrap, musicBox);

  const footer = document.createElement("div"); footer.className = "terry-tl-footer";
  const help = document.createElement("span"); help.textContent = t("拖接缝调时长 · 拖镜头块排序", "Drag seams for duration · drag shot blocks to reorder");
  const status = document.createElement("span"); footer.append(help, status);
  root.append(header, globalWrap, laneHead, lane, cards, audio, footer);

  function optionToggle(label, checked, onchange) {
    const wrap = document.createElement("label"); wrap.className = "terry-tl-option";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
    const text = document.createElement("span"); text.textContent = label; wrap.append(input, text); input.addEventListener("change", () => onchange(input.checked));
    return { wrap, input };
  }

  function renderAudio() {
    soundToggle.input.checked = state.soundEnabled; musicToggle.input.checked = state.musicEnabled;
    soundBox.style.display = state.soundEnabled ? "block" : "none"; musicBox.style.display = state.musicEnabled ? "block" : "none";
  }

  function save() {
    state.total = Math.max(1, Math.min(MAX_DURATION, Number(state.total) || 15));
    const compiled = compile(state);
    if (textWidget) { textWidget.value = compiled; textWidget.callback?.(compiled); }
    if (durationWidget) { durationWidget.value = Math.round(state.total); durationWidget.callback?.(durationWidget.value); }
    if (stateWidget) {
      const packed = JSON.stringify(state); stateWidget.value = packed; stateWidget.callback?.(packed);
    }
    status.textContent = `${state.shots.length} ${t("镜头", "shots")} · ${state.total.toFixed(1)}s`;
    node.setDirtyCanvas?.(true, true);
  }

  function setTotal(next) {
    next = Math.max(1, Math.min(MAX_DURATION, Number(next) || 15));
    if (state.shots.length * MIN_SHOT > next) next = state.shots.length * MIN_SHOT;
    const scale = next / state.total;
    for (const shot of state.shots) shot.duration *= scale;
    state.total = next; normalizeDurations(state.shots, next); render(); save();
  }
  durationRange.addEventListener("input", () => setTotal(durationRange.value)); durationNumber.addEventListener("change", () => setTotal(durationNumber.value));

  addBtn.addEventListener("click", () => {
    const index = Math.max(0, Math.min(state.shots.length - 1, state.selected || 0));
    const base = state.shots[index]; if (!base || base.duration < MIN_SHOT * 2) return;
    const half = base.duration / 2; base.duration = half; state.shots.splice(index + 1, 0, { text: "", duration: half }); state.selected = index + 1; render(); save();
  });

  function deleteShot(index) {
    if (state.shots.length <= 1) return;
    const removed = state.shots[index];
    if (index > 0) state.shots[index - 1].duration += removed.duration; else state.shots[1].duration += removed.duration;
    state.shots.splice(index, 1); state.selected = Math.max(0, Math.min(state.shots.length - 1, index - 1)); render(); save();
  }

  function reorderShot(from, to) {
    if (from === to || from == null || to == null) return;
    const [shot] = state.shots.splice(from, 1); state.shots.splice(to, 0, shot); state.selected = to; render(); save();
  }

  function renderLane() {
    lane.replaceChildren();
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const block = document.createElement("button"); block.type = "button"; block.className = `terry-tl-shot${index === state.selected ? " is-selected" : ""}`;
      block.style.flexBasis = `${shot.duration / state.total * 100}%`; block.draggable = true;
      const grip = document.createElement("span"); grip.className = "terry-tl-grip"; grip.textContent = "⋮⋮";
      const label = document.createElement("b"); label.textContent = `Shot ${index + 1}`;
      const dur = document.createElement("small"); dur.textContent = `${shot.duration.toFixed(1)}s`; block.append(grip, label, dur);
      block.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });
      block.addEventListener("dragstart", (e) => { dragShot = index; e.dataTransfer.effectAllowed = "move"; block.classList.add("is-dragging"); });
      block.addEventListener("dragend", () => { dragShot = null; block.classList.remove("is-dragging"); });
      block.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; block.classList.add("is-drop"); });
      block.addEventListener("dragleave", () => block.classList.remove("is-drop"));
      block.addEventListener("drop", (e) => { e.preventDefault(); block.classList.remove("is-drop"); reorderShot(dragShot, index); });
      lane.append(block);
      cursor += shot.duration;
      if (index < state.shots.length - 1) {
        const handle = document.createElement("div"); handle.className = "terry-tl-seam"; handle.style.left = `calc(${cursor / state.total * 100}% - 6px)`;
        handle.addEventListener("pointerdown", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          dragBoundary = { index, pointerId: ev.pointerId, startX: ev.clientX, left: state.shots[index].duration, right: state.shots[index + 1].duration, handle, leftBlock: block, rightBlock: lane.children[lane.children.length - 1] };
          handle.setPointerCapture?.(ev.pointerId); handle.classList.add("is-active");
        });
        handle.addEventListener("pointermove", (ev) => {
          if (!dragBoundary || dragBoundary.index !== index) return;
          dragBoundary.clientX = ev.clientX;
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (!dragBoundary) return;
            const rect = lane.getBoundingClientRect(); if (!rect.width) return;
            const pair = dragBoundary.left + dragBoundary.right;
            const delta = (dragBoundary.clientX - dragBoundary.startX) / rect.width * state.total;
            let left = Math.round((dragBoundary.left + delta) * 10) / 10;
            left = Math.max(MIN_SHOT, Math.min(pair - MIN_SHOT, left));
            state.shots[index].duration = left; state.shots[index + 1].duration = pair - left;
            const blocks = [...lane.querySelectorAll(".terry-tl-shot")];
            blocks[index].style.flexBasis = `${left / state.total * 100}%`; blocks[index + 1].style.flexBasis = `${(pair - left) / state.total * 100}%`;
            blocks[index].querySelector("small").textContent = `${left.toFixed(1)}s`; blocks[index + 1].querySelector("small").textContent = `${(pair - left).toFixed(1)}s`;
            const before = state.shots.slice(0, index + 1).reduce((a, s) => a + s.duration, 0); handle.style.left = `calc(${before / state.total * 100}% - 6px)`;
          });
        });
        const finish = () => {
          if (!dragBoundary || dragBoundary.index !== index) return;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          handle.classList.remove("is-active"); dragBoundary = null; renderLane(); renderCards(); save();
        };
        handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", finish); lane.append(handle);
      }
    });
  }

  function renderCards() {
    cards.replaceChildren(); richEditors.clear(); richEditors.add(globalRich);
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const row = document.createElement("div"); row.className = `terry-tl-card${index === state.selected ? " is-selected" : ""}`;
      const meta = document.createElement("button"); meta.type = "button"; meta.className = "terry-tl-meta";
      meta.innerHTML = `<b>Shot ${index + 1}</b><small>${formatTime(cursor)}<br>${shot.duration.toFixed(1)}s</small>`;
      meta.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });
      const rich = createRichEditor(node, shot.text, t("输入镜头描述；@ 插入参考标签", "Write shot description; @ inserts references"), (v) => { shot.text = v; save(); });
      richEditors.add(rich); rich.editor.addEventListener("focus", () => { state.selected = index; renderLane(); });
      const del = document.createElement("button"); del.type = "button"; del.className = "terry-tl-delete"; del.textContent = "×"; del.disabled = state.shots.length <= 1; del.title = t("删除镜头", "Delete shot"); del.addEventListener("click", () => deleteShot(index));
      row.append(meta, rich.editor, del); cards.append(row); cursor += shot.duration;
    });
  }

  function render() {
    durationRange.value = String(Math.round(state.total)); durationNumber.value = String(Math.round(state.total));
    durationLabel.textContent = `${t("总时长", "Total")} ${state.total.toFixed(0)}s / ${MAX_DURATION}s`;
    globalRich.setValue(state.global); soundBox.value = state.soundscape; musicBox.value = state.music; renderLane(); renderCards(); renderAudio(); save();
  }

  render();
  return {
    root, save,
    refresh() { state = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value); render(); },
    refreshAssets() { for (const rich of richEditors) rich.refreshAssets?.(); },
  };
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-style-v2")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-style-v2";
  style.textContent = `
.terry-h3-timeline-root{width:100%;box-sizing:border-box;padding:7px;font-family:Inter,system-ui,sans-serif;color:var(--input-text,#ddd)}
.terry-tl-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.terry-tl-header>b{font-size:12px;flex:1}.terry-tl-header>span{font-size:10px;opacity:.65;white-space:nowrap}.terry-tl-header input[type=range]{width:110px}.terry-tl-header input[type=number]{width:48px;height:24px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(0,0,0,.18);color:inherit;text-align:center;font-size:11px}
.terry-tl-section>label,.terry-tl-lane-head{font-size:10px;opacity:.65}.terry-tl-section>label{display:block;margin:0 0 4px}.terry-tl-section{margin-bottom:9px}
.terry-tl-rich{min-height:54px;width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid rgba(255,255,255,.11);border-radius:6px;background:rgba(0,0,0,.16);color:inherit;font:10.5px/1.55 ui-monospace,Consolas,monospace;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.terry-tl-rich:empty:before{content:attr(data-placeholder);opacity:.4;pointer-events:none}
.terry-tl-chip{display:inline-flex;align-items:center;gap:4px;margin:1px 2px;padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);font-size:10px;white-space:nowrap;vertical-align:middle}.terry-tl-chip img{width:24px;height:24px;object-fit:cover;border-radius:3px}.terry-tl-chip.is-subject{background:rgba(170,170,170,.10);font-weight:700;color:#aaa}.terry-tl-chip.is-picture{background:rgba(100,160,255,.13)}.terry-tl-chip.is-video{background:rgba(190,120,255,.13)}.terry-tl-chip.is-audio{background:rgba(255,165,90,.13)}.terry-tl-chip.is-dialogue{background:rgba(0,226,187,.12);color:rgba(190,255,244,.98)}.terry-tl-dialogue-lang{opacity:.65;font-size:9px}.terry-tl-dialogue-text{outline:none;min-width:30px}
.terry-tl-lane-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 4px}.terry-tl-lane-head button{height:25px;padding:0 9px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;font-size:10px}
.terry-tl-lane{position:relative;display:flex;width:100%;height:60px;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(0,0,0,.20);user-select:none;touch-action:none}.terry-tl-shot{position:relative;flex:0 0 auto;min-width:0;border:0;border-right:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.055);color:inherit;cursor:grab;overflow:hidden}.terry-tl-shot.is-selected{background:rgba(255,255,255,.14)}.terry-tl-shot.is-dragging{opacity:.35}.terry-tl-shot.is-drop{box-shadow:inset 3px 0 0 rgba(255,255,255,.75)}.terry-tl-shot b,.terry-tl-shot small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.terry-tl-shot b{font-size:10px}.terry-tl-shot small{margin-top:3px;font-size:9px;opacity:.6}.terry-tl-grip{position:absolute;left:5px;top:5px;font-size:10px;opacity:.35}.terry-tl-seam{position:absolute;z-index:8;top:0;width:12px;height:100%;cursor:ew-resize}.terry-tl-seam:after{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:2px;border-radius:2px;background:rgba(255,255,255,.65);box-shadow:0 0 0 1px rgba(0,0,0,.25)}.terry-tl-seam.is-active:after{width:3px;left:4px;background:#fff}
.terry-tl-cards{display:flex;flex-direction:column;gap:6px;margin-top:8px}.terry-tl-card{display:grid;grid-template-columns:76px minmax(0,1fr) 28px;gap:6px;align-items:start;padding:6px;border:1px solid rgba(255,255,255,.09);border-radius:6px;background:rgba(0,0,0,.10)}.terry-tl-card.is-selected{border-color:rgba(255,255,255,.20);background:rgba(255,255,255,.045)}.terry-tl-card .terry-tl-rich{min-height:64px}.terry-tl-meta{border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:2px}.terry-tl-meta b,.terry-tl-meta small{display:block}.terry-tl-meta b{font-size:10px}.terry-tl-meta small{margin-top:3px;font-size:9px;line-height:1.35;opacity:.56}.terry-tl-delete{width:26px;height:26px;border:1px solid rgba(255,255,255,.10);border-radius:5px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font-size:15px;opacity:.7}
.terry-tl-audio{display:grid;grid-template-columns:1fr;gap:5px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}.terry-tl-option{display:flex;align-items:center;gap:6px;font-size:10px;opacity:.75;cursor:pointer}.terry-tl-audio textarea{width:100%;resize:vertical;box-sizing:border-box;padding:6px 7px;border:1px solid rgba(255,255,255,.09);border-radius:5px;background:rgba(0,0,0,.15);color:inherit;font:10.5px/1.45 ui-monospace,Consolas,monospace;outline:none}
.terry-tl-footer{display:flex;justify-content:space-between;margin-top:6px;font-size:9px;opacity:.48}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3ShotTimeline",
  setup() { installStyle(); patchGraphToPrompt(); patchCanvas(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3TimelineInstalled) return;
    nodeType.prototype.__terryH3TimelineInstalled = true;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments); ensureSingleMediaInput(this);
      const editor = createEditor(this); this.__terryH3ShotTimeline = editor;
      const dom = this.addDOMWidget("terry_h3_shot_timeline", "terry_h3_shot_timeline", editor.root, { serialize: false, hideOnZoom: false, getMinHeight: () => 500, getMaxHeight: () => 1200 }); dom.serialize = false;
      this.setSize?.([Math.max(650, this.size?.[0] || 0), Math.max(620, this.size?.[1] || 0)]); return result;
    };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() { const result = added?.apply(this, arguments); ensureSingleMediaInput(this); return result; };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function(type, slotIndex, isConnected, linkInfo, ioSlot) {
      const result = connections?.apply(this, arguments);
      if (isConnected && type === 1) setTimeout(() => convertConnection(this, slotIndex, linkInfo), 0);
      return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const result = configure?.apply(this, arguments); setTimeout(() => { ensureSingleMediaInput(this); this.__terryH3ShotTimeline?.refresh?.(); }, 0); return result; };
  },
  loadedGraphNode(node) { if (isTarget(node)) setTimeout(() => { ensureSingleMediaInput(node); node.__terryH3ShotTimeline?.refresh?.(); }, 0); },
});