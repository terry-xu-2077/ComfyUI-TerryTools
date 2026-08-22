import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function isTransportName(name) {
  const value = String(name || "");
  return /^asset\d*$/i.test(value) || value === "assets";
}

function pruneNodeData(nodeData) {
  if (!nodeData) return;
  for (const sectionName of ["required", "optional"]) {
    const section = nodeData.input?.[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section)) {
      if (isTransportName(key)) delete section[key];
    }
  }
  if (Array.isArray(nodeData.inputs)) {
    nodeData.inputs = nodeData.inputs.filter((input) => !isTransportName(input?.name));
  }
  for (const key of ["required", "optional"]) {
    if (Array.isArray(nodeData.input_order?.[key])) {
      nodeData.input_order[key] = nodeData.input_order[key].filter((name) => !isTransportName(name));
    }
  }
}

function removeInputAt(node, index) {
  const input = node?.inputs?.[index];
  if (!input) return;
  try {
    if (input.link != null) node.disconnectInput?.(index);
  } catch {}
  if (typeof node.removeInput === "function") node.removeInput(index);
  else node.inputs.splice(index, 1);
}

function pruneInstance(node) {
  if (!isTarget(node) || !node?.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (isTransportName(node.inputs[i]?.name)) removeInputAt(node, i);
  }
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
}

function installSoon(node) {
  if (!isTarget(node)) return;
  pruneInstance(node);
  for (const delay of [0, 60, 180]) {
    setTimeout(() => pruneInstance(node), delay);
  }
}

app.registerExtension({
  name: "TerryTools.H3TimelineTransportPrune",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    // Same pattern used by Terry | H3 Prompt Editor: remove the backend Autogrow
    // transport sockets from frontend node metadata before ComfyUI creates visible inputs.
    pruneNodeData(nodeData);
    if (nodeType?.nodeData && nodeType.nodeData !== nodeData) pruneNodeData(nodeType.nodeData);
    if (nodeType?.prototype?.constructor?.nodeData && nodeType.prototype.constructor.nodeData !== nodeData) {
      pruneNodeData(nodeType.prototype.constructor.nodeData);
    }

    if (nodeType.prototype.__terryH3TimelineTransportPruneInstalled) return;
    nodeType.prototype.__terryH3TimelineTransportPruneInstalled = true;

    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }

    // Covers old workflows where asset0 / asset1 were serialized into the node.
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      pruneInstance(this);
      return result;
    };
  },
  loadedGraphNode(node) {
    installSoon(node);
  },
});
