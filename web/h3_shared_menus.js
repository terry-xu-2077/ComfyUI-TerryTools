import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createH3TokenNode } from "./h3_rich_text.js";

const PROMPT_LINKS = "terry_h3_virtual_media_links";
const TIMELINE_LINKS = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_subject_bindings";
const FILTER_PROP = "terry_h3_asset_menu_filter";
const CARET = "\u200B";

const CATEGORY_META = [
  { id: "structure", label: "结构", icon: "§", detail: "H3 主字段与段落" },
  { id: "shot", label: "镜头", icon: "🎬", detail: "镜头分段、说话人与辅助标签" },
  { id: "dialogue", label: "对白", icon: "💬", detail: "对白块与连续性标签" },
  { id: "retention", label: "保留关系", icon: "◎", detail: "视觉与音频引用关系" },
  { id: "task", label: "任务类型", icon: "▣", detail: "Summary 的任务类型前缀" },
  { id: "camera", label: "镜头运动", icon: "◉", detail: "常用运镜方式与镜头运动" },
];

const CAMERA_COMMANDS = [
  ["推进", "Push In", "镜头向主体推进", "The camera pushes in "],
  ["拉远", "Pull Out", "镜头向后拉远", "The camera pulls out "],
  ["左摇", "Pan Left", "镜头水平向左摇动", "The camera pans left "],
  ["右摇", "Pan Right", "镜头水平向右摇动", "The camera pans right "],
  ["左移", "Truck Left", "摄像机整体向左平移", "The camera trucks left "],
  ["右移", "Truck Right", "摄像机整体向右平移", "The camera trucks right "],
  ["上摇", "Tilt Up", "镜头向上俯仰摇动", "The camera tilts up "],
  ["下摇", "Tilt Down", "镜头向下俯仰摇动", "The camera tilts down "],
  ["升镜", "Pedestal Up", "摄像机整体向上升起", "The camera moves upward "],
  ["降镜", "Pedestal Down", "摄像机整体向下降低", "The camera moves downward "],
  ["环绕", "Arc Shot", "摄像机沿弧线环绕主体", "The camera moves in an arc around the subject "],
  ["跟拍", "Tracking Shot", "镜头跟随移动中的主体", "The camera follows the moving subject in a tracking shot "],
  ["固定镜头", "Static Shot", "摄像机保持固定不动", "The camera holds a static shot "],
  ["变焦推近", "Zoom In", "通过镜头变焦放大画面", "The camera zooms in "],
  ["变焦拉远", "Zoom Out", "通过镜头变焦缩小画面", "The camera zooms out "],
  ["第一人称视角", "POV", "使用角色的主观视角", "POV, "],
  ["顺时针旋转", "Roll Clockwise", "镜头沿光轴顺时针旋转", "The camera rolls clockwise "],
  ["逆时针旋转", "Roll Counterclockwise", "镜头沿光轴逆时针旋转", "The camera rolls counterclockwise "],
  ["轻微晃动", "Shake Slightly", "镜头产生轻微手持晃动", "The camera shakes slightly "],
  ["强烈晃动", "Shake Strongly", "镜头产生明显剧烈晃动", "The camera shakes strongly "],
];

const controllers = new WeakMap();
let styleInstalled = false;

