import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const TARGETS = new Set(["TerryH3PromptEditor", "TerryH3ShotTimeline"]);

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || node?.constructor?.nodeData?.name || "");
}

function getLink(graph, id) {
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

function origin(graph, linkId) {
  const link = getLink(graph, linkId);
  if (!link) return null;
  const id = link.origin_id ?? link.originId;
  const slot = Number(link.origin_slot ?? link.originSlot ?? 0) || 0;
  const node = graph?.getNodeById?.(id) || app.graph?.getNodeById?.(id);
  return node ? { node, slot } : null;
}

function mediaIndex(node) {
  return node?.inputs?.findIndex?.((x) => String(x?.name || "") === "media") ?? -1;
}

function busPack(node) {
  const input = node?.inputs?.[mediaIndex(node)];
  if (!input || input.link == null) return null;
  const src = origin(node.graph || app.graph, input.link);
  return src && nodeType(src.node) === PACK_TYPE ? src.node : null;
}

function busMediaKeys(node) {
  const pack = busPack(node);
  const keys = new Set();
  for (const input of pack?.inputs || []) {
    if (input?.link == null) continue;
    const src = origin(pack.graph, input.link);
    if (!src) continue;
    const type = String(src.node?.outputs?.[src.slot]?.type || "").toUpperCase();
    if (type !== "IMAGE" && type !== "VIDEO" && type !== "AUDIO") continue;
    keys.add(`${Number(src.node.id)}:${src.slot}`);
  }
  return keys;
}

function migrate(node) {
  if (!TARGETS.has(nodeType(node)) || !node?.__terryNativeBus?.hasBus?.()) return;
  const keys = busMediaKeys(node);
  if (!keys.size) return;
  const direct = node.__terryNativeBus.getDirectLinks?.() || [];
  const next = direct.filter((link) => !keys.has(`${Number(link?.source_id)}:${Number(link?.source_slot) || 0}`));
  if (next.length === direct.length) return;
  node.__terryNativeBus.setDirectLinks?.(next);
}

function run() {
  for (const node of app.graph?._nodes || []) migrate(node);
}

app.registerExtension({
  name: "TerryTools.H3BusLegacyMigration",
  setup() { setTimeout(run, 0); setTimeout(run, 300); },
  nodeCreated(node) { setTimeout(() => migrate(node), 0); },
  loadedGraphNode(node) { setTimeout(() => migrate(node), 0); },
  afterConfigureGraph() { setTimeout(run, 0); setTimeout(run, 300); },
});
