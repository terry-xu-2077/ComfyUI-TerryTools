import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";
// ComfyUI frontend RenderShape.HollowCircle. Using the native slot shape keeps
// the emphasis compact and, unlike onDrawForeground decoration, also renders
// in Nodes 2.0.
const HOLLOW_CIRCLE = 7;

function isTarget(node) {
  return [
    node?.comfyClass,
    node?.type,
    node?.constructor?.type,
    node?.constructor?.comfyClass,
    node?.constructor?.nodeData?.name,
  ].some((value) => String(value || "") === NODE_ID);
}

function applyDataSlotShape(node) {
  if (!isTarget(node)) return false;

  let changed = false;
  const input = node.inputs?.find((slot) => slot?.name === "data");
  if (input && input.shape !== HOLLOW_CIRCLE) {
    input.shape = HOLLOW_CIRCLE;
    changed = true;
  }

  const output = node.outputs?.find((slot) => slot?.name === "data");
  if (output && output.shape !== HOLLOW_CIRCLE) {
    output.shape = HOLLOW_CIRCLE;
    changed = true;
  }

  if (changed) {
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  }
  return !!(input || output);
}

function schedule(node) {
  if (!isTarget(node)) return;
  queueMicrotask(() => applyDataSlotShape(node));
  requestAnimationFrame(() => applyDataSlotShape(node));
  setTimeout(() => applyDataSlotShape(node), 80);
  setTimeout(() => applyDataSlotShape(node), 250);
}

app.registerExtension({
  name: "TerryTools.EnhancedFileSave.DataSlotRing",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryDataSlotRingInstalled) return;
    nodeType.prototype.__terryDataSlotRingInstalled = true;

    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        schedule(this);
        return result;
      };
    }
  },

  nodeCreated(node) {
    schedule(node);
  },

  loadedGraphNode(node) {
    schedule(node);
  },
});