function linksProp(mode) { return mode === "timeline" ? TIMELINE_LINKS : PROMPT_LINKS; }
function links(node, mode) {
  node.properties ||= {};
  const value = node.properties[linksProp(mode)];
  return Array.isArray(value) ? value : [];
}
function graphNode(node, id) { return node?.graph?.getNodeById?.(Number(id)) || app.graph?.getNodeById?.(Number(id)) || null; }
function kindOf(src, slot, fallback = "") {
  const type = String(src?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  return "picture";
}
function filename(src, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename", "video_file", "videofile"] : ["audio", "file", "filename", "audio_file", "audiofile"];
  for (const widget of src?.widgets || []) {
    const value = widget?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name) : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    if (preferred.includes(String(widget?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}
function preview(src, kind) {
  if (!src || kind === "audio") return "";
  const file = filename(src, kind);
  if (file) {
    const widget = (src.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = widget?.value;
    const query = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) query.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
  }
  return (src.imgs || []).find((item) => item?.src)?.src || "";
}
function assets(node, mode) {
  const count = { picture: 0, video: 0, audio: 0 }, out = [], seen = new Set();
  for (const link of links(node, mode)) {
    const id = Number(link?.source_id), slot = Number(link?.source_slot) || 0, key = `${id}:${slot}`;
    if (!Number.isFinite(id) || seen.has(key)) continue;
    const src = graphNode(node, id);
    if (!src) continue;
    seen.add(key);
    const kind = link.kind || kindOf(src, slot, link.source_type);
    count[kind] = (count[kind] || 0) + 1;
    const index = count[kind];
    const english = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    const chinese = kind === "picture" ? `图片 ${index}` : kind === "video" ? `视频 ${index}` : `音频 ${index}`;
    out.push({ key, kind, index, raw: `<${english}>`, label: english, displayLabel: chinese, src, name: filename(src, kind).split(/[\\/]/).pop() || src.title || english, preview: preview(src, kind) });
  }
  return out;
}
function promptText(node, mode) {
  const names = mode === "timeline" ? ["compiled_prompt", "timeline_state"] : ["prompt"];
  return names.map((name) => String(node?.widgets?.find?.((w) => w?.name === name)?.value || "")).join("\n");
}
function bindings(node) {
  node.properties ||= {};
  const value = node.properties[BINDINGS_PROP];
  if (!value || typeof value !== "object" || Array.isArray(value)) node.properties[BINDINGS_PROP] = {};
  return node.properties[BINDINGS_PROP];
}
function nextSubject(node, mode) {
  const used = new Set();
  for (const match of promptText(node, mode).matchAll(/<Subject\s+(\d+)>/gi)) used.add(Number(match[1]));
  for (const list of Object.values(bindings(node))) for (const n of Array.isArray(list) ? list : []) used.add(Number(n));
  let n = 1; while (used.has(n)) n += 1; return n;
}
function subjectFor(node, mode, asset) {
  const map = bindings(node); map[asset.key] ||= [];
  if (map[asset.key][0]) return Number(map[asset.key][0]);
  const n = nextSubject(node, mode); map[asset.key].push(n); app.graph?.change?.(); return n;
}
function isDirectUsed(node, mode, asset) { return new RegExp(`<${asset.label.replace(/\s+/g, "\\s+")}>`, "i").test(promptText(node, mode)); }
function definitionParts(node, mode, asset) {
  const parts = (bindings(node)[asset.key] || []).map((n) => `主体 ${Number(n)}`).filter((x) => !x.endsWith("NaN"));
  if (isDirectUsed(node, mode, asset)) parts.push(asset.displayLabel);
  return parts;
}
function cleanDefinition(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/^[\s:：,，.。;；-]+/, "").replace(/\s+/g, " ").trim();
}
function definitionMap(node, mode) {
  const source = promptText(node, mode).replace(/\r\n?/g, "\n");
  const map = new Map();
  const re = /<(Subject|Picture|Video|Audio)\s+(\d+)>\s*(?:is\b|[:：-])?\s*([\s\S]*?)(?=\n\s*<(?:Subject|Picture|Video|Audio)\s+\d+>|\n\s*(?:summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:|$)/gi;
  for (const match of source.matchAll(re)) {
    const key = `${match[1].toLowerCase()}:${Number(match[2])}`;
    const description = cleanDefinition(match[3]);
    if (description) map.set(key, description);
  }
  return map;
}
function referencedDescription(node, mode, asset, definitions) {
  for (const n of bindings(node)[asset.key] || []) {
    const description = definitions.get(`subject:${Number(n)}`);
    if (description) return description;
  }
  const direct = definitions.get(`${asset.kind}:${asset.index}`) || definitions.get(`${asset.kind === "picture" ? "picture" : asset.kind}:${asset.index}`);
  return direct || definitionParts(node, mode, asset).join(" · ");
}
function caretRange(editor, trigger) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
  const match = before.match(trigger === "@" ? /@([^@\n]*)$/ : /\/([^/\n]*)$/);
  if (!match) return null;
  const range = document.createRange(); range.setStart(caret.startContainer, caret.startOffset - match[0].length); range.setEnd(caret.startContainer, caret.startOffset);
  return { range, query: String(match[1] || "").trim().toLowerCase() };
}
function createToken(controller, raw, asset = null) {
  return createH3TokenNode(raw, {
    onChange: controller.onChange,
    ...(controller.mode === "timeline" ? { extraChipClass: "terry-tl-chip" } : {}),
    ...(asset ? {
      resolveMedia(kind, index) {
        return asset.kind === kind && asset.index === Number(index)
          ? { preview: asset.preview, source: asset.name }
          : null;
      },
    } : {}),
  });
}
function insertAt(editor, range, content, onChange) {
  range.deleteContents();
  const marker = document.createTextNode(CARET), fragment = document.createDocumentFragment();
  if (Array.isArray(content)) content.forEach((item) => fragment.append(item)); else fragment.append(content);
  fragment.append(marker); range.insertNode(fragment);
  const selection = window.getSelection?.();
  if (selection) { const next = document.createRange(); next.setStart(marker, marker.textContent.length); next.collapse(true); selection.removeAllRanges(); selection.addRange(next); }
  onChange?.(); editor.dispatchEvent(new Event("terrychange", { bubbles: true })); editor.focus({ preventScroll: true });
}
function menuButton(label, title = "", className = "") {
  const button = document.createElement("button"); button.type = "button"; button.className = `terry-h3-role-action${className ? ` ${className}` : ""}`; button.textContent = label; button.title = title; return button;
}
function placeMenu(menu, editor, width = 470, maxHeight = 560) {
  if (menu.parentElement !== document.body) document.body.append(menu);
  const selection = window.getSelection?.();
  const caretRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const editorRect = editor.getBoundingClientRect(); const rect = caretRect && (caretRect.width || caretRect.height) ? caretRect : editorRect;
  const measuredHeight = Math.min(maxHeight, menu.offsetHeight || 400);
  let left = rect.left, top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + measuredHeight > window.innerHeight - 8) top = Math.max(8, rect.top - measuredHeight - 6);
  Object.assign(menu.style, { position: "fixed", left: `${Math.max(8, Math.round(left))}px`, top: `${Math.max(8, Math.round(top))}px`, zIndex: "2147483000", isolation: "isolate", pointerEvents: "auto" });
}
function closeMenu(controller) { controller.menu?.remove?.(); controller.menu = null; controller.menuType = null; controller.commandState = null; }
function currentFilter(node) { return String(node?.properties?.[FILTER_PROP] || "subject"); }
function setFilter(node, value) { node.properties ||= {}; node.properties[FILTER_PROP] = value; app.graph?.change?.(); }
function insertMediaReference(controller, hit, asset) {
  insertAt(controller.editor, hit.range, createToken(controller, asset.raw, asset), controller.onChange);
  closeMenu(controller);
}
function insertSubjectReference(controller, hit, asset, subjectNumber = null) {
  const number = Number(subjectNumber) || subjectFor(controller.node, controller.mode, asset);
  insertAt(controller.editor, hit.range, createToken(controller, `<Subject ${number}>`), controller.onChange);
  controller.node?.__terryH3RefreshSubjectThumbnails?.();
  closeMenu(controller);
}

function openAssetMenu(controller) {
  const { node, editor, mode } = controller;
  const hit = caretRange(editor, "@"); if (!hit) { closeMenu(controller); return false; }
  closeMenu(controller);
  const all = assets(node, mode).filter((asset) => !hit.query || `${asset.name} ${asset.label} ${asset.displayLabel} ${asset.kind}`.toLowerCase().includes(hit.query));
  const defined = all.filter((asset) => definitionParts(node, mode, asset).length > 0);
  const definitions = definitionMap(node, mode);
  let filter = currentFilter(node);
  if (!new Set(["subject", "picture", "defined"]).has(filter)) filter = "subject";
  if (filter === "defined" && !defined.length) filter = "subject";

  const menu = document.createElement("div"); menu.className = "terry-h3-role-menu terry-h3-shared-module-menu"; controller.menu = menu; controller.menuType = "asset"; document.body.append(menu);
  const legend = document.createElement("div"); legend.className = "terry-h3-role-legend";
  const title = document.createElement("div"); title.className = "terry-h3-role-title"; title.innerHTML = "<b>引用参考</b><span>选择资产在 H3 中的使用方式</span>";
  const tabs = document.createElement("div"); tabs.className = "terry-h3-role-tabs";
  const addTab = (value, label) => {
    const button = menuButton(label, "", filter === value ? "is-active" : "");
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); setFilter(node, value); controller.savedRange = hit.range.cloneRange(); queueMicrotask(() => openAssetMenu(controller)); });
    tabs.append(button);
  };
  addTab("subject", "主体参考"); addTab("picture", "画面参考"); if (defined.length) addTab("defined", "已引用参考");
  legend.append(title, tabs); menu.append(legend);

  const visible = filter === "defined" ? defined : filter === "subject" ? all.filter((asset) => asset.kind !== "audio") : all;
  for (const asset of visible) {
    const row = document.createElement("div"); row.className = `terry-h3-role-row is-selectable${filter === "defined" ? " is-defined" : ""}`;
    const thumb = document.createElement("div"); thumb.className = `terry-h3-role-thumb is-${asset.kind}`;
    if (asset.preview && asset.kind !== "audio") { const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img); }
    else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const info = document.createElement("div"); info.className = "terry-h3-role-info";
    const name = document.createElement("b"); name.textContent = asset.name;
    const meta = document.createElement("small");
    meta.textContent = filter === "defined" ? referencedDescription(node, mode, asset, definitions) : `${asset.kind === "picture" ? "图片" : asset.kind === "video" ? "视频" : "音频"}资产 · ${asset.displayLabel}`;
    info.append(name, meta);
    row.append(thumb, info);
    row.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (filter === "subject") {
        insertSubjectReference(controller, hit, asset);
        return;
      }
      if (filter === "picture") {
        insertMediaReference(controller, hit, asset);
        return;
      }
      const subjectNumber = (bindings(node)[asset.key] || []).map(Number).find(Number.isFinite);
      if (subjectNumber) insertSubjectReference(controller, hit, asset, subjectNumber);
      else insertMediaReference(controller, hit, asset);
    });
    menu.append(row);
  }
  if (!visible.length) { const empty = document.createElement("div"); empty.className = "terry-h3-role-empty"; empty.textContent = "没有匹配的参考资产。"; menu.append(empty); }
  placeMenu(menu, editor, 470, 560); return true;
}

