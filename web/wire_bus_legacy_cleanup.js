import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const UNPACK_TYPE = "TerryWireBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";

function localeBase() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-")
      .split("-")[0];
  } catch {
    return String(navigator.language || "en")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-")
      .split("-")[0];
  }
}

function labels() {
  const zh = localeBase() === "zh";
  return {
    bus: zh ? "总线" : "bus",
    addWire: zh ? "添加线束" : "Add wire",
  };
}

function graphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(linkId) ?? links.get(String(linkId));
      if (found) return found;
    }
    const found = links[linkId] ?? links[String(linkId)];
    if (found) return found;
  }
  return null;
}

function normalizeUnpackInputs(node) {
  if (!node || !Array.isArray(node.inputs)) return;

  // Current schema owns one canonical input named `bus`. Older TerryTools
  // builds serialized a second frontend-created input (often labelled “总线”).
  // Keep the schema input and migrate any old connection before removing extras.
  let keepIndex = node.inputs.findIndex((input) => input?.name === "bus");
  if (keepIndex < 0) {
    keepIndex = node.inputs.findIndex((input) => String(input?.type || "") === BUS_TYPE);
  }
  if (keepIndex < 0) return;

  const duplicateIndexes = [];
  for (let i = 0; i < node.inputs.length; i++) {
    if (i === keepIndex) continue;
    const input = node.inputs[i];
    const name = String(input?.name || "").toLowerCase();
    const label = String(input?.label || "").toLowerCase();
    const looksLegacy =
      String(input?.type || "") === BUS_TYPE ||
      name === "总线" || name === "bus" ||
      label === "总线" || label === "bus";
    if (looksLegacy) duplicateIndexes.push(i);
  }

  const keep = node.inputs[keepIndex];
  if (keep?.link == null) {
    const connectedDuplicate = duplicateIndexes.find((i) => node.inputs[i]?.link != null);
    if (connectedDuplicate != null) {
      const linkId = node.inputs[connectedDuplicate].link;
      const link = graphLink(node.graph, linkId);
      const source = link
        ? node.graph?.getNodeById?.(link.origin_id ?? link.originId)
        : null;
      const originSlot = Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0;

      try {
        node.disconnectInput?.(connectedDuplicate);
        source?.connect?.(originSlot, node, keepIndex);
      } catch (error) {
        console.warn("[Terry Wire Bus] Failed to migrate legacy bus input", error);
      }
    }
  }

  for (const index of duplicateIndexes.sort((a, b) => b - a)) {
    // If a lower index were ever selected as canonical, removing an earlier
    // duplicate would shift it. The canonical schema input is normally index 0,
    // but guard the index for old hand-edited workflows as well.
    if (index === keepIndex) continue;
    try {
      node.removeInput?.(index);
      if (index < keepIndex) keepIndex--;
    } catch (error) {
      console.warn("[Terry Wire Bus] Failed to remove legacy bus input", error);
    }
  }

  const canonical = node.inputs?.[keepIndex];
  if (canonical) {
    canonical.name = "bus"; // stable schema key; never localize
    canonical.label = labels().bus; // display label only
    canonical.type = BUS_TYPE;
  }

  node.graph?.setDirtyCanvas?.(true, true);
}

function localizePackSockets(node) {
  if (!node) return;
  const text = labels();

  const output = node.outputs?.[0];
  if (output) {
    output.name = "bus";
    output.label = text.bus;
    output.type = BUS_TYPE;
  }

  const last = node.inputs?.[node.inputs.length - 1];
  if (last && last.link == null && String(last.type || "") === "*") {
    // Keep the internal dynamic input identity stable enough for serialization;
    // only the visible label follows the UI locale.
    if (last.name === "Add wire" || last.name === "添加线束" || last.name === "wire") {
      last.name = "Add wire";
      last.label = text.addWire;
    }
  }

  node.graph?.setDirtyCanvas?.(true, true);
}

function scheduleNormalize(node, isPack) {
  const run = () => isPack ? localizePackSockets(node) : normalizeUnpackInputs(node);
  queueMicrotask(run);
  requestAnimationFrame(run);
  setTimeout(run, 60);
  setTimeout(run, 200);
}

app.registerExtension({
  name: "Terry.WireBus.LegacyPortCleanup",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== PACK_TYPE && nodeData.name !== UNPACK_TYPE) return;
    const isPack = nodeData.name === PACK_TYPE;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      scheduleNormalize(this, isPack);
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      scheduleNormalize(this, isPack);
      return result;
    };

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = originalConnections?.apply(this, arguments);
      scheduleNormalize(this, isPack);
      return result;
    };
  },

  afterConfigureGraph() {
    for (const node of app.graph?._nodes || []) {
      if (node?.comfyClass === UNPACK_TYPE || node?.type === UNPACK_TYPE) {
        normalizeUnpackInputs(node);
      } else if (node?.comfyClass === PACK_TYPE || node?.type === PACK_TYPE) {
        localizePackSockets(node);
      }
    }
  },
});
