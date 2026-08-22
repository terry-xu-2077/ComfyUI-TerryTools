import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
const VUE_STYLE_ID = "terry-enhanced-file-save-data-port-style";

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

  // getInputPos/getOutputPos are graph-space in the classic renderer.
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
  // Native circle radius is ~4 px. Keep the extra emphasis subtle: only a
  // thin 1.4 px ring immediately outside it, similar to the wire-bus port.
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

function refreshVuePortStyle() {
  let style = document.getElementById(VUE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VUE_STYLE_ID;
    document.head.append(style);
  }

  const selectors = [];
  const dotSelectors = [];

  for (const node of targetNodes()) {
    if (node?.id == null) continue;
    const root = `[data-node-id="${attrEscape(node.id)}"]`;

    const inputIndex = node.inputs?.findIndex((slot) => slot?.name === "data") ?? -1;
    if (inputIndex >= 0) {
      const base = `${root} .lg-slot--input:nth-of-type(${inputIndex + 1}) [data-testid="slot-connection-dot"]`;
      selectors.push(base);
      dotSelectors.push(`${base} [data-testid="slot-dot"]`);
    }

    const outputIndex = node.outputs?.findIndex((slot) => slot?.name === "data") ?? -1;
    if (outputIndex >= 0) {
      const base = `${root} .lg-slot--output:nth-of-type(${outputIndex + 1}) [data-testid="slot-connection-dot"]`;
      selectors.push(base);
      dotSelectors.push(`${base} [data-testid="slot-dot"]`);
    }
  }

  style.textContent = selectors.length ? `
${selectors.join(",\n")}{
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
${dotSelectors.join(",\n")}{
  position:relative;
  z-index:1;
  flex:none;
}
` : "";
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

function patchNode(node) {
  if (!isTarget(node)) return;

  // Undo the previous HollowCircle experiment. It renders as a ~20 px port in
  // Nodes 2.0, which is much larger than requested.
  for (const slot of [
    node.inputs?.find((item) => item?.name === "data"),
    node.outputs?.find((item) => item?.name === "data"),
  ]) {
    if (slot?.shape === 7) delete slot.shape;
  }

  queueVueStyleRefresh();
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
  queueVueStyleRefresh();
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