function nextSpeaker(node, mode) { let max = 0; for (const match of promptText(node, mode).matchAll(/\(S(\d+)\)/gi)) max = Math.max(max, Number(match[1]) || 0); return max + 1; }
function nextShot(node, mode) { let max = 0; for (const match of promptText(node, mode).matchAll(/\[\s*Shot\s+(\d+)\s*\]/gi)) max = Math.max(max, Number(match[1]) || 0); return max + 1; }
function defaultDialogueLanguage() {
  let locale = "en";
  try {
    locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale")
      || document?.documentElement?.lang
      || navigator.language
      || locale;
  } catch {}
  const code = String(locale).trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return {
    ar: "Arabic", de: "German", en: "English", es: "Spanish", fr: "French",
    hi: "Hindi", id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean",
    nl: "Dutch", pl: "Polish", pt: "Portuguese", ru: "Russian", th: "Thai",
    tr: "Turkish", vi: "Vietnamese", yue: "Cantonese", zh: "Chinese",
  }[code] || "English";
}
function commands(node, mode) {
  const shot = nextShot(node, mode);
  const speaker = nextSpeaker(node, mode);
  const list = [
    { category: "structure", label: "subject_definitions", detail: "定义 Subject / Picture / Video / Audio 的引用角色", raw: "subject_definitions:" },
    { category: "structure", label: "summary", detail: "任务类型与主要引用关系摘要", raw: "summary:" },
    { category: "structure", label: "retention_analysis", detail: "逐项说明引用内容如何被保留或迁移", raw: "retention_analysis:" },
    { category: "structure", label: "detailed_description", detail: "逐镜头详细描述", raw: "detailed_description:" },
    { category: "structure", label: "integrated_multimodal_description", detail: "T2VA / I2VA / FL2VA / L2VA 主字段", raw: "integrated_multimodal_description:" },
    { category: "structure", label: "overall_soundscape", detail: "环境声、动作声与非语言人声汇总", raw: "overall_soundscape:" },
    { category: "structure", label: "non_diegetic_music", detail: "非剧情内音乐", raw: "non_diegetic_music:" },
    { category: "shot", label: `[Shot ${shot}]`, detail: `插入第 ${shot} 个镜头分段标签`, raw: `[Shot ${shot}]` },
    { category: "shot", label: `Speaker S${speaker}`, detail: "插入下一个全局说话人编号", raw: `(S${speaker})`, kind: "speaker" },
    { category: "dialogue", label: "对白块", detail: "插入可编辑对白块", raw: `<d>[${defaultDialogueLanguage()}] </d>`, kind: "dialogue" },
    { category: "dialogue", label: "scenetrans", detail: "对白或音频跨镜头连续", raw: "<scenetrans>" },
    { category: "dialogue", label: "cutoff", detail: "对白被镜头或剪辑截断", raw: "<cutoff>" },
    ...[["fully_preserved","定义的视觉引用角色被完整保留"],["partially_preserved","仍使用引用内容，但部分特征被改变"],["attribute_transfer","把引用特征迁移到另一个可识别主体"],["weak_reference","仅保留宽泛风格、类别、构图或氛围"],["fully_copy","完整复制源音频信号"],["partially_copy","只复制部分时间或音频层"],["reference","只参考音色、节奏、内容或声音质感"]].map(([raw, detail]) => ({ category: "retention", label: raw, detail, raw })),
    ...[["reference generation","参考生成"],["keyframe completion","关键帧补全"],["video editing","直接编辑已有视频"],["video continuation","从已有视频继续生成"],["audio reuse","直接复用同一音频信号"],["audio reference","只参考音频特征而不复制信号"]].map(([raw, detail]) => ({ category: "task", label: raw, detail, raw: `[${raw}]` })),
    ...CAMERA_COMMANDS.map(([chinese, english, detail, raw]) => ({
      category: "camera",
      label: `${chinese} · ${english}`,
      detail,
      raw,
    })),
  ];
  return mode === "timeline" ? list.filter((item) => item.category !== "shot") : list;
}
function category(id) { return CATEGORY_META.find((item) => item.id === id) || { id, label: id, icon: "›", detail: "" }; }
function chooseCommand(controller, state, command) {
  const token = createToken(controller, command.raw || "");
  insertAt(controller.editor, state.range, token, controller.onChange);
  closeMenu(controller);
  if (command.kind !== "dialogue") return;
  const body = token.querySelector?.(".terry-h3-dialogue-text");
  if (body) {
    body.focus?.({ preventScroll: true });
    const selection = window.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}
function renderCommandMenu(controller, state) {
  const menu = controller.menu; if (!menu) return; menu.replaceChildren();
  const search = Boolean(state.query), head = document.createElement("div"); head.className = "terry-h3-command-head";
  const title = document.createElement("div"); title.className = "terry-h3-command-head-title";
  if (state.category && !search) { const back = document.createElement("button"); back.type = "button"; back.className = "terry-h3-command-back"; back.textContent = "‹"; back.addEventListener("pointerdown", (event) => { event.preventDefault(); state.category = null; state.active = 0; renderCommandMenu(controller, state); }); title.append(back); }
  const bold = document.createElement("b"); bold.textContent = search ? "搜索 H3 语法" : state.category ? category(state.category).label : "H3 语法"; title.append(bold);
  const hint = document.createElement("span"); hint.textContent = search ? `“${state.query}”` : state.category ? "← 返回 · ↑↓ 选择" : "选择分类 · 也可继续输入关键词"; head.append(title, hint); menu.append(head);
  if (!state.category && !search) state.options = CATEGORY_META.map((meta) => ({ type: "category", meta, count: state.list.filter((item) => item.category === meta.id).length })).filter((item) => item.count > 0);
  else state.options = (state.category && !search ? state.list.filter((item) => item.category === state.category) : state.list).map((command) => ({ type: "command", command }));
  state.active = Math.min(state.active, Math.max(0, state.options.length - 1));
  state.options.forEach((option, index) => {
    const item = document.createElement("button"); item.type = "button"; item.className = `terry-h3-command-item${index === state.active ? " is-active" : ""}${option.type === "category" ? " is-category" : ""}`;
    if (option.type === "category") {
      const icon = document.createElement("span"); icon.className = "terry-h3-command-category-icon"; icon.textContent = option.meta.icon;
      const text = document.createElement("span"); text.className = "terry-h3-command-text"; text.innerHTML = `<b>${option.meta.label}</b><small>${option.meta.detail}</small>`;
      const count = document.createElement("span"); count.className = "terry-h3-command-count"; count.textContent = `${option.count} ›`; item.append(icon, text, count);
      item.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); state.category = option.meta.id; state.active = 0; renderCommandMenu(controller, state); });
    } else {
      const cat = document.createElement("span"); cat.className = "terry-h3-command-category"; cat.textContent = category(option.command.category).label;
      const text = document.createElement("span"); text.className = "terry-h3-command-text"; text.innerHTML = `<b>${option.command.label}</b><small>${option.command.detail || option.command.raw}</small>`; item.append(cat, text);
      item.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); chooseCommand(controller, state, option.command); });
    }
    item.addEventListener("pointermove", () => { if (state.active !== index) { state.active = index; renderCommandMenu(controller, state); } }); menu.append(item);
  });
  placeMenu(menu, controller.editor, 340, 380);
}
function openCommandMenu(controller) {
  const hit = caretRange(controller.editor, "/"); if (!hit) { closeMenu(controller); return false; }
  closeMenu(controller); let list = commands(controller.node, controller.mode);
  if (hit.query) list = list.filter((item) => `${item.label} ${category(item.category).label} ${item.detail} ${item.raw}`.toLowerCase().includes(hit.query));
  const menu = document.createElement("div"); menu.className = "terry-h3-command-menu terry-h3-shared-module-menu"; document.body.append(menu); controller.menu = menu; controller.menuType = "command";
  const state = { range: hit.range, query: hit.query, category: null, active: 0, options: [], list }; controller.commandState = state; renderCommandMenu(controller, state); return true;
}
function refreshOpenMenu(controller) { if (controller.menuType === "asset") openAssetMenu(controller); else if (controller.menuType === "command") openCommandMenu(controller); }
function handleCommandKey(controller, event) {
  const state = controller.commandState; if (!state || controller.menuType !== "command") return false;
  if (event.key === "Escape") { closeMenu(controller); return true; }
  if (event.key === "ArrowLeft" && state.category && !state.query) { state.category = null; state.active = 0; renderCommandMenu(controller, state); return true; }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { if (state.options.length) { state.active = (state.active + (event.key === "ArrowDown" ? 1 : -1) + state.options.length) % state.options.length; renderCommandMenu(controller, state); controller.menu?.querySelector?.(".is-active")?.scrollIntoView?.({ block: "nearest" }); } return true; }
  if (["ArrowRight", "Enter", "Tab"].includes(event.key)) { const option = state.options[state.active]; if (!option) return false; if (option.type === "category") { state.category = option.meta.id; state.active = 0; renderCommandMenu(controller, state); } else chooseCommand(controller, state, option.command); return true; }
  return false;
}

