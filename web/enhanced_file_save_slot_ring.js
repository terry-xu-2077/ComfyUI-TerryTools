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

function attrEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function pointForSlot(node, isInput, index) {
  const point = isInput
    ? node?.getInputPos?.(index)
    : node?.getOutputPos?.(index);
  if (Array.isArray(point) && point.length >= 2) return point;

  const out = [0, 0];
  const fallback = node?.getConnectionPos?.(isInput, index, out) || out;
  return fallback;
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

function targetNodes() {
  return (app.graph?._nodes || []).filter(isTarget);
}

function markVueDataPorts() {
  for (const node of targetNodes()) {
    if (node?.id == null) continue;
    const root = document.querySelector(`[data-node-id="${attrEscape(node.id)}"]`);
    if (!root) continue;

    for (const el of root.querySelectorAll(`.${VUE_MARK_CLASS}`)) {
      el.classList.remove(VUE_MARK_CLASS);
    }

    const inputIndex = node.inputs?.findIndex((slot) => slot?.name === "data") ?? -1;
    if (inputIndex >= 0) {
      const inputs = root.querySelectorAll(".lg-slot--input");
      inputs[inputIndex]?.classList.add(VUE_MARK_CLASS);
    }

    const outputIndex = node.outputs?.findIndex((slot) => slot?.name === "data") ?? -1;
    if (outputIndex >= 0) {
      const outputs = root.querySelectorAll(".lg-slot--output");
      outputs[outputIndex]?.classList.add(VUE_MARK_CLASS);
    }
  }
}

function refreshVuePortStyle() {
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

  markVueDataPorts();
}

let vueStyleQueued = false;
function queueVueStyleRefresh() {
  if (vueStyleQueued) return;
  vueStyleQueued = true;
  requestAnimationFrame(() => {
    vueStyleQueued = false;
    refreshVuePortStyle();
  });
}

function scheduleVueRefresh() {
  queueVueStyleRefresh();
  setTimeout(queueVueStyleRefresh, 60);
  setTimeout(queueVueStyleRefresh, 180);
  setTimeout(queueVueStyleRefresh, 400);
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
  for (const node of targetNodes()) patchNode(node);
  scheduleVueRefresh();
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DataSlotRing",

  setup() {
    patchExistingNodes();
  },

  nodeCreated(node) {
    patchNode(node);
  },

  loadedGraphNode(node) {
    patchNode(node);
  },
});
