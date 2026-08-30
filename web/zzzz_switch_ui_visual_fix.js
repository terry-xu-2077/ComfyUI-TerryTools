import { app } from "../../scripts/app.js";

const LINE_TYPE = "TerryLineSwitch";
const BOOL_TYPE = "TerryBoolSwitch";
const REMOTE_TYPE = "TerryRemoteControl";
const LINE_NAMES_PROPERTY = "terry_line_switch_names";
const INDEX_PROPERTY = "terry_line_switch_index";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}
function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isBool(node) { return nodeType(node) === BOOL_TYPE; }
function isSwitch(node) { return isLine(node) || isBool(node); }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }
function props(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}
function widget(node, name) { return (node?.widgets || []).find((w) => w?.name === name) || null; }
function input(node, name) { return (node?.inputs || []).find((i) => i?.name === name) || null; }
function routes(node) {
  return (node?.inputs || []).filter((i) => {
    const n = String(i?.name || "");
    return n.startsWith("routes.") || n.startsWith("route_");
  });
}
function zh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const l = String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
    return l === "zh" || l.startsWith("zh-");
  } catch { return String(navigator.language || "en").toLowerCase().startsWith("zh"); }
}
function routeKey(i, idx) { return String(i?.name || "").trim() || `route_${idx + 1}`; }
function routeName(node, i, idx) {
  const names = props(node)[LINE_NAMES_PROPERTY];
  const custom = names && typeof names === "object" ? String(names[routeKey(i, idx)] || "").trim() : "";
  return custom || `${zh() ? "线路" : "Route"} ${idx + 1}`;
}
function displayValues(node) {
  const rs = routes(node);
  return rs.length ? rs.map((i, idx) => `${idx + 1} · ${routeName(node, i, idx)}`) : [`1 · ${zh() ? "线路" : "Route"} 1`];
}
function clampIndex(value, count) {
  const parsed = Number.parseInt(value, 10);
  const c = Math.max(1, Number(count) || 1);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 1, c));
}
function numericIndex(node) {
  return clampIndex(props(node)[INDEX_PROPERTY] ?? widget(node, "index")?.value ?? 1, routes(node).length);
}

function installDisplayCombo(node) {
  if (!isLine(node)) return;
  const w = widget(node, "index");
  if (!w) return;
  const values = displayValues(node);
  const idx = numericIndex(node);
  const signature = values.join("\u0001");
  if (w.__terryNamedSignature !== signature) {
    w.type = "combo";
    w.options ||= {};
    w.options.values = values;
    w.__terryNamedSignature = signature;
  }
  const shown = values[idx - 1] || values[0];
  if (w.value !== shown) w.value = shown;
  props(node)[INDEX_PROPERTY] = idx;
}

function channel(node) { return String(props(node)[CHANNEL_PROPERTY] || widget(node, "terry_channel")?.value || "").trim(); }
function remoteChannel(node) { return String(props(node)[REMOTE_CHANNEL_PROPERTY] || widget(node, "terry_remote_channel")?.value || "").trim(); }
function allNodes() {
  const out = [], seen = new Set(), q = app.graph ? [app.graph] : [];
  while (q.length) {
    const g = q.shift();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    for (const n of g?._nodes || g?.nodes || []) { out.push(n); if (n?.subgraph) q.push(n.subgraph); }
    for (const c of [g?.subgraphs, g?._subgraphs]) if (c) {
      const vals = typeof c.values === "function" ? c.values() : Object.values(c);
      for (const v of vals) q.push(v?.subgraph || v);
    }
  }
  return out;
}
function targetForRemote(remote) {
  const ch = remoteChannel(remote);
  return ch ? allNodes().find((n) => isLine(n) && channel(n) === ch) || null : null;
}
function installRemoteDisplay(remote) {
  if (!isRemote(remote)) return;
  const target = targetForRemote(remote);
  const w = widget(remote, "terry_remote_value");
  if (!target || !w) return;
  const values = displayValues(target);
  const idx = numericIndex(target);
  const sig = values.join("\u0001");
  if (w.__terryNamedSignature !== sig) {
    w.type = "combo";
    w.options ||= {};
    w.options.values = values;
    w.__terryNamedSignature = sig;
  }
  const shown = values[idx - 1] || values[0];
  if (w.value !== shown) w.value = shown;
}

function patchPrompt() {
  if (app.__terrySwitchPromptPatched) return;
  const original = app.graphToPrompt?.bind(app);
  if (!original) return;
  app.graphToPrompt = async function () {
    const result = await original(...arguments);
    const output = result?.output || result?.prompt || result;
    for (const n of allNodes()) {
      if (!isLine(n)) continue;
      const id = String(n.id);
      const entry = output?.[id] || output?.[n.id];
      if (entry?.inputs && Object.prototype.hasOwnProperty.call(entry.inputs, "index")) {
        entry.inputs.index = numericIndex(n);
      }
    }
    return result;
  };
  app.__terrySwitchPromptPatched = true;
}