export function installH3MenuStyles() {
  if (styleInstalled || document.getElementById("terry-h3-shared-menu-module-style")) return;
  styleInstalled = true;
  const style = document.createElement("style"); style.id = "terry-h3-shared-menu-module-style";
  style.textContent = `
.terry-h3-shared-module-menu{position:fixed!important;z-index:2147483000!important;isolation:isolate!important;pointer-events:auto!important;box-sizing:border-box;color:var(--input-text,#ddd);font-family:Inter,system-ui,sans-serif}
.terry-h3-role-menu{width:470px;max-height:560px;overflow:auto;padding:10px;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:var(--comfy-menu-bg,#17191c);box-shadow:0 18px 48px rgba(0,0,0,.52)}
.terry-h3-role-legend{padding:0 2px 10px;border-bottom:1px solid rgba(255,255,255,.10)}
.terry-h3-role-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.terry-h3-role-title>b{font-size:13px}.terry-h3-role-title>span{font-size:10px;opacity:.5}
.terry-h3-role-tabs{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.terry-h3-role-action{min-height:28px;padding:3px 9px;border:1px solid rgba(255,255,255,.13);border-radius:6px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font-size:11px;white-space:nowrap}.terry-h3-role-action.is-active{border-color:rgba(0,226,187,.38);background:rgba(0,226,187,.12);color:rgba(205,255,246,.98)}
.terry-h3-role-row{display:grid;grid-template-columns:54px minmax(0,1fr);gap:10px;align-items:center;padding:9px 7px;border-bottom:1px solid rgba(255,255,255,.055);border-radius:7px}.terry-h3-role-row.is-selectable{cursor:pointer}.terry-h3-role-row.is-selectable:hover{background:rgba(255,255,255,.07)}.terry-h3-role-thumb{width:52px;height:52px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.07);display:grid;place-items:center}.terry-h3-role-thumb img{width:100%;height:100%;object-fit:cover}.terry-h3-role-info{min-width:0}.terry-h3-role-info b,.terry-h3-role-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-role-info b{font-size:11px}.terry-h3-role-info small{margin-top:3px;font-size:9.5px;opacity:.52}.terry-h3-role-row.is-defined .terry-h3-role-info small{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}.terry-h3-role-empty{padding:18px 8px;text-align:center;font-size:11px;opacity:.55}
.terry-h3-command-menu{width:340px;max-height:380px;overflow:auto;padding:6px;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:var(--comfy-menu-bg,#17191c);box-shadow:0 18px 48px rgba(0,0,0,.52)}
.terry-h3-command-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 6px 8px;border-bottom:1px solid rgba(255,255,255,.08)}.terry-h3-command-head-title{display:flex;align-items:center;gap:5px}.terry-h3-command-head span{font-size:9px;opacity:.48}.terry-h3-command-back{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}.terry-h3-command-item{display:grid;grid-template-columns:70px minmax(0,1fr);gap:7px;align-items:center;width:100%;padding:7px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}.terry-h3-command-item.is-category{grid-template-columns:28px minmax(0,1fr) auto}.terry-h3-command-item.is-active{background:rgba(255,255,255,.09)}.terry-h3-command-category,.terry-h3-command-category-icon,.terry-h3-command-count{font-size:9px;opacity:.55}.terry-h3-command-text{min-width:0}.terry-h3-command-text b,.terry-h3-command-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-command-text b{font-size:11px}.terry-h3-command-text small{margin-top:2px;font-size:9px;opacity:.5}
`;
  document.head.append(style);
}

