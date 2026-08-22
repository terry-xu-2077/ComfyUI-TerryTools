import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function clearOuterScroll(node) {
  if (!isTarget(node)) return false;
  const root = node.__terryH3ShotTimeline?.root;
  if (!root) return false;

  // The visible long scrollbar is not on the timeline root. It is created by
  // ComfyUI's DOM-widget wrapper. Keep scrollbars only on the Global/Shot editors.
  root.style.maxHeight = "none";
  root.style.overflow = "visible";

  let parent = root.parentElement;
  for (let depth = 0; parent && parent !== document.body && depth < 3; depth += 1, parent = parent.parentElement) {
    const computed = getComputedStyle(parent);
    const scrollsY = computed.overflowY === "auto" || computed.overflowY === "scroll";
    const looksLikeWidgetWrapper = parent.contains(root) && (scrollsY || parent.scrollHeight > parent.clientHeight + 2);
    if (!looksLikeWidgetWrapper) continue;
    parent.style.overflowY = "visible";
    parent.style.overflowX = "visible";
    parent.style.maxHeight = "none";
    parent.style.scrollbarGutter = "auto";
  }

  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => {
    attempts += 1;
    if (clearOuterScroll(node) || attempts >= 12) return;
    setTimeout(run, Math.min(720, attempts * 60));
  };
  setTimeout(run, 0);
}

app.registerExtension({
  name: "TerryTools.H3TimelineOuterScrollFix",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineOuterScrollFixInstalled) return;
    nodeType.prototype.__terryTimelineOuterScrollFixInstalled = true;

    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }

    const resized = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function() {
      const result = resized?.apply(this, arguments);
      clearOuterScroll(this);
      return result;
    };
  },
  loadedGraphNode(node) {
    if (isTarget(node)) installSoon(node);
  },
});
