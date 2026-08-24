import { app } from "../../scripts/app.js";

const WARMUP_DELAYS = [0, 50, 200];

function collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === "function") return [...collection.values()];
  if (Array.isArray(collection)) return collection;
  return Object.values(collection);
}

function childSubgraphs(graph) {
  const result = [];

  for (const node of graph?._nodes || graph?.nodes || []) {
    if (node?.subgraph) result.push(node.subgraph);
  }

  for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
    for (const child of collectionValues(collection)) {
      const subgraph = child?.subgraph || child;
      if (subgraph) result.push(subgraph);
    }
  }

  return result;
}

function allGraphs() {
  const root = app.rootGraph || app.graph?.rootGraph || app.graph;
  if (!root) return [];

  const result = [];
  const seen = new Set();
  const queue = [root];

  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    result.push(graph);
    queue.push(...childSubgraphs(graph));
  }

  return result;
}

function graphGroups(graph) {
  const groups = graph?._groups ?? graph?.groups ?? [];
  return collectionValues(groups);
}

function warmGroup(group, graph) {
  if (!group) return;

  // Older / partially initialised subgraphs can have groups before the
  // group.graph back-reference has been populated. LGraphGroup requires it
  // for recomputeInsideNodes().
  if (!group.graph && graph) group.graph = graph;

  try {
    group.recomputeInsideNodes?.();
  } catch (error) {
    console.warn("[TerryTools] Unable to initialise subgraph group members:", error);
  }
}

function warmSubgraphGroups() {
  for (const graph of allGraphs()) {
    for (const group of graphGroups(graph)) warmGroup(group, graph);
  }
}

function scheduleWarmup() {
  for (const delay of WARMUP_DELAYS) {
    if (delay === 0) queueMicrotask(warmSubgraphGroups);
    else setTimeout(warmSubgraphGroups, delay);
  }
}

app.registerExtension({
  name: "TerryTools.GroupManagerSubgraphFix",

  afterConfigureGraph() {
    scheduleWarmup();
  },

  loadedGraphNode() {
    scheduleWarmup();
  },
});
