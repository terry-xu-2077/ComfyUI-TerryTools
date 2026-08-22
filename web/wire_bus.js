import { app } from "../../scripts/app.js";

// Stable workflow ids. Never localize these.
const PACK_TYPE = "TerryWireBusPack";
const UNPACK_TYPE = "TerryWireBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const EMPTY_TYPE = "*";
const PACK_LANES_PROPERTY = "terry_wire_bus_lanes";
const UNPACK_LANES_PROPERTY = "terry_wire_bus_lane_ids";
const LANE_FIELD = "terry_lane_id";
const COMPACT_NODE_WIDTH = 160;
const COMPACT_NODE_MIN_HEIGHT = 240;
const COMPACT_NODE_HEADER_HEIGHT = 140;
const COMPACT_NODE_LANE_HEIGHT = 38;

let laneSequence = 0;

function newLaneId() {
  try {
    if (globalThis.crypto?.randomUUID) return `lane_${globalThis.crypto.randomUUID()}`;
  } catch {}
  laneSequence += 1;
  return `lane_${Date.now().toString(36)}_${laneSequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function localeCode() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function isChineseLocale() {
  const locale = localeCode();
  return locale === "zh" || locale.startsWith("zh-");
}

function labels() {
  if (isChineseLocale()) {
    return {
      packTitle: "Terry 线束汇总",
      unpackTitle: "Terry 线束还原",
      packDescription: "将任意数量、任意类型的连接汇总为一根虚拟总线，支持 KJNodes Get/Set。",
      unpackDescription: "从虚拟总线自动恢复原始连接的数量、类型和顺序，支持 KJNodes Get/Set。",
      category: "TerryTools/线束整理",
      addWire: "添加线束",
      bus: "总线",
      input: "输入",
      output: "输出",
    };
  }
  return {
    packTitle: "Terry Wire Bus Pack",
    unpackTitle: "Terry Wire Bus Unpack",
    packDescription: "Bundle any number of connections into one virtual bus. Supports KJNodes Get/Set.",
    unpackDescription: "Restore the original connection count, types and order from a virtual bus. Supports KJNodes Get/Set.",
    category: "TerryTools/Wire Management",
    addWire: "Add wire",
    bus: "bus",
    input: "Input",
    output: "Output",
  };
}

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""
  );
}

function isPack(node) { return nodeType(node) === PACK_TYPE; }
function isUnpack(node) { return nodeType(node) === UNPACK_TYPE; }
function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function getLink(graph, linkId) {
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

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function allGraphs(root = app.graph) {
  if (!root) return [];
  const result = [root];
  const seen = new Set(result);
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    for (const node of graph?._nodes || []) {
      if (node?.subgraph && !seen.has(node.subgraph)) {
        seen.add(node.subgraph);
        result.push(node.subgraph);
        queue.push(node.subgraph);
      }
    }
  }
  return result;
}

function graphAncestors(graph) {
  if (!graph) return [];
  const root = graph.rootGraph || app.graph || graph;
  if (graph === root) return [graph];
  const chain = [graph];
  const seen = new Set(chain);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent && root?._nodes) {
      for (const node of root._nodes) {
        if (node?.subgraph === current) { parent = root; break; }
      }
    }
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (root && !chain.includes(root)) chain.push(root);
  return chain;
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  for (const graph of graphAncestors(getNode.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (isSet(node) && variableName(node) === name) return { node, graph };
    }
  }
  return null;
}

function linkOrigin(link) {
  return {
    nodeId: link?.origin_id ?? link?.originId,
    slot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
  };
}

function resolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = getLink(graph, linkId);
  if (!link) return null;
  const { nodeId, slot } = linkOrigin(link);
  const node = getNode(graph, nodeId);
  if (!node) return null;

  if (isReroute(node)) return resolveUpstream(graph, node.inputs?.[0]?.link, seen);

  if (isGet(node)) {
    const setter = findSetter(node);
    const setterLink = setter?.node?.inputs?.[0]?.link;
    if (!setter || setterLink == null) return null;
    return resolveUpstream(setter.graph, setterLink, seen);
  }

  const output = node.outputs?.[slot];
  return {
    node,
    graph,
    nodeId,
    slot,
    type: link.type || output?.type || EMPTY_TYPE,
    name: output?.name || output?.label || null,
  };
}

function collectDownstreamTargets(graph, node, outputSlot, seenNodes = new Set()) {
  const result = [];
  for (const linkId of node?.outputs?.[outputSlot]?.links || []) {
    const link = getLink(graph, linkId);
    if (!link) continue;
    const targetId = link.target_id ?? link.targetId;
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    const target = getNode(graph, targetId);
    if (!target) continue;
    if (isReroute(target)) {
      const key = `${graph?.id || "g"}:${target.id}`;
      if (seenNodes.has(key)) continue;
      seenNodes.add(key);
      result.push(...collectDownstreamTargets(graph, target, 0, seenNodes));
      continue;
    }
    result.push({ node: target, nodeId: targetId, slot: targetSlot, graph });
  }
  return result;
}

function findPackFromUnpack(unpack) {
  const linkId = unpack?.inputs?.[0]?.link;
  if (!unpack?.graph || linkId == null) return null;
  const upstream = resolveUpstream(unpack.graph, linkId);
  return upstream && isPack(upstream.node) ? upstream.node : null;
}

function nodeProperties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function storedPackLanes(pack) {
  const properties = nodeProperties(pack);
  const raw = Array.isArray(properties[PACK_LANES_PROPERTY]) ? properties[PACK_LANES_PROPERTY] : [];
  const lanes = [];
  const seen = new Set();
  for (const value of raw) {
    const lane = typeof value === "string" ? { id: value } : { ...value };
    const id = String(lane?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    lanes.push({
      id,
      name: String(lane.name || "").trim(),
      type: String(lane.type || EMPTY_TYPE).trim() || EMPTY_TYPE,
    });
  }
  properties[PACK_LANES_PROPERTY] = lanes;
  return lanes;
}

function isAddWireInput(input) {
  if (!input || input.link != null || input[LANE_FIELD]) return false;
  return String(input.name || "") === "wire" || String(input.type || EMPTY_TYPE) === EMPTY_TYPE;
}

function ensurePackLanes(pack) {
  if (!pack) return [];
  const stored = storedPackLanes(pack);
  const byId = new Map(stored.map((lane) => [lane.id, lane]));
  const inputs = pack.inputs || [];
  const hasAddWire = inputs.length > 0 && isAddWireInput(inputs[inputs.length - 1]);
  const laneInputCount = inputs.length - (hasAddWire ? 1 : 0);
  const count = Math.max(stored.length, laneInputCount);
  const lanes = [];
  const used = new Set();

  for (let index = 0; index < count; index++) {
    let input = pack.inputs?.[index];
    if (!input) input = pack.addInput?.("wire", EMPTY_TYPE);
    if (!input) continue;

    let id = String(input[LANE_FIELD] || stored[index]?.id || "").trim();
    if (!id || used.has(id)) id = newLaneId();
    used.add(id);
    input[LANE_FIELD] = id;

    const previous = byId.get(id) || stored[index] || {};
    lanes.push({
      id,
      name: String(previous.name || input.label || input.name || "").trim(),
      type: String(previous.type || input.type || EMPTY_TYPE).trim() || EMPTY_TYPE,
    });
  }

  nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes;
  return lanes;
}

function laneInput(pack, laneId) {
  return (pack?.inputs || []).find((input) => input?.[LANE_FIELD] === laneId) || null;
}

function connectedUnpacksForPack(pack) {
  const result = [];
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) {
      if (isUnpack(node) && findPackFromUnpack(node) === pack) result.push(node);
    }
  }
  return result;
}

function ensureUnpackLaneIds(unpack, lanes) {
  const properties = nodeProperties(unpack);
  const stored = Array.isArray(properties[UNPACK_LANES_PROPERTY])
    ? properties[UNPACK_LANES_PROPERTY].map((id) => String(id || ""))
    : [];
  const ids = [];
  for (let index = 0; index < (unpack.outputs?.length || 0); index++) {
    const output = unpack.outputs[index];
    const id = String(output?.[LANE_FIELD] || stored[index] || lanes[index]?.id || "").trim();
    if (!id) continue;
    output[LANE_FIELD] = id;
    ids[index] = id;
  }
  properties[UNPACK_LANES_PROPERTY] = ids;
  return ids;
}

function laneHasOutputLinks(pack, laneId) {
  const lanes = ensurePackLanes(pack);
  for (const unpack of connectedUnpacksForPack(pack)) {
    ensureUnpackLaneIds(unpack, lanes);
    const output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === laneId);
    if ((output?.links?.length || 0) > 0) return true;
  }
  return false;
}

function displayType(type) {
  const value = String(type || EMPTY_TYPE).trim();
  return value && value !== EMPTY_TYPE ? value : null;
}

function numberDuplicateTypes(entries) {
  const totals = new Map();
  const bases = entries.map((entry, index) => {
    const rawName = String(entry.name || "").trim();
    const name = rawName && rawName !== "wire" ? rawName : "";
    return name || displayType(entry.type) || `${labels().input} ${index + 1}`;
  });
  for (const base of bases) totals.set(base, (totals.get(base) || 0) + 1);
  const seen = new Map();
  return entries.map((entry, index) => {
    const base = bases[index];
    const current = (seen.get(base) || 0) + 1;
    seen.set(base, current);
    return { ...entry, name: (totals.get(base) || 0) > 1 ? `${base} ${current}` : base };
  });
}

function packLaneEntries(pack) {
  if (!pack?.graph) return [];
  const lanes = ensurePackLanes(pack);
  const entries = lanes.map((lane, index) => {
    const input = laneInput(pack, lane.id);
    const source = input?.link == null ? null : resolveUpstream(pack.graph, input.link);
    return {
      laneId: lane.id,
      lane,
      input,
      source,
      type: source?.type || lane.type || input?.type || EMPTY_TYPE,
      name: source?.name || lane.name || input?.label || input?.name || `${labels().input} ${index + 1}`,
    };
  });
  const numbered = numberDuplicateTypes(entries);
  for (const entry of numbered) {
    if (entry.source) {
      entry.lane.name = entry.name;
      entry.lane.type = entry.type || EMPTY_TYPE;
    }
  }
  nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes;
  return numbered;
}

function disconnectAllOutputLinks(node, outputIndex) {
  for (const linkId of [...(node.outputs?.[outputIndex]?.links || [])]) {
    const link = getLink(node.graph, linkId);
    if (!link) continue;
    const target = getNode(node.graph, link.target_id ?? link.targetId);
    if (target) node.disconnectOutput?.(outputIndex, target, link.target_slot ?? link.targetSlot ?? 0);
  }
}

function signatureForEntries(entries) {
  return entries.map((entry) =>
    `${entry.laneId}:${entry.source?.nodeId ?? ""}:${entry.source?.slot ?? ""}:${entry.type}:${entry.name}`
  ).join("|");
}

function localizeFixedPorts(node, updateTitle = false) {
  const text = labels();
  if (isPack(node)) {
    const out = node.outputs?.[0];
    if (out) {
      out.name = "bus";
      out.label = text.bus;
      out.type = BUS_TYPE;
    }
    if (updateTitle) node.title = text.packTitle;
  } else if (isUnpack(node)) {
    const input = node.inputs?.[0];
    if (input) {
      input.name = "bus";
      input.label = text.bus;
      input.type = BUS_TYPE;
    }
    if (updateTitle) node.title = text.unpackTitle;
  }
}

function emptyLaneLabel(name, index) {
  const fallback = name || `${labels().input} ${index + 1}`;
  return isChineseLocale() ? `[空] ${fallback}` : `[Empty] ${fallback}`;
}

function compactBusNodeHeight(laneCount) {
  return Math.max(
    COMPACT_NODE_MIN_HEIGHT,
    COMPACT_NODE_HEADER_HEIGHT + Math.max(1, Number(laneCount) || 0) * COMPACT_NODE_LANE_HEIGHT
  );
}

function resizeCompactBusNode(node, laneCount) {
  node?.setSize?.([COMPACT_NODE_WIDTH, compactBusNodeHeight(laneCount)]);
}

function syncUnpack(unpack, force = false) {
  localizeFixedPorts(unpack);
  const pack = findPackFromUnpack(unpack);
  const entries = pack ? packLaneEntries(pack) : [];
  const signature = signatureForEntries(entries);
  if (!force && unpack.__terryBusSignature === signature) return;
  unpack.__terryBusSignature = signature;

  ensureUnpackLaneIds(unpack, entries.map((entry) => entry.lane));
  const desiredIds = new Set(entries.map((entry) => entry.laneId));

  // Delete only lanes that disappeared on the pack side. Never rebuild all outputs:
  // LiteGraph keeps the later output links attached while it shifts their slot indices.
  for (let index = (unpack.outputs?.length || 0) - 1; index >= 0; index--) {
    const output = unpack.outputs[index];
    if (desiredIds.has(output?.[LANE_FIELD])) continue;
    disconnectAllOutputLinks(unpack, index);
    unpack.removeOutput?.(index);
  }

  for (const entry of entries) {
    let output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === entry.laneId);
    if (!output) {
      const previousLength = unpack.outputs?.length || 0;
      const added = unpack.addOutput?.(entry.name || labels().output, entry.type || EMPTY_TYPE);
      output = unpack.outputs?.[previousLength] || added;
      if (output) output[LANE_FIELD] = entry.laneId;
    }
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === entry.laneId);
    if (!output) continue;
    output.type = entry.type || EMPTY_TYPE;
    output.name = entry.source ? entry.name : emptyLaneLabel(entry.name, index);
    output.label = output.name;
  }

  nodeProperties(unpack)[UNPACK_LANES_PROPERTY] = (unpack.outputs || []).map(
    (output) => output?.[LANE_FIELD] || ""
  );

  resizeCompactBusNode(unpack, entries.length);
  unpack.graph?.setDirtyCanvas?.(true, true);
}

function syncAllUnpacks() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) if (isUnpack(node)) syncUnpack(node);
  }
}

function refreshPackSlots(pack) {
  if (!pack?.graph || app.configuringGraph) return;
  const text = labels();
  localizeFixedPorts(pack);
  let entries = packLaneEntries(pack);

  // First mirror every lane to connected unpack nodes. This gives legacy workflows
  // stable lane ids before deciding whether an empty lane is still in use.
  for (const unpack of connectedUnpacksForPack(pack)) syncUnpack(unpack, true);

  // An unplugged input is retained while any paired output is connected. It is
  // garbage-collected only after both ends of that exact lane are unused.
  const removable = entries.filter((entry) => !entry.source && !laneHasOutputLinks(pack, entry.laneId));
  for (const entry of removable) {
    const index = (pack.inputs || []).findIndex((input) => input?.[LANE_FIELD] === entry.laneId);
    if (index >= 0) pack.removeInput?.(index);
    const lanes = storedPackLanes(pack);
    nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes.filter((lane) => lane.id !== entry.laneId);
  }

  entries = packLaneEntries(pack);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const input = entry.input;
    if (!input) continue;
    input.name = entry.source ? entry.name : `lane_${entry.laneId}`;
    input.label = entry.source ? entry.name : emptyLaneLabel(entry.name, index);
    input.type = entry.source?.type || EMPTY_TYPE;
  }

  const last = pack.inputs?.[pack.inputs.length - 1];
  if (!last || last[LANE_FIELD] || last.link != null || last.type !== EMPTY_TYPE) {
    const input = pack.addInput("wire", EMPTY_TYPE);
    if (input) input.label = text.addWire;
  } else {
    last.name = "wire";
    last.label = text.addWire;
    last.type = EMPTY_TYPE;
  }

  resizeCompactBusNode(pack, entries.length);
  queueMicrotask(syncAllUnpacks);
  pack.graph?.setDirtyCanvas?.(true, true);
}

function patchGraphToPrompt() {
  if (app.__terryWireBusPatched) return;
  app.__terryWireBusPatched = true;
  const original = app.graphToPrompt?.bind(app);
  if (!original) return;

  app.graphToPrompt = async function (...args) {
    const result = await original(...args);
    try {
      const prompt = result?.output;
      if (!prompt) return result;

      for (const graph of allGraphs(this.graph || app.graph)) {
        for (const unpack of graph?._nodes || []) {
          if (!isUnpack(unpack)) continue;
          const pack = findPackFromUnpack(unpack);
          if (!pack) continue;
          const entries = packLaneEntries(pack);

          for (const entry of entries) {
            const source = entry?.source;
            if (!source) continue;
            const outputIndex = (unpack.outputs || []).findIndex(
              (output) => output?.[LANE_FIELD] === entry.laneId
            );
            if (outputIndex < 0) continue;
            for (const target of collectDownstreamTargets(graph, unpack, outputIndex)) {
              if (isPack(target.node) || isUnpack(target.node) || isReroute(target.node) || isGet(target.node) || isSet(target.node)) continue;
              const targetPrompt = prompt[String(target.nodeId)] || prompt[target.nodeId];
              const input = target.node?.inputs?.[target.slot];
              if (!targetPrompt?.inputs || !input?.name) continue;
              targetPrompt.inputs[input.name] = [String(source.nodeId), source.slot];
            }
          }
        }
      }
    } catch (error) {
      console.error("[Terry Wire Bus] Failed to expand virtual bus", error);
      throw error;
    }
    return result;
  };
}

let bridgeTimer = null;
let lastBridgeLocale = localeCode();
function startBridge() {
  if (bridgeTimer) return;
  bridgeTimer = setInterval(() => {
    const nextLocale = localeCode();
    const localeChanged = nextLocale !== lastBridgeLocale;
    if (localeChanged) lastBridgeLocale = nextLocale;
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) {
        if (isPack(node)) {
          localizeFixedPorts(node, localeChanged);
          const last = node.inputs?.[node.inputs.length - 1];
          if (last?.link == null && last?.type === EMPTY_TYPE) last.label = labels().addWire;
        }
        if (isUnpack(node)) {
          localizeFixedPorts(node, localeChanged);
          syncUnpack(node);
        }
      }
    }
  }, 300);
}

function makeNodeDef(name, displayName, description, category, input, output, outputName) {
  return {
    name,
    display_name: displayName,
    description,
    category,
    python_module: "custom_nodes.ComfyUI-TerryTools",
    input,
    output,
    output_name: outputName,
    output_is_list: output.map(() => false),
    output_node: false,
  };
}

app.registerExtension({
  name: "Terry.WireBus",

  addCustomNodeDefs(defs) {
    const text = labels();
    defs[PACK_TYPE] = makeNodeDef(
      PACK_TYPE,
      text.packTitle,
      text.packDescription,
      text.category,
      { required: { wire: [EMPTY_TYPE, { label: text.addWire }] } },
      [BUS_TYPE],
      [text.bus]
    );
    defs[UNPACK_TYPE] = makeNodeDef(
      UNPACK_TYPE,
      text.unpackTitle,
      text.unpackDescription,
      text.category,
      { required: { bus: [BUS_TYPE, { label: text.bus }] } },
      [],
      []
    );
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== PACK_TYPE && nodeData.name !== UNPACK_TYPE) return;
    const isPackDef = nodeData.name === PACK_TYPE;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      this.isVirtualNode = true;
      this.serialize_widgets = false;
      localizeFixedPorts(this, true);
      if (isPackDef) {
        const first = this.inputs?.[0];
        if (first) {
          first.name = "wire";
          first.label = labels().addWire;
          first.type = EMPTY_TYPE;
        }
        queueMicrotask(() => refreshPackSlots(this));
      } else {
        queueMicrotask(() => syncUnpack(this, true));
      }
      return result;
    };

    nodeType.prototype.applyToGraph = function () {};

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index) {
      const result = originalConnections?.apply(this, arguments);
      if (app.configuringGraph) return result;
      if (isPackDef) {
        if (type === LiteGraph.INPUT) queueMicrotask(() => refreshPackSlots(this));
        else queueMicrotask(syncAllUnpacks);
      } else if (type === LiteGraph.INPUT && index === 0) {
        queueMicrotask(() => syncUnpack(this, true));
      } else if (type === LiteGraph.OUTPUT) {
        const pack = findPackFromUnpack(this);
        if (pack) queueMicrotask(() => refreshPackSlots(pack));
      }
      return result;
    };

    if (isPackDef) {
      nodeType.prototype.onConnectInput = function (slot, type) {
        return slot >= 0 && type !== BUS_TYPE;
      };
      nodeType.prototype.onConnectOutput = function (slot, type, input, targetNode) {
        return slot === 0 && (isUnpack(targetNode) || isReroute(targetNode) || isSet(targetNode));
      };
    } else {
      nodeType.prototype.onConnectInput = function (slot, type, output, originNode) {
        return slot === 0 && (type === BUS_TYPE || isPack(originNode) || isReroute(originNode) || isGet(originNode));
      };
    }

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      localizeFixedPorts(this, true);
      if (isPackDef) queueMicrotask(() => refreshPackSlots(this));
      else queueMicrotask(() => syncUnpack(this, true));
      return result;
    };
  },

  async setup() {
    patchGraphToPrompt();
    startBridge();
  },

  afterConfigureGraph() {
    patchGraphToPrompt();
    startBridge();
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) {
        if (isPack(node)) refreshPackSlots(node);
        if (isUnpack(node)) syncUnpack(node, true);
      }
    }
  },
});
