import { app } from "../../scripts/app.js";

const LANGUAGE_BY_LOCALE = new Map([
  ["en", "English"],
  ["zh", "Chinese"],
  ["yue", "Cantonese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["id", "Indonesian"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
  ["nl", "Dutch"],
]);

function comfyLocale() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function defaultDialogueLanguage() {
  const locale = comfyLocale();
  const exact = LANGUAGE_BY_LOCALE.get(locale);
  if (exact) return exact;
  const base = locale.split("-")[0];
  return LANGUAGE_BY_LOCALE.get(base) || "English";
}

function applyToNewDialogue(block) {
  if (!block?.classList?.contains("terry-h3-dialogue-editor")) return;
  if (block.__terryLocaleDefaultChecked) return;
  block.__terryLocaleDefaultChecked = true;

  // Only change a freshly-created, still-empty dialogue. Existing/pasted H3 dialogue
  // keeps the language explicitly stored in its raw source.
  setTimeout(() => {
    const select = block.querySelector(".terry-h3-dialogue-language");
    const text = block.querySelector(".terry-h3-dialogue-text");
    if (!select || !text) return;
    if (document.activeElement !== text) return;
    if (String(text.innerText || "").trim()) return;
    if (select.value !== "English") return;

    const language = defaultDialogueLanguage();
    if (!language || language === select.value) return;
    const option = [...select.options].find((item) => item.value === language);
    if (!option) return;

    select.value = language;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, 0);
}

function inspectAddedNode(node) {
  if (node?.nodeType !== Node.ELEMENT_NODE) return;
  if (node.classList?.contains("terry-h3-dialogue-editor")) applyToNewDialogue(node);
  for (const block of node.querySelectorAll?.(".terry-h3-dialogue-editor") || []) applyToNewDialogue(block);
}

app.registerExtension({
  name: "TerryTools.H3DialogueLocaleDefault",
  setup() {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) inspectAddedNode(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
