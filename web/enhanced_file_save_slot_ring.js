import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";

function isTarget(node) {
  return [
    node?.comfyClass,
    node?.type,
    node?.constructor?.type,
    node?.constructor?.comfyClass,
    node?.constructor?.nodeData?.name,
  ].some((value) => String(value || "") === NODE_ID);
}

function slotPosition(node, isInput, index) {
  const out = [0, 0];
  const pos = node.getConnectionPos?.(isInput, index, out) || out;
  let x = Number(pos?.[0]);
  let y = Number(pos?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // LiteGraph variants may return graph-space coordinates. Foreground drawing
  // uses node-local coordinates, so normalize when necessary.
  const nx = Number(node.pos?.[0]) || 0;
  const ny = Number(node.pos?.[1]) || 0;
  const width = Number(node.size?.[0]) || 0;
  const height = Number(node.size?.[1]) || 0;
  if (x < -16 || x > width + 16 || y < -16 || y > height + 16) {
    x -= nx;
    y -= ny;
  }
  return [x, y];
}

function drawRing(ctx, x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 8.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(235, 235, 235, 0.78)";
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();
}

function drawDataSlotRings(node, ctx) {
  if (!ctx) return;

  const inputIndex = node.inputs?.findIndex((slot) => slot?.name === "data") ?? -1;
  if (inputIndex >= 0) {
    const pos = slotPosition(node, true, inputIndex);
    if (pos) drawRing(ctx, pos[0], pos[1]);
  }

  const outputIndex = node.outputs?.findIndex((slot) => slot?.name === "data") ?? -1;
  if (outputIndex >= 0) {
    const pos = slotPosition(node, false, outputIndex);
    if (pos) drawRing(ctx, pos[0], pos[1]);
  }
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DataSlotRing",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryDataSlotRingInstalled) return;
    nodeType.prototype.__terryDataSlotRingInstalled = true;

    const original = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function(ctx) {
      const result = original?.apply(this, arguments);
      drawDataSlotRings(this, ctx);
      return result;
    };
  },

  nodeCreated(node) {
    if (isTarget(node)) node.setDirtyCanvas?.(true, true);
  },

  loadedGraphNode(node) {
    if (isTarget(node)) node.setDirtyCanvas?.(true, true);
  },
});
