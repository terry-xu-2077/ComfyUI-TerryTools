import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "TerryLineSwitch";
const REMOTE_TYPE = "TerryRemoteControl";
const MAX_ROUTES = 64;
const ACTIVE_COLOR = "#ffd45a";
const ACTIVE_GLOW = "rgba(255, 225, 120, 0.42)";
const INDEX_PROPERTY = "terry_line_switch_index";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";
const REMOTE_VALUE_PROPERTY = "terry_remote_value";
const CHANNEL_WIDGET = "terry_channel";
const REMOTE_CHANNEL_WIDGET = "terry_remote_channel";
const REMOTE_VALUE_WIDGET = "terry_remote_value";

const controlAdapters = new Map();

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
    ? {
        title: "Terry 线路切换器",
        remoteTitle: "Terry 远程控制器",
        index: "线路",
        route: "线路",
        output: "输出",
        channel: "频道",
        selectChannel: "选择频道",
        noChannel: "无可用频道",
        noTarget: "未找到目标",
        control: "控制",
        remoteDescription: "按频道自动识别 Terry 节点控件，并生成对应的远程控制界面。",
      }
    : {
        title: "Terry Line Switch",
        remoteTitle: "Terry Remote Control",
        index: "Route",
        route: "Route",
        output: "Output",
        channel: "Channel",
        selectChannel: "Select Channel",
        noChannel: "No channels",
        noTarget: "Target not found",
        control: "Control",
        remoteDescription: "Detect Terry node controls by channel and build a matching remote control UI.",
      };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isSwitch(node) { return nodeType(node) === NODE_TYPE; }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }

function allGraphs(root = app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    for (const node of current?._nodes || current?.nodes || []) if (node?.subgraph) queue.push(node.subgraph);
    for (const collection of [current?.subgraphs, current?._subgraphs]) {
      if (!collection) continue;
      const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
      for (const value of values) queue.push(value?.subgraph || value);
    }
  }
  return result;
}

