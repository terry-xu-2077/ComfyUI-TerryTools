import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";

const LANGUAGE_ZH = {
  English: "英语", Chinese: "中文", Cantonese: "粤语", Japanese: "日语", Korean: "韩语",
  Spanish: "西班牙语", French: "法语", German: "德语", Italian: "意大利语",
  Portuguese: "葡萄牙语", Russian: "俄语", Arabic: "阿拉伯语", Hindi: "印地语",
  Thai: "泰语", Vietnamese: "越南语", Indonesian: "印尼语", Turkish: "土耳其语",
  Polish: "波兰语", Dutch: "荷兰语", Other: "其他",
};

const EXACT_ZH = new Map([
  ["subject_definitions:", "主体定义"], ["summary:", "摘要"], ["retention_analysis:", "保留关系分析"],
  ["detailed_description:", "详细描述"], ["integrated_multimodal_description:", "综合多模态描述"],
  ["overall_soundscape:", "整体声景"], ["non_diegetic_music:", "非剧情音乐"],
  ["fully_preserved", "完整保留"], ["partially_preserved", "部分保留"],
  ["attribute_transfer", "属性迁移"], ["weak_reference", "弱参考"],
  ["fully_copy", "完整复制"], ["partially_copy", "部分复制"], ["reference", "参考"],
  ["<scenetrans>", "跨镜头连续"], ["<cutoff>", "结尾截断"],
  ["[reference generation]", "参考生成"], ["[keyframe completion]", "关键帧补全"],
  ["[video editing]", "视频编辑"], ["[video continuation]", "视频续写"],
  ["[audio reuse]", "音频复用"], ["[audio reference]", "音频参考"],
]);

const EXACT_EN = new Map([
  ["subject_definitions:", "Subject Definitions"], ["summary:", "Summary"],
  ["retention_analysis:", "Retention Analysis"], ["detailed_description:", "Detailed Description"],
  ["integrated_multimodal_description:", "Integrated Multimodal Description"],
  ["overall_soundscape:", "Overall Soundscape"], ["non_diegetic_music:", "Non-diegetic Music"],
  ["fully_preserved", "Fully Preserved"], ["partially_preserved", "Partially Preserved"],
  ["attribute_transfer", "Attribute Transfer"], ["weak_reference", "Weak Reference"],
  ["fully_copy", "Fully Copy"], ["partially_copy", "Partially Copy"], ["reference", "Reference"],
  ["<scenetrans>", "Scene Transition"], ["<cutoff>", "Cutoff"],
  ["[reference generation]", "Reference Generation"], ["[keyframe completion]", "Keyframe Completion"],
  ["[video editing]", "Video Editing"], ["[video continuation]", "Video Continuation"],
  ["[audio reuse]", "Audio Reuse"], ["[audio reference]", "Audio Reference"],
]);

function readComfyLocale() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    if (typeof value === "string" && value) return value;
  } catch {}
  const htmlLang = document?.documentElement?.lang;
  if (typeof htmlLang === "string" && htmlLang.toLowerCase().startsWith("zh")) return htmlLang;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || "";
      const value = localStorage.getItem(key) || "";
      if (!key.includes("setting") && !value.includes("Comfy.Locale")) continue;
      const match = value.match(/(?:Comfy\.Locale|\"Comfy\.Locale\")\s*[\":=]+\s*\"?([a-zA-Z_-]+)/);
      if (match?.[1]) return match[1];
    }
  } catch {}
  return "en";
}

function isChineseLocale() {
  const locale = String(readComfyLocale() || "en").toLowerCase().replace("_", "-");
  return locale === "zh" || locale.startsWith("zh-");
}

globalThis.__terryH3GetLocale = readComfyLocale;
globalThis.__terryH3IsZh = isChineseLocale;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function visibleLabelFromRaw(raw) {
  raw = String(raw || "").trim();
  if (!raw) return null;
  const zh = isChineseLocale();
  const exact = zh ? EXACT_ZH : EXACT_EN;
  if (exact.has(raw)) return exact.get(raw);

  let m = raw.match(/^<Subject\s+(\d+)>$/i);
  if (m) return zh ? `主体 ${m[1]}` : `Subject ${m[1]}`;
  m = raw.match(/^<Picture\s+(\d+)>$/i);
  if (m) return zh ? `图片 ${m[1]}` : `Picture ${m[1]}`;
  m = raw.match(/^<Video\s+(\d+)>$/i);
  if (m) return zh ? `视频 ${m[1]}` : `Video ${m[1]}`;
  m = raw.match(/^<Audio\s+(\d+)>$/i);
  if (m) return zh ? `音频 ${m[1]}` : `Audio ${m[1]}`;
  m = raw.match(/^\[Shot\s+(\d+)\]$/i);
  if (m) return zh ? `镜头 ${m[1]}` : `Shot ${m[1]}`;
  m = raw.match(/^\(S(\d+)\)$/i);
  if (m) return zh ? `说话人 S${m[1]}` : `Speaker S${m[1]}`;
  if (/^\d{2}:\d{2}\.\d{3}$/.test(raw)) return zh ? `时间 ${raw}` : `Time ${raw}`;
  return null;
}

