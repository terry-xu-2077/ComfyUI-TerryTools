import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
const VIEW_PROP = "terry_h3_view_mode";
const LANGUAGES = [
  "English", "Chinese", "Cantonese", "Japanese", "Korean", "Spanish", "French",
  "German", "Italian", "Portuguese", "Russian", "Arabic", "Hindi", "Thai",
  "Vietnamese", "Indonesian", "Turkish", "Polish", "Dutch", "Other",
];

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function parseDialogueRaw(raw) {
  const match = String(raw || "").match(/^<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>$/i);
  return match ? { language: match[1] || "English", text: match[2] || "" } : { language: "English", text: "" };
}

function dialogueRaw(language, text) {
  return `<d>[${language || "English"}] ${String(text || "")}</d>`;
}

function notifyDialogueChanged(block) {
  const editor = block.closest?.(".terry-h3-editor");
  if (!editor) return;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
}

function enhanceDialogueBlock(block) {
  if (!block?.classList?.contains("terry-h3-dialogue") || block.__terryDialogueEnhanced) return block;
  block.__terryDialogueEnhanced = true;
  const parsed = parseDialogueRaw(block.dataset.raw);
  block.replaceChildren();
  block.classList.add("terry-h3-dialogue-editor");
  block.contentEditable = "false";

  const select = document.createElement("select");
  select.className = "terry-h3-dialogue-language";
  select.setAttribute("aria-label", "对白语言");
  const languageNames = [...LANGUAGES];
  if (parsed.language && !languageNames.includes(parsed.language)) languageNames.unshift(parsed.language);
  for (const language of languageNames) {
    const option = document.createElement("option");
    option.value = option.textContent = language;
    if (language === parsed.language) option.selected = true;
    select.append(option);
  }

  const text = document.createElement("span");
  text.className = "terry-h3-dialogue-text";
  text.contentEditable = "true";
  text.spellcheck = false;
  text.dataset.placeholder = "输入对白…";
  text.textContent = parsed.text;

  const updateRaw = () => {
    block.dataset.raw = dialogueRaw(select.value, text.innerText.replaceAll("\n", " "));
    notifyDialogueChanged(block);
  };
  select.addEventListener("change", updateRaw);
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("keydown", (event) => event.stopPropagation());
  text.addEventListener("input", updateRaw);
  text.addEventListener("pointerdown", (event) => event.stopPropagation());
  text.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") event.preventDefault();
  });
  block.addEventListener("pointerdown", (event) => event.stopPropagation());
  block.append(select, text);
  return block;
}

function enhanceDialogues(editor) {
  for (const block of editor?.querySelectorAll?.(".terry-h3-dialogue") || []) enhanceDialogueBlock(block);
}

function syncBooleanView(node) {
  const toggle = widget(node, "visual_preview");
  const button = node.__terryH3ViewButton;
  if (!toggle || !button) return;
  const wantVisual = Boolean(toggle.value);
  const isVisual = node?.properties?.[VIEW_PROP] !== "raw";
  if (wantVisual !== isVisual) button.click();
  button.style.display = "none";
}

function bindToggle(node) {
  const toggle = widget(node, "visual_preview");
  if (!toggle || toggle.__terryH3Bound) return;
  toggle.__terryH3Bound = true;
  const original = toggle.callback;
  toggle.callback = function(value) {
    const result = original?.apply(this, arguments);
    toggle.value = Boolean(value);
    setTimeout(() => syncBooleanView(node), 0);
    return result;
  };
}

function bindEditor(node) {
  const editor = node.__terryH3Editor;
  if (!editor || editor.__terryH3DialogueHelpersBound) return false;
  editor.__terryH3DialogueHelpersBound = true;
  const observer = new MutationObserver(() => enhanceDialogues(editor));
  observer.observe(editor, { childList: true, subtree: true });
  editor.__terryH3DialogueObserver = observer;
  enhanceDialogues(editor);
  bindToggle(node);
  syncBooleanView(node);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  bindToggle(node);
  if (bindEditor(node)) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    bindToggle(node);
    if (bindEditor(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(1000, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-dialogue-helper-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-dialogue-helper-style";
  style.textContent = `
.terry-h3-view{display:none!important}
.terry-h3-dialogue-editor{display:inline-flex!important;align-items:center!important;gap:5px!important;max-width:min(520px,90%)!important;padding:2px 4px!important;background:rgba(0,226,187,.12)!important;color:rgba(190,255,244,.98)!important;white-space:normal!important;vertical-align:middle!important}
.terry-h3-dialogue-language{height:22px;max-width:108px;padding:0 4px;border:0;border-radius:4px;outline:none;background:rgba(0,0,0,.24);color:inherit;font:10px/1 system-ui,sans-serif;cursor:pointer}
.terry-h3-dialogue-text{display:inline-block;min-width:72px;max-width:360px;overflow:hidden;white-space:nowrap;text-overflow:clip;outline:none;border:0;color:inherit;caret-color:currentColor;font:11px/1.5 Consolas,monospace;cursor:text}
.terry-h3-dialogue-text:empty:before{content:attr(data-placeholder);opacity:.42;pointer-events:none}
.terry-h3-dialogue-text:focus{background:rgba(255,255,255,.035);border-radius:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3PromptDialogueHelpers",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3DialogueHelpersInstalled) return;
    nodeType.prototype.__terryH3DialogueHelpersInstalled = true;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() { const result = created?.apply(this, arguments); installSoon(this); return result; };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() { const result = added?.apply(this, arguments); installSoon(this); return result; };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const result = configured?.apply(this, arguments); installSoon(this); return result; };
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      if (this.__terryH3Editor) { bindToggle(this); bindEditor(this); syncBooleanView(this); enhanceDialogues(this.__terryH3Editor); }
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
