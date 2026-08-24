import { app } from "../../scripts/app.js";

const NODE_ID = "TerryGroupManager";
const STATE_PROPERTY = "terry_group_manager_groups";
const MODE_ALWAYS = 0;
const MODE_BYPASS = 4;
const SYNC_INTERVAL = 400;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === NODE_ID;
}

function isChinese() {
  try {
    const locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(locale).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function rootGraph() {
  return app.graph?.rootGraph || app.rootGraph || app.graph || null;
}

function graphsLikeRgthree() {
  const root = rootGraph();
  if (!root) return [];
  const result = [root];
  const seen = new Set(result);
  for (const subgraph of values(root.subgraphs || root._subgraphs)) {
    const graph = subgraph?.subgraph || subgraph;
    if (graph && !seen.has(graph)) {
      seen.add(graph);
      result.push(graph);
    }
  }
  return result;
}

function reduceNodesDepthFirst(nodeOrNodes, callback) {
  const initial = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
  const stack = [];
  for (let i = initial.length - 1; i >= 0; i--) stack.push(initial[i]);
  const visited = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    callback(node);
    const subgraph = node.subgraph;
    const children = subgraph?.nodes || subgraph?._nodes;
    if (!children) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

function graphNodeKey(node) {
  const graph = node?.graph || rootGraph();
  return `${graph?.id ?? graph?._id ?? "root"}:${node?.id}`;
}

function boundingOf(node) {
  let bounds = null;
  try {
    bounds = node?.getBounding?.();
  } catch {}
  if (bounds?.length >= 4 && Array.from(bounds).every((v) => Number.isFinite(Number(v)))) {
    if (!(Number(bounds[0]) === 0 && Number(bounds[1]) === 0 && Number(bounds[2]) === 0 && Number(bounds[3]) === 0)) {
      return [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
    }
  }
  const raw = node?._bounding || node?.boundingRect;
  if (raw?.length >= 4) {
    const result = [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
    if (result.every(Number.isFinite)) return result;
  }
  const pos = node?._pos || node?.pos;
  const size = node?._size || node?.size;
  if (pos?.length >= 2 && size?.length >= 2) {
    const result = [Number(pos[0]), Number(pos[1]), Number(size[0]), Number(size[1])];
    if (result.every(Number.isFinite)) return result;
  }
  return null;
}

function allNodeBoundings() {
  const root = rootGraph();
  const cache = new Map();
  if (!root) return cache;
  reduceNodesDepthFirst(root._nodes || root.nodes || [], (node) => {
    const bounds = boundingOf(node);
    if (bounds) cache.set(graphNodeKey(node), bounds);
  });
  return cache;
}

function recomputeGroup(group, cachedBoundings) {
  const graph = group?.graph;
  const nodes = graph?.nodes || graph?._nodes || [];
  const groupBounds = group?._bounding || group?.boundingRect;
  if (!graph || !groupBounds?.length || groupBounds.length < 4) return [];

  if (group._children?.clear) group._children.clear();
  if (Array.isArray(group.nodes)) group.nodes.length = 0;

  const gx = Number(groupBounds[0]);
  const gy = Number(groupBounds[1]);
  const gw = Number(groupBounds[2]);
  const gh = Number(groupBounds[3]);
  const inside = [];

  for (const node of nodes) {
    if (!node || isManager(node)) continue;
    const bounds = cachedBoundings.get(graphNodeKey(node)) || boundingOf(node);
    if (!bounds) continue;
    const cx = bounds[0] + bounds[2] * 0.5;
    const cy = bounds[1] + bounds[3] * 0.5;
    if (cx >= gx && cx < gx + gw && cy >= gy && cy < gy + gh) {
      inside.push(node);
      group._children?.add?.(node);
      if (Array.isArray(group.nodes)) group.nodes.push(node);
    }
  }
  return inside;
}

function findGroup(entry, cachedBoundings = allNodeBoundings()) {
  const targetGraphId = String(entry?.graphId ?? "");
  const targetGroupId = String(entry?.groupId ?? "");
  const targetTitle = String(entry?.title ?? "");

  for (const graph of graphsLikeRgthree()) {
    const graphId = String(graph?.id ?? graph?._id ?? "");
    if (targetGraphId && graphId !== targetGraphId) continue;
    for (const group of values(graph?._groups || graph?.groups)) {
      const groupId = String(group?.id ?? group?._id ?? "");
      if ((targetGroupId && groupId === targetGroupId) || (!targetGroupId && String(group?.title || "") === targetTitle)) {
        if (!group.graph) group.graph = graph;
        const nodes = recomputeGroup(group, cachedBoundings);
        return { graph, group, nodes };
      }
    }
  }
  return null;
}

function setModeDepthFirst(nodes, mode) {
  reduceNodesDepthFirst(nodes, (node) => {
    if (!node || isManager(node)) return;
    node.mode = mode;
    node.graph?.change?.();
    node.setDirtyCanvas?.(true, true);
  });
}

function actualEnabled(nodes, fallback) {
  if (!nodes.length) return Boolean(fallback);
  return nodes.some((node) => node.mode !== MODE_BYPASS);
}

function managers() {
  const result = [];
  for (const graph of graphsLikeRgthree()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (isManager(node)) result.push(node);
    }
  }
  return result;
}

function updateButton(button, enabled, title = "") {
  if (!button) return;
  const zh = isChinese();
  button.setAttribute("aria-checked", String(enabled));
  button.setAttribute("aria-label", title ? `${title}: ${enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已旁路" : "Bypassed")}` : "");
  button.title = enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已旁路" : "Bypassed");
  button.textContent = enabled ? (zh ? "开启" : "yes") : (zh ? "关闭" : "no");
}

function syncManager(manager, cachedBoundings = allNodeBoundings()) {
  const entries = manager?.properties?.[STATE_PROPERTY];
  if (!Array.isArray(entries)) return;
  const panel = manager.__terryGroupManager?.panel;
  const rows = panel ? Array.from(panel.querySelectorAll(".terry-group-manager__row")) : [];

  entries.forEach((entry, index) => {
    const found = findGroup(entry, cachedBoundings);
    if (!found) return;
    const enabled = actualEnabled(found.nodes, entry.enabled);
    entry.enabled = enabled;
    updateButton(rows[index]?.querySelector?.(".terry-group-manager__toggle"), enabled, entry.title);
  });
}

function syncAllManagers() {
  const cachedBoundings = allNodeBoundings();
  for (const manager of managers()) syncManager(manager, cachedBoundings);
}

function handleToggle(event) {
  const button = event.target?.closest?.(".terry-group-manager__toggle");
  if (!button) return;
  const panel = button.closest?.(".terry-group-manager");
  if (!panel) return;
  const manager = managers().find((node) => node.__terryGroupManager?.panel === panel);
  if (!manager) return;

  const row = button.closest?.(".terry-group-manager__row");
  const index = row ? Array.from(panel.children).indexOf(row) : -1;
  const entries = manager.properties?.[STATE_PROPERTY];
  const entry = Array.isArray(entries) && index >= 0 ? entries[index] : null;
  if (!entry) return;

  const found = findGroup(entry);
  if (!found) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const enable = !actualEnabled(found.nodes, entry.enabled);
  setModeDepthFirst(found.nodes, enable ? MODE_ALWAYS : MODE_BYPASS);
  entry.enabled = enable;
  found.graph?.change?.();
  found.graph?.setDirtyCanvas?.(true, true);
  manager.graph?.change?.();
  manager.setDirtyCanvas?.(true, true);
  updateButton(button, enable, entry.title);
}

document.addEventListener("click", handleToggle, true);
setInterval(syncAllManagers, SYNC_INTERVAL);

app.registerExtension({
  name: "TerryTools.GroupManagerModeFix",
  afterConfigureGraph() {
    queueMicrotask(syncAllManagers);
    setTimeout(syncAllManagers, 50);
  },
});
