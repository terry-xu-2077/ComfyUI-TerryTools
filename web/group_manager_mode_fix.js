import { app } from "../../scripts/app.js";

const NODE_ID = "TerryGroupManager";
const STATE_PROPERTY = "terry_group_manager_groups";
const MODE_ALWAYS = 0;
const MODE_BYPASS = 4;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === NODE_ID;
}

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function allGraphs(root = app.graph?.rootGraph || app.rootGraph || app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    result.push(graph);
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (node?.subgraph) queue.push(node.subgraph);
    }
    for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
      for (const child of values(collection)) queue.push(child?.subgraph || child);
    }
  }
  return result;
}

function rectOf(item) {
  const bounds = item?._bounding || item?.boundingRect;
  if (bounds && bounds.length >= 4) {
    const result = [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
    if (result.every(Number.isFinite)) return result;
  }
  const pos = item?._pos || item?.pos;
  const size = item?._size || item?.size;
  if (pos?.length >= 2 && size?.length >= 2) {
    const result = [Number(pos[0]), Number(pos[1]), Number(size[0]), Number(size[1])];
    if (result.every(Number.isFinite)) return result;
  }
  return null;
}

function inside(node, groupRect) {
  const rect = rectOf(node);
  if (!rect || !groupRect) return false;
  const [gx, gy, gw, gh] = groupRect;
  const [x, y, w, h] = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh;
}

function findManagerForPanel(panel) {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (isManager(node) && node.__terryGroupManager?.panel === panel) return node;
    }
  }
  return null;
}

function findGraph(entry) {
  return allGraphs().find((graph) => String(graph?.id ?? graph?._id) === String(entry?.graphId)) || null;
}

function findGroup(graph, entry) {
  const groups = values(graph?._groups ?? graph?.groups ?? []);
  if (entry?.groupId != null && entry.groupId !== "") {
    const byId = groups.find((group) => String(group?.id ?? group?._id) === String(entry.groupId));
    if (byId) return byId;
  }
  return groups.find((group) => String(group?.title || "") === String(entry?.title || "")) || null;
}

function groupNodes(graph, group) {
  const groupRect = rectOf(group);
  const nodes = Array.from(graph?._nodes || graph?.nodes || []);
  if (groupRect) return nodes.filter((node) => node && !isManager(node) && inside(node, groupRect));
  try {
    if (!group?.graph && graph) group.graph = graph;
    group?.recomputeInsideNodes?.();
  } catch {}
  return Array.from(group?._nodes || group?.nodes || []).filter((node) => node && !isManager(node));
}

function setModeRecursive(node, mode, visited = new Set()) {
  if (!node || isManager(node) || visited.has(node)) return;
  visited.add(node);
  node.mode = mode;
  node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
  if (node.subgraph) {
    for (const child of node.subgraph?._nodes || node.subgraph?.nodes || []) {
      setModeRecursive(child, mode, visited);
    }
  }
}

function handleToggle(event) {
  const button = event.target?.closest?.(".terry-group-manager__toggle");
  if (!button) return;
  const panel = button.closest?.(".terry-group-manager");
  if (!panel) return;
  const manager = findManagerForPanel(panel);
  if (!manager) return;
  const row = button.closest?.(".terry-group-manager__row");
  const index = row ? Array.from(panel.children).indexOf(row) : -1;
  const entries = manager.properties?.[STATE_PROPERTY];
  const entry = Array.isArray(entries) && index >= 0 ? entries[index] : null;
  if (!entry) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const graph = findGraph(entry);
  const group = graph ? findGroup(graph, entry) : null;
  if (!graph || !group) return;

  const nodes = groupNodes(graph, group);
  const enable = !Boolean(entry.enabled);
  const mode = enable ? MODE_ALWAYS : MODE_BYPASS;
  for (const node of nodes) setModeRecursive(node, mode);

  entry.enabled = enable;
  graph.change?.();
  graph.setDirtyCanvas?.(true, true);
  manager.graph?.change?.();
  manager.setDirtyCanvas?.(true, true);

  button.setAttribute("aria-checked", String(enable));
  button.textContent = enable ? (document.documentElement.lang?.startsWith("zh") ? "开启" : "yes") : (document.documentElement.lang?.startsWith("zh") ? "关闭" : "no");

  console.log("[TerryTools][GroupManagerFix] toggle", {
    group: entry.title,
    graphId: entry.graphId,
    enabled: enable,
    nodes: nodes.map((node) => ({ id: node?.id, type: nodeType(node), mode: node?.mode })),
  });
}

document.addEventListener("click", handleToggle, true);

app.registerExtension({
  name: "TerryTools.GroupManagerModeFix",
});