export function attachH3Menus({ node, editor, mode = "prompt", onChange = null }) {
  if (!node || !editor) return null;
  detachH3Menus(editor); installH3MenuStyles();
  const controller = { node, editor, mode, onChange, menu: null, menuType: null, commandState: null }; controllers.set(editor, controller);
  const onBeforeInput = (event) => { if (event.inputType !== "insertText" || (event.data !== "@" && event.data !== "/")) return; const trigger = event.data; setTimeout(() => trigger === "@" ? openAssetMenu(controller) : openCommandMenu(controller), 0); };
  const onInput = () => { if (controller.menu) queueMicrotask(() => refreshOpenMenu(controller)); };
  const onKeyDown = (event) => { if (handleCommandKey(controller, event)) { event.preventDefault(); event.stopPropagation(); return; } if (event.key === "Escape" && controller.menu) { closeMenu(controller); event.preventDefault(); event.stopPropagation(); } };
  const onBlur = () => setTimeout(() => { if (!controller.menu?.matches?.(":hover")) closeMenu(controller); }, 120);
  const onPointer = (event) => event.stopPropagation();
  editor.addEventListener("beforeinput", onBeforeInput); editor.addEventListener("input", onInput); editor.addEventListener("keydown", onKeyDown); editor.addEventListener("blur", onBlur); editor.addEventListener("pointerdown", onPointer);
  controller.cleanup = () => { closeMenu(controller); editor.removeEventListener("beforeinput", onBeforeInput); editor.removeEventListener("input", onInput); editor.removeEventListener("keydown", onKeyDown); editor.removeEventListener("blur", onBlur); editor.removeEventListener("pointerdown", onPointer); };
  return controller;
}
export function detachH3Menus(editor) { const controller = controllers.get(editor); controller?.cleanup?.(); controllers.delete(editor); }