function setPlainChipLabel(chip, label) {
  if (!chip || !label) return;
  const children = [...chip.children];
  if (children.length) {
    const textChild = [...children].reverse().find((el) =>
      el.tagName === "SPAN" && !el.classList.contains("terry-h3-media-icon") && !el.classList.contains("terry-h3-mention-icon")
    );
    if (textChild) { if (textChild.textContent !== label) textChild.textContent = label; return; }
  }
  if (!chip.classList.contains("terry-h3-dialogue-editor") && chip.textContent !== label) chip.textContent = label;
}

function localizeDialogue(block) {
  const select = block.querySelector?.("select.terry-h3-dialogue-language");
  if (!select) return;
  const zh = isChineseLocale();
  for (const option of select.options || []) {
    const english = option.value || option.dataset.h3Language || option.textContent;
    option.dataset.h3Language = english;
    const shown = zh ? (LANGUAGE_ZH[english] || english) : english;
    if (option.textContent !== shown) option.textContent = shown;
  }
  select.title = zh ? `对白语言：${LANGUAGE_ZH[select.value] || select.value}` : `Dialogue language: ${select.value}`;
}

function localizeEditor(editor) {
  if (!editor) return;
  for (const chip of editor.querySelectorAll?.(".terry-h3-chip") || []) {
    if (chip.classList.contains("terry-h3-dialogue-editor")) { localizeDialogue(chip); continue; }
    const label = visibleLabelFromRaw(chip.dataset?.raw);
    if (label) setPlainChipLabel(chip, label);
  }
  for (const block of editor.querySelectorAll?.(".terry-h3-dialogue-editor") || []) localizeDialogue(block);
}

function constrainEditor(node) {
  const wrap = node?.__terryH3Wrap;
  const editor = node?.__terryH3Editor;
  const dom = node?.__terryH3DomWidget;
  if (!wrap || !editor) return false;
  wrap.style.setProperty("height", "504px", "important");
  wrap.style.setProperty("min-height", "0px", "important");
  wrap.style.setProperty("max-height", "728px", "important");
  wrap.style.setProperty("overflow", "hidden", "important");
  wrap.style.setProperty("contain", "size layout paint", "important");
  editor.style.setProperty("height", "100%", "important");
  editor.style.setProperty("min-height", "0px", "important");
  editor.style.setProperty("max-height", "100%", "important");
  editor.style.setProperty("overflow-y", "auto", "important");
  editor.style.setProperty("overflow-x", "hidden", "important");
  editor.style.setProperty("overscroll-behavior", "contain", "important");
  if (dom && !dom.__terryNodes2HeightFixed) {
    dom.__terryNodes2HeightFixed = true;
    dom.computeSize = (width) => [Math.max(300, Number(width) || Number(node.size?.[0]) || 520), 518];
    dom.getMinHeight = () => 420;
    dom.getMaxHeight = () => 728;
    dom.options ||= {};
    dom.options.getMinHeight = () => 420;
    dom.options.getMaxHeight = () => 728;
  }
  return true;
}

function bindNode(node) {
  if (!isTarget(node)) return false;
  const editor = node.__terryH3Editor;
  if (!editor) return false;
  constrainEditor(node); localizeEditor(editor);
  if (!editor.__terryZhObserver) {
    const observer = new MutationObserver(() => {
      if (editor.__terryZhLocalizing) return;
      editor.__terryZhLocalizing = true;
      try { localizeEditor(editor); constrainEditor(node); } finally { editor.__terryZhLocalizing = false; }
    });
    observer.observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-raw"] });
    editor.__terryZhObserver = observer;
  }
  if (!editor.__terryZhInputBound) {
    editor.__terryZhInputBound = true;
    editor.addEventListener("input", () => queueMicrotask(() => localizeEditor(editor)));
    editor.addEventListener("focusin", () => constrainEditor(node));
  }
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => { attempts += 1; if (bindNode(node) || attempts >= 15) return; setTimeout(run, Math.min(1000, attempts * 70)); };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-zh-nodes2-fix")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-zh-nodes2-fix";
  style.textContent = `
.terry-h3-wrap{height:504px!important;min-height:0!important;max-height:728px!important;overflow:hidden!important;contain:size layout paint!important}
.terry-h3-editor{height:100%!important;min-height:0!important;max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain}
.terry-h3-dialogue-language{min-width:66px!important;max-width:92px!important}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3PreviewLocaleAndNodes2Fix",
  setup() {
    installStyle();
    for (const delay of [0, 100, 400, 1000]) setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isTarget(node)) installSoon(node);
    }, delay);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryZhNodes2Installed) return;
    nodeType.prototype.__terryZhNodes2Installed = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() { const result = old?.apply(this, arguments); installSoon(this); return result; };
    }
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      if (this.__terryH3Editor) { constrainEditor(this); localizeEditor(this.__terryH3Editor); }
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
