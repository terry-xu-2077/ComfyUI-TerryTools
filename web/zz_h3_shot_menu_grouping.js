import { createH3TokenNode } from "./h3_rich_text.js";

const MENU_SELECTOR = ".terry-h3-command-menu";
const ITEM_SELECTOR = ".terry-h3-command-item";
const CARET = "\u200B";
let installed = false;

function textOf(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function headerTitle(menu) {
  return textOf(menu?.querySelector?.(".terry-h3-command-head-title b"));
}

function isRootMenu(menu) {
  return headerTitle(menu) === "H3 语法" && !menu.querySelector(".terry-h3-command-back");
}

function isShotMenu(menu) {
  return headerTitle(menu) === "镜头";
}

function isCameraItem(item) {
  const value = textOf(item);
  return value.includes("镜头运动") && item.classList.contains("is-category");
}

function findRootCameraItem(menu) {
  return [...menu.querySelectorAll(`${ITEM_SELECTOR}.is-category`)].find(isCameraItem) || null;
}

function hideRootCamera(menu) {
  if (!isRootMenu(menu)) return;
  const camera = findRootCameraItem(menu);
  if (camera) {
    camera.dataset.terryMovedIntoShot = "1";
    camera.style.display = "none";
  }
}

function slashRange() {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (caret.startContainer?.nodeType !== Node.TEXT_NODE) return null;
  const editor = caret.startContainer.parentElement?.closest?.('[contenteditable="true"]');
  if (!editor) return null;
  const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
  const match = before.match(/\/([^/\n]*)$/);
  if (!match) return null;
  const range = document.createRange();
  range.setStart(caret.startContainer, caret.startOffset - match[0].length);
  range.setEnd(caret.startContainer, caret.startOffset);
  return { editor, range };
}

function insertTimestamp(menu) {
  const hit = slashRange();
  if (!hit) return;
  const token = createH3TokenNode("00:00.000", {
    onChange: () => hit.editor.dispatchEvent(new Event("terrychange", { bubbles: true })),
  });
  hit.range.deleteContents();
  const marker = document.createTextNode(CARET);
  const fragment = document.createDocumentFragment();
  fragment.append(token, marker);
  hit.range.insertNode(fragment);
  const selection = window.getSelection?.();
  if (selection) {
    const next = document.createRange();
    next.setStart(marker, marker.textContent.length);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
  }
  hit.editor.dispatchEvent(new Event("input", { bubbles: true }));
  hit.editor.dispatchEvent(new Event("terrychange", { bubbles: true }));
  hit.editor.focus({ preventScroll: true });
  menu.remove();
}

function makeCommandButton(label, detail, categoryLabel = "镜头") {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "terry-h3-command-item terry-h3-shot-extra";
  const cat = document.createElement("span");
  cat.className = "terry-h3-command-category";
  cat.textContent = categoryLabel;
  const body = document.createElement("span");
  body.className = "terry-h3-command-text";
  const strong = document.createElement("b");
  strong.textContent = label;
  const small = document.createElement("small");
  small.textContent = detail;
  body.append(strong, small);
  item.append(cat, body);
  return item;
}

function makeCameraSubmenuButton(menu) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "terry-h3-command-item is-category terry-h3-shot-extra terry-h3-shot-camera";
  const icon = document.createElement("span");
  icon.className = "terry-h3-command-category-icon";
  icon.textContent = "◉";
  const body = document.createElement("span");
  body.className = "terry-h3-command-text";
  const strong = document.createElement("b");
  strong.textContent = "镜头运动";
  const small = document.createElement("small");
  small.textContent = "常用运镜方式与镜头运动";
  body.append(strong, small);
  const arrow = document.createElement("span");
  arrow.className = "terry-h3-command-count";
  arrow.textContent = "›";
  item.append(icon, body, arrow);

  item.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const back = menu.querySelector(".terry-h3-command-back");
    if (!back) return;
    back.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    queueMicrotask(() => {
      const root = document.querySelector(MENU_SELECTOR);
      const camera = root ? findRootCameraItem(root) : null;
      if (camera) camera.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
  });
  return item;
}

function patchShotMenu(menu) {
  if (!isShotMenu(menu) || menu.dataset.terryShotGrouping === "1") return;
  menu.dataset.terryShotGrouping = "1";

  const items = [...menu.querySelectorAll(ITEM_SELECTOR)];
  const speaker = items.find((item) => /Speaker\s+S\d+/i.test(textOf(item)));

  const timestamp = makeCommandButton("时间戳", "插入可编辑时间标签 00:00.000");
  timestamp.classList.add("terry-h3-shot-timestamp");
  timestamp.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertTimestamp(menu);
  });

  const camera = makeCameraSubmenuButton(menu);
  if (speaker) {
    menu.insertBefore(timestamp, speaker);
    menu.insertBefore(camera, speaker);
  } else {
    menu.append(timestamp, camera);
  }
}

function patchMenu(menu) {
  if (!(menu instanceof HTMLElement)) return;
  hideRootCamera(menu);
  patchShotMenu(menu);
}

function scan() {
  document.querySelectorAll(MENU_SELECTOR).forEach(patchMenu);
}

function install() {
  if (installed) return;
  installed = true;
  const observer = new MutationObserver(() => queueMicrotask(scan));
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
}

install();
