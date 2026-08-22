import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
const CARET = "\u200B";
const SECTION_RAW = new Set([
  "subject_definitions:", "summary:", "retention_analysis:",
  "detailed_description:", "integrated_multimodal_description:",
  "overall_soundscape:", "non_diegetic_music:",
]);

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function classifyChip(chip) {
  if (!chip?.classList) return;
  const raw = String(chip.dataset?.raw || "").trim();
  chip.classList.remove(
    "terry-h3-type-section", "terry-h3-type-subject", "terry-h3-type-picture",
    "terry-h3-type-video", "terry-h3-type-audio", "terry-h3-type-shot",
    "terry-h3-type-speaker", "terry-h3-type-dialogue", "terry-h3-type-retention",
    "terry-h3-type-time", "terry-h3-type-transition", "terry-h3-type-task"
  );
  if (SECTION_RAW.has(raw)) chip.classList.add("terry-h3-type-section");
  else if (/^<Subject\s+\d+>$/i.test(raw)) chip.classList.add("terry-h3-type-subject");
  else if (/^<Picture\s+\d+>$/i.test(raw)) chip.classList.add("terry-h3-type-picture");
  else if (/^<Video\s+\d+>$/i.test(raw)) chip.classList.add("terry-h3-type-video");
  else if (/^<Audio\s+\d+>$/i.test(raw)) chip.classList.add("terry-h3-type-audio");
  else if (/^\[Shot\s+\d+\]$/i.test(raw)) chip.classList.add("terry-h3-type-shot");
  else if (/^\(S\d+\)$/i.test(raw)) chip.classList.add("terry-h3-type-speaker");
  else if (chip.classList.contains("terry-h3-dialogue")) chip.classList.add("terry-h3-type-dialogue");
  else if (/^(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)$/i.test(raw)) chip.classList.add("terry-h3-type-retention");
  else if (/^\d{2}:\d{2}\.\d{3}$/.test(raw)) chip.classList.add("terry-h3-type-time");
  else if (/^<(scenetrans|cutoff)>$/i.test(raw)) chip.classList.add("terry-h3-type-transition");
  else if (/^\[(reference generation|keyframe completion|video editing|video continuation|audio reuse|audio reference)(\s*\+[^\]]+)?\]$/i.test(raw)) chip.classList.add("terry-h3-type-task");
}

function decorate(editor) {
  for (const chip of editor?.querySelectorAll?.(".terry-h3-chip") || []) classifyChip(chip);
}

function closePicker(node) {
  node.__terryH3ShotPicker?.remove?.();
  node.__terryH3ShotPicker = null;
}

function promptWidget(node) {
  return node?.widgets?.find((w) => w?.name === "prompt") || null;
}

function maxShot(node) {
  let max = 0;
  const raw = String(promptWidget(node)?.value || "");
  for (const m of raw.matchAll(/\[Shot\s+(\d+)\]/gi)) max = Math.max(max, Number(m[1]) || 0);
  return Math.max(1, max);
}

function maxSpeaker(node) {
  let max = 0;
  const raw = String(promptWidget(node)?.value || "");
  for (const m of raw.matchAll(/\(S(\d+)\)/gi)) max = Math.max(max, Number(m[1]) || 0);
  return Math.max(1, max);
}

