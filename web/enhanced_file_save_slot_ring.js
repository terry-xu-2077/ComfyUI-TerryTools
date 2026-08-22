import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
const VUE_STYLE_ID = "terry-enhanced-file-save-data-port-style";
const VUE_MARK_CLASS = "terry-enhanced-data-port";

function isTarget(node) {
  return [
    node?.comfyClass,
    node?.type,
    node?.constructor?.type,
    node?.constructor?.comfyClass,
    node?.constructor?.nodeData?.name,
  ].some((value) => String(value || "") === NODE_ID);
}

function pointForSlot(node, isInput, index) {
  const point = isInput
    ? node?.getInputPos?.(index)
    : node?.getOutputPos?.(index);
  if (Array.isArray(point) && point.length >= 2) return point;

  const out = [0, 0];
  return node?.getConnectionPos?.(isInput, index, out) || out;
}

function drawCompactRing(ctx, node, isInput, index) {
  const point = pointForSlot(node, isInput, index);
  let x = Number(point?.[0]);
  let y = Number(point?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const nx = Number(node?.pos?.[0]) || 0;
  const ny = Number(node?.pos?.[1]) || 0;
  const width = Number(node?.size?.[0]) || 0;
  const height = Number(node?.size?.[1]) || 0;
  if (x < -12 || x > width + 12 || y < -12 || y > height + 12) {
    x -= nx;
    y -= ny;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 5.8, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(235,235,235,0.72)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawClassicRings(node, ctx) {
  if (!ctx || !isTarget(node)) return;

  const inputIndex = node.inputs?.findIndex((slot) => slot?.name === "data") ?? -1;
  if (inputIndex >= 0) drawCompactRing(ctx, node, true, inputIndex);

  const outputIndex = node.outputs?.findIndex((slot) => slot?.name === "data") ?? -1;
  if (outputIndex >= 0) drawCompactRing(ctx, node, false, outputIndex);
}

function installVueStyle() {
  let style = document.getElementById(VUE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VUE_STYLE_ID;
    document.head.append(style);
  }

  style.textContent = `
.${VUE_MARK_CLASS} [data-testid="slot-connection-dot"]{
  position:relative;
  overflow:visible;
  width:12px !important;
  min-width:12px !important;
  height:12px !important;
  min-height:12px !important;
  border-radius:999px;
  box-sizing:border-box;
  background:transparent !important;
  border:1.4px solid rgba(235,235,235,.72);
  display:flex;
  align-items:center;
  justify-content:center;
}
.${VUE_MARK_CLASS} [data-testid="slot-connection-dot"] [data-testid="slot-dot"]{
  position:relative;
  z-index:1;
  flex:none;
}
`;
}

function normalizedText(el) {
  return String(el?.textContent || "").replace(/\s+/g, " ").trim();
}

function isEnhancedSaveRoot(root) {
  const text = normalizedText(root);
  return text.includes("Terry 增强文件保存") || text.includes("Terry Enhanced File Save");
}

function markVueDataPorts() {
  installVueStyle();

  for (const el of document.querySelectorAll(`.${VUE_MARK_CLASS}`)) {
    el.classList.remove(VUE_MARK_CLASS);
  }

  for (const slot of document.querySelectorAll(".lg-slot--input, .lg-slot--output")) {
    const text = normalizedText(slot);
    const isInput = slot.classList.contains("lg-slot--input");
    const isOutput = slot.classList.contains("lg-slot--output");

    const labelMatches =
      (isInput && (text === "内容" || text === "Content")) ||
      (isOutput && (text === "原内容" || text === "Original content" || text === "Original Content"));
    if (!labelMatches) continue;

    // Prefer exact node scoping when Nodes 2.0 exposes the node root. Some
    // frontend builds do not expose data-node-id consistently, so fall back to
    // the nearest large node container and verify its visible title text.
    let root = slot.closest("[data-node-id]");
    if (!root) {
      let parent = slot.parentElement;
      while (parent && parent !== document.body) {
        if (isEnhancedSaveRoot(parent)) {
          root = parent;
          break;
        }
        parent = parent.parentElement;
      }
    }

    if (root && !isEnhancedSaveRoot(root)) continue;
    slot.classList.add(VUE_MARK_CLASS);
  }
}

let vueRefreshQueued = false;
function queueVueRefresh() {
  if (vueRefreshQueued) return;
  vueRefreshQueued = true;
  requestAnimationFrame(() => {
    vueRefreshQueued = false;
    markVueDataPorts();
  });
}

function scheduleVueRefresh() {
  queueVueRefresh();
  setTimeout(queueVueRefresh, 60);
  setTimeout(queueVueRefresh, 180);
  setTimeout(queueVueRefresh, 400);
  setTimeout(queueVueRefresh, 900);
}

function patchNode(node) {
  if (!isTarget(node)) return;

  for (const slot of [
    node.inputs?.find((item) => item?.name === "data"),
    node.outputs?.find((item) => item?.name === "data"),
  ]) {
    if (slot?.shape === 7) delete slot.shape;
  }

  scheduleVueRefresh();
  node.setDirtyCanvas?.(true, true);

  if (node.__terryCompactDataPortRingPatched) return;
  node.__terryCompactDataPortRingPatched = true;

  const originalForeground = node.onDrawForeground;
  node.onDrawForeground = function(ctx) {
    const result = originalForeground?.apply?.(this, arguments);
    drawClassicRings(this, ctx);
    return result;
  };
}

function patchExistingNodes() {
  for (const node of app.graph?._nodes || []) patchNode(node);
  scheduleVueRefresh();
}

let observer = null;
function installVueObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver(() => queueVueRefresh());
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DataSlotRing",

  setup() {
    installVueStyle();
    installVueObserver();
    patchExistingNodes();
  },

  nodeCreated(node) {
    patchNode(node);
  },

  loadedGraphNode(node) {
    patchNode(node);
  },
});
