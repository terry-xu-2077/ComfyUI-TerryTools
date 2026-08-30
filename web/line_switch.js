import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "TerryLineSwitch";
const MAX_ROUTES = 64;
const ACTIVE_COLOR = "#ffd45a";
const ACTIVE_GLOW = "rgba(255, 225, 120, 0.42)";
const INDEX_PROPERTY = "terry_line_switch_index";

function localeCode() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function isChinese() {
  const locale = localeCode();
  return locale === "zh" || locale.startsWith("zh-");
}

function text() {
  return isChinese()
    ? { title: "Terry 线路切换器", index: "线路", route: "线路", output: "输出" }
    : { title: "Terry Line Switch", index: "Route", route: "Route", output: "Output" };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isSwitch(node) {
  return nodeType(node) === NODE_TYPE;
}

function graphNodes(graph = app.graph) {
  if (!graph) return [];
  const result = [];
  const seen = new Set();
  const queue = [graph];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const node of current?._nodes || current?.nodes || []) {
      result.push(node);
      if (node?.subgraph) queue.push(node.subgraph);
    }
    for (const collection of [current?.subgraphs, current?._subgraphs]) {
      if (!collection) continue;
      const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
      for (const value of values) queue.push(value?.subgraph || value);
    }
  }
  return result;
}

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

function indexInput(node) {
  return (node?.inputs || []).find((input) => input?.name === "index") || null;
}