function graphNodes(graph = app.graph) {
  return allGraphs(graph).flatMap((item) => item?._nodes || item?.nodes || []);
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

function getNode(graph, id) { return graph?.getNodeById?.(id) || null; }

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
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

function widgetByName(node, name) {
  return (node?.widgets || []).find((widget) => widget?.name === name) || null;
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

function routeValues(node) {
  const count = Math.max(1, routeInputs(node).length);
  return Array.from({ length: Math.min(MAX_ROUTES, count) }, (_, index) => index + 1);
}

function refreshIndexWidget(node) {
  const widget = indexWidget(node);
  if (!widget) return;
  const values = routeValues(node);
  widget.type = "combo";
  widget.options ||= {};
  widget.options.values = values;
  widget.value = clampIndex(widget.value, values.length);
}

function controlChannel(node) {
  return String(properties(node)[CHANNEL_PROPERTY] || widgetByName(node, CHANNEL_WIDGET)?.value || "").trim();
}

function setControlChannel(node, value) {
  const next = String(value || "").trim();
  properties(node)[CHANNEL_PROPERTY] = next;
  const widget = widgetByName(node, CHANNEL_WIDGET);
  if (widget && widget.value !== next) widget.value = next;
  refreshAllRemotes();
  node.graph?.setDirtyCanvas?.(true, true);
}

function uniqueDefaultChannel(node) {
  const base = isChinese() ? "线路切换" : "Line Switch";
  const names = new Set(graphNodes().filter((item) => item !== node).map(controlChannel).filter(Boolean));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

function ensureChannelWidget(node) {
  if (!isSwitch(node) || widgetByName(node, CHANNEL_WIDGET)) return;
  const initial = controlChannel(node) || uniqueDefaultChannel(node);
  properties(node)[CHANNEL_PROPERTY] = initial;
  const widget = node.addWidget?.("text", CHANNEL_WIDGET, initial, (value) => setControlChannel(node, value), {});
  if (widget) {
    widget.label = text().channel;
    widget.serialize = true;
  }
}

function refreshLabels(node) {
  if (!isSwitch(node)) return;
  const labels = text();
  node.title = labels.title;
  const index = indexInput(node);
  if (index) index.label = labels.index;
  routeInputs(node).forEach((input, routeIndex) => { input.label = `${labels.route} ${routeIndex + 1}`; });
  const output = node.outputs?.[0];
  if (output) output.label = labels.output;
  const channel = widgetByName(node, CHANNEL_WIDGET);
  if (channel) channel.label = labels.channel;
  refreshIndexWidget(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshNode(node) {
  if (!isSwitch(node)) return;
  node.resizable = false;
  node.serialize_widgets = true;
  properties(node);
  if (node.properties[INDEX_PROPERTY] == null) node.properties[INDEX_PROPERTY] = 1;
  ensureChannelWidget(node);
  refreshLabels(node);
  refreshAllRemotes();
}

function registerControlAdapter(type, adapter) {
  controlAdapters.set(type, adapter);
}

registerControlAdapter(NODE_TYPE, {
  kind: "combo",
  describe(node) {
    const values = routeValues(node);
    return {
      kind: "combo",
      label: text().index,
      values,
      value: clampIndex(selectedIndex(node), values.length),
    };
  },
  set(node, value) {
    if (indexInput(node)?.link != null) return false;
    const widget = indexWidget(node);
    const next = clampIndex(value, routeValues(node).length);
    if (widget) widget.value = next;
    properties(node)[INDEX_PROPERTY] = next;
    node.__terryRuntimeIndex = next;
    node.onWidgetChanged?.("index", next, widget, widget);
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  },
});

function channelTargets() {
  return graphNodes().filter((node) => controlAdapters.has(nodeType(node)) && controlChannel(node));
}

function channelNames() {
  return [...new Set(channelTargets().map(controlChannel))].sort((a, b) => a.localeCompare(b));
}

function targetForChannel(channel) {
  const name = String(channel || "").trim();
  return channelTargets().find((node) => controlChannel(node) === name) || null;
}

function remoteChannel(node) {
  return String(properties(node)[REMOTE_CHANNEL_PROPERTY] || widgetByName(node, REMOTE_CHANNEL_WIDGET)?.value || "").trim();
}

function setRemoteChannel(node, value) {
  const next = String(value || "").trim();
  properties(node)[REMOTE_CHANNEL_PROPERTY] = next;
  const widget = widgetByName(node, REMOTE_CHANNEL_WIDGET);
  if (widget && widget.value !== next) widget.value = next;
  refreshRemote(node, true);
}

function removeWidget(node, widget) {
  const index = node?.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1);
  widget?.onRemove?.();
}

function ensureRemoteChannelWidget(node) {
  let widget = widgetByName(node, REMOTE_CHANNEL_WIDGET);
  if (!widget) {
    widget = node.addWidget?.("combo", REMOTE_CHANNEL_WIDGET, remoteChannel(node), (value) => setRemoteChannel(node, value), {
      values: () => channelNames(),
    });
  }
  if (!widget) return null;
  widget.label = text().channel;
  widget.options ||= {};
  widget.options.values = () => channelNames();
  widget.serialize = true;
  return widget;
}

function rebuildRemoteValueWidget(node, description, force = false) {
  const signature = description
    ? `${description.kind}|${description.label}|${(description.values || []).join("|")}`
    : "none";
  let widget = widgetByName(node, REMOTE_VALUE_WIDGET);
  if (!force && widget && node.__terryRemoteSignature === signature) return widget;
  if (widget) removeWidget(node, widget);
  node.__terryRemoteSignature = signature;
  if (!description) return null;

  const callback = (value) => {
    const target = targetForChannel(remoteChannel(node));
    const adapter = target && controlAdapters.get(nodeType(target));
    if (!target || !adapter) return;
    if (adapter.set(target, value) !== false) {
      properties(node)[REMOTE_VALUE_PROPERTY] = value;
      node.graph?.setDirtyCanvas?.(true, true);
    }
  };

  if (description.kind === "combo") {
    widget = node.addWidget?.("combo", REMOTE_VALUE_WIDGET, description.value, callback, {
      values: description.values || [],
    });
  } else if (description.kind === "toggle") {
    widget = node.addWidget?.("toggle", REMOTE_VALUE_WIDGET, Boolean(description.value), callback, {});
  } else if (description.kind === "number") {
    widget = node.addWidget?.("number", REMOTE_VALUE_WIDGET, Number(description.value) || 0, callback, description.options || {});
  } else {
    widget = node.addWidget?.("text", REMOTE_VALUE_WIDGET, String(description.value ?? ""), callback, {});
  }
  if (widget) {
    widget.label = description.label || text().control;
    widget.serialize = true;
  }
  return widget;
}

function refreshRemote(node, force = false) {
  if (!isRemote(node)) return;
  node.isVirtualNode = true;
  node.serialize_widgets = true;
  node.resizable = false;
  node.title = text().remoteTitle;
  const channelWidget = ensureRemoteChannelWidget(node);
  const names = channelNames();
  if (channelWidget) {
    channelWidget.options.values = () => channelNames();
    const current = remoteChannel(node);
    if (!current && names.length) {
      channelWidget.value = names[0];
      properties(node)[REMOTE_CHANNEL_PROPERTY] = names[0];
    } else if (current && !names.includes(current)) {
      // Keep the stored name so the remote reconnects automatically if the target returns.
      channelWidget.value = current;
    }
  }

  const target = targetForChannel(remoteChannel(node));
  const adapter = target && controlAdapters.get(nodeType(target));
  const description = adapter?.describe?.(target) || null;
  const valueWidget = rebuildRemoteValueWidget(node, description, force);
  if (valueWidget && description) {
    valueWidget.label = description.label || text().control;
    valueWidget.value = description.value;
    valueWidget.options ||= {};
    if (description.kind === "combo") valueWidget.options.values = description.values || [];
  }
  properties(node)[REMOTE_VALUE_PROPERTY] = description?.value ?? properties(node)[REMOTE_VALUE_PROPERTY];
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshAllRemotes() {
  for (const node of graphNodes()) if (isRemote(node)) refreshRemote(node);
}

function connectionPos(node, input, isInput) {
  if (!node || !input) return null;
  const slot = isInput ? (node.inputs || []).indexOf(input) : (node.outputs || []).indexOf(input);
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
  for (const node of graph?._nodes || []) if (isSwitch(node)) drawActiveWire(ctx, node, now);
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
    for (const graph of allGraphs()) {
      const node = graph?.getNodeById?.(nodeId);
      if (!isSwitch(node)) continue;
      node.__terryRuntimeIndex = parsed;
      properties(node)[INDEX_PROPERTY] = parsed;
      node.graph?.setDirtyCanvas?.(true, true);
      refreshAllRemotes();
      break;
    }
  });
}

function remoteNodeDef() {
  const labels = text();
  return {
    name: REMOTE_TYPE,
    display_name: labels.remoteTitle,
    description: labels.remoteDescription,
    category: isChinese() ? "TerryTools/线束整理" : "TerryTools/Wire Management",
    python_module: "custom_nodes.ComfyUI-TerryTools",
    input: { required: {} },
    output: [],
    output_name: [],
    output_is_list: [],
    output_node: false,
  };
}

app.registerExtension({
  name: "Terry.LineSwitch",

  addCustomNodeDefs(defs) {
    defs[REMOTE_TYPE] = remoteNodeDef();
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === NODE_TYPE) {
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
          properties(this)[INDEX_PROPERTY] = Number.parseInt(value, 10) || 1;
          this.graph?.setDirtyCanvas?.(true, true);
          queueMicrotask(refreshAllRemotes);
        } else if (name === CHANNEL_WIDGET) {
          setControlChannel(this, value);
        }
        return result;
      };
    }

    if (nodeData?.name === REMOTE_TYPE) {
      const originalCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const result = originalCreated?.apply(this, arguments);
        this.isVirtualNode = true;
        this.applyToGraph = function () {};
        queueMicrotask(() => refreshRemote(this, true));
        return result;
      };
      const originalConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const result = originalConfigure?.apply(this, arguments);
        this.isVirtualNode = true;
        this.applyToGraph = function () {};
        queueMicrotask(() => refreshRemote(this, true));
        return result;
      };
      nodeType.prototype.applyToGraph = function () {};
    }
  },

  nodeCreated(node) {
    if (isSwitch(node)) queueMicrotask(() => refreshNode(node));
    if (isRemote(node)) queueMicrotask(() => refreshRemote(node, true));
  },

  loadedGraphNode(node) {
    if (isSwitch(node)) queueMicrotask(() => refreshNode(node));
    if (isRemote(node)) queueMicrotask(() => refreshRemote(node, true));
  },

  setup() {
    patchCanvas();
    installExecutedListener();
    startAnimation();
    setInterval(() => {
      patchCanvas();
      for (const node of graphNodes()) {
        if (isSwitch(node)) refreshLabels(node);
        else if (isRemote(node)) refreshRemote(node);
      }
    }, 500);
  },

  afterConfigureGraph() {
    for (const node of graphNodes()) {
      if (isSwitch(node)) refreshNode(node);
      else if (isRemote(node)) refreshRemote(node, true);
    }
  },
});