function getLink(graph, id) {
  if (!graph || id == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") { const f = links.get(id) ?? links.get(String(id)); if (f) return f; }
    const f = links[id] ?? links[String(id)]; if (f) return f;
  }
  return null;
}
function getNode(graph, id) { return graph?.getNodeById?.(id) || null; }
function selectedInput(node) {
  if (isLine(node)) {
    const rs = routes(node);
    return rs[numericIndex(node) - 1] || rs[0] || null;
  }
  if (isBool(node)) {
    const enabled = Boolean(widget(node, "enabled")?.value ?? props(node).terry_bool_switch_state ?? false);
    return input(node, enabled ? "input_true" : "input_false");
  }
  return null;
}
function connectionPos(node, slot, isInput) {
  const arr = isInput ? node?.inputs : node?.outputs;
  const idx = arr?.indexOf(slot) ?? -1;
  if (idx < 0) return null;
  try {
    const out = [0, 0];
    const p = node.getConnectionPos?.(isInput, idx, out) || out;
    return Array.isArray(p) ? p : null;
  } catch { return null; }
}
function point(start, end, t) {
  const d = Math.max(40, Math.abs(end[0] - start[0]) * 0.5);
  const x1 = start[0] + d, x2 = end[0] - d;
  const u = 1 - t;
  return [
    u*u*u*start[0] + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*end[0],
    u*u*u*start[1] + 3*u*u*t*start[1] + 3*u*t*t*end[1] + t*t*t*end[1],
  ];
}
function path(ctx, start, end) {
  const d = Math.max(40, Math.abs(end[0] - start[0]) * 0.5);
  ctx.beginPath(); ctx.moveTo(start[0], start[1]);
  ctx.bezierCurveTo(start[0] + d, start[1], end[0] - d, end[1], end[0], end[1]);
}
function drawFlow(ctx, node, now) {
  const inp = selectedInput(node);
  if (!inp || inp.link == null || !node?.graph) return;
  const link = getLink(node.graph, inp.link); if (!link) return;
  const origin = getNode(node.graph, link.origin_id ?? link.originId);
  const out = origin?.outputs?.[Number(link.origin_slot ?? link.originSlot ?? 0) || 0];
  if (!origin || !out) return;
  const a = connectionPos(origin, out, false), b = connectionPos(node, inp, true);
  if (!a || !b) return;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash([]);
  path(ctx, a, b); ctx.strokeStyle = "rgba(255,214,92,0.38)"; ctx.lineWidth = 2.2; ctx.stroke();
  path(ctx, a, b); ctx.strokeStyle = "rgba(255,225,135,0.10)"; ctx.lineWidth = 6; ctx.stroke();
  const center = (now % 5600) / 5600;
  const span = 0.18; const steps = 22;
  for (let s = 0; s < steps; s++) {
    const ta = center - span/2 + (span * s / steps);
    const tb = center - span/2 + (span * (s + 1) / steps);
    if (tb < 0 || ta > 1) continue;
    const ca = Math.max(0, ta), cb = Math.min(1, tb);
    const p1 = point(a, b, ca), p2 = point(a, b, cb);
    const mid = (s + 0.5) / steps;
    const alpha = Math.sin(Math.PI * mid) * 0.75;
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
    ctx.strokeStyle = `rgba(255,239,183,${alpha.toFixed(3)})`; ctx.lineWidth = 3.4; ctx.stroke();
  }
  ctx.restore();
}

function patchCanvas() {
  const C = globalThis.LGraphCanvas;
  if (!C?.prototype?.drawConnections || C.prototype.__terrySoftFlowPatched) return false;
  const previous = C.prototype.drawConnections;
  C.prototype.drawConnections = function () {
    const ctx = arguments[0] || this.ctx;
    const hidden = [];
    for (const n of this.graph?._nodes || []) {
      if (!isSwitch(n)) continue;
      const inp = selectedInput(n); const l = inp?.link != null ? getLink(n.graph, inp.link) : null;
      if (l) { hidden.push([l, l.color]); l.color = "rgba(0,0,0,0)"; }
    }
    const oldStroke = ctx?.stroke?.bind(ctx);
    if (ctx && oldStroke) {
      ctx.stroke = function () {
        const style = String(ctx.strokeStyle || "").replace(/\s+/g, "");
        if (style === "#ffd45a" || style === "rgba(255,225,120,0.42)") return;
        return oldStroke();
      };
    }
    let result;
    try { result = previous.apply(this, arguments); }
    finally {
      if (ctx && oldStroke) ctx.stroke = oldStroke;
      for (const [l, color] of hidden) l.color = color;
    }
    try { const now = performance.now(); for (const n of this.graph?._nodes || []) if (isSwitch(n)) drawFlow(ctx, n, now); } catch {}
    return result;
  };
  C.prototype.__terrySoftFlowPatched = true;
  return true;
}

function installNodeHooks(nodeTypeClass, nodeData) {
  if (nodeData?.name !== LINE_TYPE) return;
  const oldChanged = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function (name, value) {
    let next = value;
    if (name === "index") {
      next = clampIndex(value, routes(this).length);
      props(this)[INDEX_PROPERTY] = next;
    }
    const r = oldChanged?.call(this, name, next, ...Array.prototype.slice.call(arguments, 2));
    queueMicrotask(() => installDisplayCombo(this));
    return r;
  };
}

app.registerExtension({
  name: "Terry.SwitchUiVisualFix",
  beforeRegisterNodeDef(nodeTypeClass, nodeData) { installNodeHooks(nodeTypeClass, nodeData); },
  nodeCreated(node) { queueMicrotask(() => { installDisplayCombo(node); installRemoteDisplay(node); }); },
  loadedGraphNode(node) { queueMicrotask(() => { installDisplayCombo(node); installRemoteDisplay(node); }); },
  setup() {
    patchPrompt(); patchCanvas();
    setInterval(() => {
      patchCanvas(); patchPrompt();
      for (const n of allNodes()) { if (isLine(n)) installDisplayCombo(n); else if (isRemote(n)) installRemoteDisplay(n); }
    }, 700);
    const tick = () => { if (allNodes().some((n) => isSwitch(n) && selectedInput(n)?.link != null)) app.graph?.setDirtyCanvas?.(true, false); setTimeout(tick, 90); };
    tick();
  },
  afterConfigureGraph() { for (const n of allNodes()) { installDisplayCombo(n); installRemoteDisplay(n); } },
});