function setShotNumber(node, chip, number) {
  number = Math.max(1, Math.floor(Number(number) || 1));
  chip.dataset.raw = `[Shot ${number}]`;
  const label = [...chip.children].reverse().find((el) => el.tagName === "SPAN") || chip;
  label.textContent = `镜头 ${number}`;
  chip.title = `镜头 ${number} · 点击切换序号`;
  chip.closest(".terry-h3-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  app.graph?.change?.();
  closePicker(node);
}

function setSpeakerNumber(node, chip, number) {
  number = Math.max(1, Math.floor(Number(number) || 1));
  chip.dataset.raw = `(S${number})`;
  const label = [...chip.children].reverse().find((el) => el.tagName === "SPAN") || chip;
  label.textContent = `说话人 S${number}`;
  chip.title = `说话人 S${number} · 点击切换序号`;
  chip.closest(".terry-h3-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  app.graph?.change?.();
  closePicker(node);
}

function openNumberPicker(node, chip, type) {
  closePicker(node);
  const current = Number(String(chip.dataset.raw || "").match(/\d+/)?.[0] || 1);
  const max = type === "speaker" ? maxSpeaker(node) : maxShot(node);
  const menu = document.createElement("div");
  menu.className = "terry-h3-shot-picker";
  const head = document.createElement("div");
  head.className = "terry-h3-shot-picker-head";
  head.textContent = type === "speaker" ? "切换说话人序号" : "切换镜头序号";
  menu.append(head);

  const grid = document.createElement("div");
  grid.className = "terry-h3-shot-picker-grid";
  const limit = Math.max(max + 1, current, 6);
  for (let i = 1; i <= limit; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = type === "speaker" ? `S${i}` : String(i);
    if (i === current) b.classList.add("is-current");
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (type === "speaker") setSpeakerNumber(node, chip, i);
      else setShotNumber(node, chip, i);
    });
    grid.append(b);
  }
  menu.append(grid);

  const custom = document.createElement("div");
  custom.className = "terry-h3-shot-picker-custom";
  const input = document.createElement("input");
  input.type = "number"; input.min = "1"; input.step = "1"; input.value = String(current);
  const apply = document.createElement("button");
  apply.type = "button"; apply.textContent = "应用";
  const commit = () => type === "speaker" ? setSpeakerNumber(node, chip, input.value) : setShotNumber(node, chip, input.value);
  apply.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); commit(); });
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } });
  custom.append(input, apply); menu.append(custom);

  document.body.append(menu);
  node.__terryH3ShotPicker = menu;
  const rect = chip.getBoundingClientRect();
  const width = 230;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + 190 > window.innerHeight - 8) top = Math.max(8, rect.top - 196);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function openShotPicker(node, chip) {
  openNumberPicker(node, chip, "shot");
}

function openSpeakerPicker(node, chip) {
  openNumberPicker(node, chip, "speaker");
}