function routeInputs(node) {
  return (node?.inputs || []).filter((input) => {
    const name = String(input?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  });
}

function indexWidget(node) {
  return (node?.widgets || []).find((widget) => widget?.name === "index") || null;
}

function clampIndex(value, count) {
  const parsed = Number.parseInt(value, 10);
  const safeCount = Math.max(1, Number(count) || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(parsed, safeCount));
}

function upstreamIntegerValue(node) {
  const input = indexInput(node);
  if (!input || input.link == null || !node?.graph) return null;
  const link = getLink(node.graph, input.link);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  const origin = getNode(node.graph, originId);
  if (!origin) return null;

  // Primitive/int control nodes usually expose their current value as a widget.
  for (const widget of origin.widgets || []) {
    const value = Number.parseInt(widget?.value, 10);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function selectedIndex(node) {
  const routes = routeInputs(node);
  const connectedIndex = indexInput(node)?.link != null;
  if (connectedIndex) {
    const live = upstreamIntegerValue(node);
    if (live != null) return clampIndex(live, routes.length);
    const runtime = Number(node?.properties?.[INDEX_PROPERTY] ?? node?.__terryRuntimeIndex);
    if (Number.isFinite(runtime)) return clampIndex(runtime, routes.length);
  }
  return clampIndex(indexWidget(node)?.value ?? node?.properties?.[INDEX_PROPERTY] ?? 1, routes.length);
}

function activeRoute(node) {
  const routes = routeInputs(node);
  if (!routes.length) return null;
  return routes[selectedIndex(node) - 1] || routes[0] || null;
}

function refreshIndexWidget(node) {
  const widget = indexWidget(node);
  if (!widget) return;
  const count = Math.max(1, routeInputs(node).length);
  const values = Array.from({ length: Math.min(MAX_ROUTES, count) }, (_, index) => index + 1);
  widget.type = "combo";
  widget.options ||= {};
  widget.options.values = values;
  widget.value = clampIndex(widget.value, count);
}

function refreshLabels(node) {
  if (!isSwitch(node)) return;
  const labels = text();
  node.title = labels.title;

  const index = indexInput(node);
  if (index) index.label = labels.index;

  routeInputs(node).forEach((input, routeIndex) => {
    input.label = `${labels.route} ${routeIndex + 1}`;
  });

  const output = node.outputs?.[0];
  if (output) output.label = labels.output;

  refreshIndexWidget(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshNode(node) {
  if (!isSwitch(node)) return;
  node.resizable = false;
  node.serialize_widgets = true;
  node.properties ||= {};
  if (node.properties[INDEX_PROPERTY] == null) node.properties[INDEX_PROPERTY] = 1;
  refreshLabels(node);
}

function connectionPos(node, input, isInput) {
  if (!node || !input) return null;
  const slot = isInput
    ? (node.inputs || []).indexOf(input)
    : (node.outputs || []).indexOf(input);
  if (slot < 0) return null;
  try {
    const out = [0, 0];
    const result = node.getConnectionPos?.(isInput, slot, out) || out;
    if (Array.isArray(result) && Number.isFinite(result[0]) && Number.isFinite(result[1])) return result;
  } catch {}
  return null;
}

function bezier(ctx, start, end) {
  const distance = Math.max(40, Math.abs(end[0] - start[0]) * 0.5);
  const cp1x = start[0] + distance;
  const cp2x = end[0] - distance;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.bezierCurveTo(cp1x, start[1], cp2x, end[1], end[0], end[1]);
}

function drawActiveWire(ctx, node, now) {
  const input = activeRoute(node);
  if (!input || input.link == null || !node?.graph) return;
  const link = getLink(node.graph, input.link);
  if (!link) return;
  const originId = link.origin_id ?? link.originId;
  const originSlot = Number(link.origin_slot ?? link.originSlot ?? 0) || 0;
  const origin = getNode(node.graph, originId);
  const output = origin?.outputs?.[originSlot];
  if (!origin || !output) return;

  const start = connectionPos(origin, output, false);
  const end = connectionPos(node, input, true);
  if (!start || !end) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  bezier(ctx, start, end);
  ctx.strokeStyle = ACTIVE_GLOW;
  ctx.lineWidth = 8;
  ctx.setLineDash([]);
  ctx.stroke();

  bezier(ctx, start, end);
  ctx.strokeStyle = ACTIVE_COLOR;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 9]);
  ctx.lineDashOffset = -((now / 28) % 21);
  ctx.stroke();

  ctx.restore();
}

function drawSwitchHighlights(canvas, ctx) {
  const graph = canvas?.graph || app.graph;
  if (!graph || !ctx) return;
  const now = performance.now();
  for (const node of graph?._nodes || []) {
    if (isSwitch(node)) drawActiveWire(ctx, node, now);
  }
}

function patchCanvas() {
  const Canvas = globalThis.LGraphCanvas;
  if (!Canvas?.prototype || Canvas.prototype.__terryLineSwitchPatched) return false;
  const original = Canvas.prototype.drawConnections;
  if (typeof original !== "function") return false;

  Canvas.prototype.drawConnections = function () {
    const result = original.apply(this, arguments);
    try {
      const ctx = arguments[0] || this.ctx;
      drawSwitchHighlights(this, ctx);
    } catch (error) {
      console.warn("[Terry Line Switch] highlight draw failed", error);
    }
    return result;
  };
  Canvas.prototype.__terryLineSwitchPatched = true;
  return true;
}

function startAnimation() {
  if (globalThis.__terryLineSwitchAnimation) return;
  globalThis.__terryLineSwitchAnimation = true;
  let last = 0;
  const tick = (time) => {
    if (time - last > 45) {
      last = time;
      const hasSwitch = graphNodes().some((node) => isSwitch(node) && activeRoute(node)?.link != null);
      if (hasSwitch) app.graph?.setDirtyCanvas?.(true, false);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function installExecutedListener() {
  if (globalThis.__terryLineSwitchExecutedListener) return;
  globalThis.__terryLineSwitchExecutedListener = true;
  api.addEventListener?.("executed", (event) => {
    const detail = event?.detail || {};
    const nodeId = detail.node ?? detail.node_id;
    const output = detail.output || detail;
    const raw = output?.terry_line_switch_index;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const node = app.graph?.getNodeById?.(nodeId);
    if (!isSwitch(node)) return;
    node.__terryRuntimeIndex = parsed;
    node.properties ||= {};
    node.properties[INDEX_PROPERTY] = parsed;
    node.graph?.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Terry.LineSwitch",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_TYPE) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      queueMicrotask(() => refreshNode(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      queueMicrotask(() => refreshNode(this));
      return result;
    };

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = originalConnections?.apply(this, arguments);
      queueMicrotask(() => refreshNode(this));
      return result;
    };

    const originalWidgetChanged = nodeType.prototype.onWidgetChanged;
    nodeType.prototype.onWidgetChanged = function (name, value) {
      const result = originalWidgetChanged?.apply(this, arguments);
      if (name === "index") {
        this.properties ||= {};
        this.properties[INDEX_PROPERTY] = Number.parseInt(value, 10) || 1;
        this.graph?.setDirtyCanvas?.(true, true);
      }
      return result;
    };
  },

  nodeCreated(node) {
    if (isSwitch(node)) queueMicrotask(() => refreshNode(node));
  },

  loadedGraphNode(node) {
    if (isSwitch(node)) queueMicrotask(() => refreshNode(node));
  },

  setup() {
    patchCanvas();
    installExecutedListener();
    startAnimation();
    setInterval(() => {
      patchCanvas();
      for (const node of graphNodes()) if (isSwitch(node)) refreshLabels(node);
    }, 500);
  },
});
