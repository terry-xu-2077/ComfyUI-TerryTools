import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const UNPACK_TYPE = "TerryWireBusUnpack";
const EMPTY_TYPE = "*";
const LANE_FIELD = "terry_lane_id";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isPack(node) { return nodeType(node) === PACK_TYPE; }
function isUnpack(node) { return nodeType(node) === UNPACK_TYPE; }
function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function graphLink(graph, id) {
  if (!graph || id == null) return null;
  for (const bag of [graph.links, graph._links]) {
    if (!bag) continue;
    if (typeof bag.get === "function") {
      const hit = bag.get(id) ?? bag.get(String(id));
      if (hit) return hit;
    }
    const hit = bag[id] ?? bag[String(id)];
    if (hit) return hit;
  }
  return null;
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  const graph = getNode?.graph || app.graph;
  for (const node of graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  for (const node of app.graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  return null;
}

function resolveSource(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${linkId}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = graphLink(graph, linkId);
  if (!link) return null;
  const source = graph.getNodeById?.(link.origin_id ?? link.originId);
  if (!source) return null;
  const slot = Number(link.origin_slot ?? link.originSlot ?? 0) || 0;

  if (isReroute(source)) return resolveSource(graph, source.inputs?.[0]?.link, seen);
  if (isGet(source)) {
    const setter = findSetter(source);
    if (setter?.inputs?.[0]?.link != null) return resolveSource(setter.graph || graph, setter.inputs[0].link, seen);
  }
  return { node: source, slot, output: source.outputs?.[slot] || null };
}

function cleanName(value) {
  const text = String(value ?? "").trim();
  return text && text !== EMPTY_TYPE ? text : "";
}

function preferredPortName(source) {
  const output = source?.output;
  if (!output) return "";
  const type = cleanName(output.type).toUpperCase();
  const candidates = [output.localized_name, output.label, output.name];
  for (const candidate of candidates) {
    const name = cleanName(candidate);
    if (!name) continue;
    // A label/name that is only the raw data type is not a semantic port name.
    if (name.toUpperCase() === type) continue;
    return name;
  }
  return "";
}

function fallbackType(source, input) {
  return cleanName(source?.output?.type || input?.type || EMPTY_TYPE) || "Input";
}

function namedEntries(pack) {
  const entries = [];
  for (const input of pack?.inputs || []) {
    const laneId = String(input?.[LANE_FIELD] || "").trim();
    if (!input || !laneId || input.link == null) continue;
    const source = resolveSource(pack.graph, input.link);
    if (!source) continue;
    const semantic = preferredPortName(source);
    const base = semantic || fallbackType(source, input);
    entries.push({ laneId, input, source, base });
  }

  const totals = new Map();
  for (const entry of entries) totals.set(entry.base, (totals.get(entry.base) || 0) + 1);
  const seen = new Map();
  for (const entry of entries) {
    const n = (seen.get(entry.base) || 0) + 1;
    seen.set(entry.base, n);
    entry.label = (totals.get(entry.base) || 0) > 1 ? `${entry.base} ${n}` : entry.base;
  }
  return entries;
}

function findPackForUnpack(unpack) {
  const source = resolveSource(unpack?.graph, unpack?.inputs?.[0]?.link);
  return source && isPack(source.node) ? source.node : null;
}

function applyNames(pack) {
  if (!isPack(pack) || !pack.graph) return;
  const entries = namedEntries(pack);
  for (const entry of entries) {
    entry.input.name = entry.label;
    entry.input.label = entry.label;
  }

  for (const node of pack.graph?._nodes || []) {
    if (!isUnpack(node)) continue;
    if (findPackForUnpack(node) !== pack) continue;
    for (const entry of entries) {
      const output = (node.outputs || []).find((item) => item?.[LANE_FIELD] === entry.laneId);
      if (!output) continue;
      output.name = entry.label;
      output.label = entry.label;
    }
    node.setDirtyCanvas?.(true, true);
  }
  pack.setDirtyCanvas?.(true, true);
}

function schedule(node) {
  setTimeout(() => {
    if (isPack(node)) applyNames(node);
    else if (isUnpack(node)) {
      const pack = findPackForUnpack(node);
      if (pack) applyNames(pack);
    }
  }, 0);
}

app.registerExtension({
  name: "TerryTools.WireBusNamedPorts",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== PACK_TYPE && nodeData?.name !== UNPACK_TYPE) return;

    const oldConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = oldConnections?.apply(this, arguments);
      schedule(this);
      return result;
    };

    const oldConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = oldConfigure?.apply(this, arguments);
      schedule(this);
      return result;
    };
  },

  nodeCreated(node) { schedule(node); },
  loadedGraphNode(node) { schedule(node); },

  afterConfigureGraph() {
    setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isPack(node)) applyNames(node);
    }, 0);
  },
});