function bindEditor(node) {
  const editor = node?.__terryH3Editor;
  if (!editor) return false;
  decorate(editor);
  if (editor.__terryTypeColorsBound) return true;
  editor.__terryTypeColorsBound = true;

  editor.addEventListener("pointerdown", (event) => {
    const chip = event.target?.closest?.(".terry-h3-chip");
    if (!chip || !editor.contains(chip)) return;
    classifyChip(chip);
    const isShot = chip.classList.contains("terry-h3-type-shot");
    const isSpeaker = chip.classList.contains("terry-h3-type-speaker");
    if (!isShot && !isSpeaker) return;
    event.preventDefault();
    event.stopPropagation();
    if (isSpeaker) openSpeakerPicker(node, chip);
    else openShotPicker(node, chip);
  }, true);

  const observer = new MutationObserver(() => decorate(editor));
  observer.observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-raw"] });
  editor.__terryTypeColorsObserver = observer;
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => {
    attempts += 1;
    if (bindEditor(node) || attempts >= 15) return;
    setTimeout(run, Math.min(1000, attempts * 70));
  };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-type-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-type-style";
  style.textContent = `
.terry-h3-chip:not(.terry-h3-type-section){transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
.terry-h3-type-section{
  display:inline!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;
  background:transparent!important;box-shadow:none!important;color:rgba(205,205,205,.66)!important;
  font-weight:700!important;font-size:12px!important;letter-spacing:.01em!important;
}
.terry-h3-type-subject{background:rgba(180,140,255,.13)!important;color:rgb(220,202,255)!important;box-shadow:inset 0 0 0 1px rgba(180,140,255,.25)!important}
.terry-h3-type-picture{background:rgba(0,210,180,.12)!important;color:rgb(184,255,242)!important;box-shadow:inset 0 0 0 1px rgba(0,210,180,.24)!important}
.terry-h3-type-video{background:rgba(76,170,255,.13)!important;color:rgb(194,226,255)!important;box-shadow:inset 0 0 0 1px rgba(76,170,255,.25)!important}
.terry-h3-type-audio{background:rgba(255,174,70,.12)!important;color:rgb(255,224,183)!important;box-shadow:inset 0 0 0 1px rgba(255,174,70,.24)!important}
.terry-h3-type-shot{background:rgba(255,215,75,.13)!important;color:rgb(255,236,166)!important;box-shadow:inset 0 0 0 1px rgba(255,215,75,.25)!important;cursor:pointer!important}
.terry-h3-type-shot:hover{background:rgba(255,215,75,.2)!important}
.terry-h3-type-speaker{background:rgba(255,120,160,.12)!important;color:rgb(255,203,219)!important;box-shadow:inset 0 0 0 1px rgba(255,120,160,.24)!important;cursor:pointer!important}
.terry-h3-type-speaker:hover{background:rgba(255,120,160,.19)!important}
.terry-h3-type-dialogue{background:rgba(0,226,187,.13)!important;color:rgb(190,255,244)!important;box-shadow:inset 0 0 0 1px rgba(0,226,187,.22)!important}
.terry-h3-type-retention{background:rgba(145,155,175,.12)!important;color:rgb(220,225,235)!important;box-shadow:inset 0 0 0 1px rgba(170,180,200,.2)!important}
.terry-h3-type-time{background:rgba(110,190,255,.1)!important;color:rgb(196,229,255)!important;box-shadow:inset 0 0 0 1px rgba(110,190,255,.2)!important}
.terry-h3-type-transition{background:rgba(255,145,95,.11)!important;color:rgb(255,213,191)!important;box-shadow:inset 0 0 0 1px rgba(255,145,95,.22)!important}
.terry-h3-type-task{background:rgba(128,205,125,.11)!important;color:rgb(207,245,205)!important;box-shadow:inset 0 0 0 1px rgba(128,205,125,.22)!important}
.terry-h3-shot-picker{position:fixed;z-index:10140;width:230px;padding:7px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:var(--comfy-menu-bg,#202225);box-shadow:0 16px 38px rgba(0,0,0,.48);color:var(--input-text,#ddd)}
.terry-h3-shot-picker-head{padding:3px 4px 7px;font:600 11px/1.2 system-ui,sans-serif;opacity:.75}
.terry-h3-shot-picker-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.terry-h3-shot-picker-grid button,.terry-h3-shot-picker-custom button{height:28px;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
.terry-h3-shot-picker-grid button:hover,.terry-h3-shot-picker-grid button.is-current{background:rgba(255,215,75,.2);color:rgb(255,236,166)}
.terry-h3-shot-picker-custom{display:grid;grid-template-columns:1fr 54px;gap:5px;margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08)}
.terry-h3-shot-picker-custom input{min-width:0;height:28px;padding:0 7px;border:1px solid rgba(255,255,255,.1);border-radius:5px;background:rgba(0,0,0,.18);color:inherit;outline:none}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3VisualTypesAndShotPicker",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        const menu = node?.__terryH3ShotPicker;
        if (!menu || menu.contains(event.target) || event.target?.closest?.(".terry-h3-type-shot,.terry-h3-type-speaker")) continue;
        closePicker(node);
      }
    }, true);
    for (const delay of [0, 100, 400, 1000]) setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isTarget(node)) installSoon(node);
    }, delay);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTypeColorsInstalled) return;
    nodeType.prototype.__terryTypeColorsInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      if (this.__terryH3Editor) decorate(this.__terryH3Editor);
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
