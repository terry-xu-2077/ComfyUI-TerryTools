import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const PACK_TYPE = "TerryWireBusPack";
const UNPACK_TYPE = "TerryWireBusUnpack";
const VUE_STYLE_ID = "terry-wire-bus-vue-port-style";

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      ""
  );
}

function allLinks(graph) {
  const out = [];
  const seen = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    const values = typeof bag.values === "function" ? bag.values() : Object.values(bag);
    for (const link of values) {
      if (!link) continue;
      const id = link.id ?? link.link_id ?? link.linkId;
      const key = id == null ? link : String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

function linkNodes(graph, link) {
  const originId = link?.origin_id ?? link?.originId;
  const targetId = link?.target_id ?? link?.targetId;
  return {
    origin: graph?.getNodeById?.(originId) || null,
    target: graph?.getNodeById?.(targetId) || null,
    originSlot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
    targetSlot: Number(link?.target_slot ?? link?.targetSlot ?? 0) || 0,
  };
}

function isBusLink(graph, link) {
  const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
  const type = String(
    link?.type ||
      origin?.outputs?.[originSlot]?.type ||
      target?.inputs?.[targetSlot]?.type ||
      ""
  );
  return type === BUS_TYPE || nodeType(origin) === PACK_TYPE;
}

function pointForOutput(node, slot) {
  const p = node?.getOutputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 0), Number(node?.pos?.[1] || 0) + 40];
}

function pointForInput(node, slot) {
  const p = node?.getInputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slot * 20];
}

function busColor(link = null) {
  return (
    link?.color ||
    globalThis.LGraphCanvas?.link_type_colors?.[BUS_TYPE] ||
    globalThis.LGraphCanvas?.link_type_colors?.["*"] ||
    "#9ca3af"
  );
}

function drawBusLane(ctx, start, end, color, width, offset, alpha) {
  const sx = start[0];
  const sy = start[1] + offset;
  const ex = end[0];
  const ey = end[1] + offset;
  const dx = Math.abs(ex - sx);
  const tangent = Math.max(40, Math.min(180, dx * 0.5));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + tangent, sy, ex - tangent, ey, ex, ey);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawBusCable(ctx, start, end, color, baseWidth) {
  const laneWidth = Math.max(2.5, baseWidth);
  const spacing = laneWidth * 0.92;
  const lanes = [
    { offset: -spacing * 2, alpha: 0.92 },
    { offset: -spacing, alpha: 0.56 },
    { offset: 0, alpha: 0.92 },
    { offset: spacing, alpha: 0.56 },
    { offset: spacing * 2, alpha: 0.92 },
  ];
  for (const lane of lanes) drawBusLane(ctx, start, end, color, laneWidth, lane.offset, lane.alpha);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCapsulePort(ctx, node, isOutput, slot = 0) {
  const global = isOutput ? pointForOutput(node, slot) : pointForInput(node, slot);
  const x = global[0] - Number(node?.pos?.[0] || 0);
  const y = global[1] - Number(node?.pos?.[1] || 0);
  const width = 12;
  const height = 30;

  ctx.save();
  roundedRect(ctx, x - width * 0.5, y - height * 0.5, width, height, width * 0.5);
  ctx.fillStyle = busColor();
  ctx.fill();
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.stroke();
  ctx.restore();
}

function attrEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function vueBusNodes() {
  return (app.graph?._nodes || []).filter((node) => {
    const type = nodeType(node);
    return type === PACK_TYPE || type === UNPACK_TYPE;
  });
}

function refreshVuePortStyle() {
  let style = document.getElementById(VUE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VUE_STYLE_ID;
    document.head.append(style);
  }

  const packs = [];
  const unpacks = [];
  for (const node of vueBusNodes()) {
    if (node?.id == null) continue;
    const root = `[data-node-id="${attrEscape(node.id)}"]`;
    if (nodeType(node) === PACK_TYPE) packs.push(`${root} .lg-slot--output [data-testid="slot-connection-dot"]`);
    else unpacks.push(`${root} .lg-slot--input [data-testid="slot-connection-dot"]`);
  }

  const selectors = [...packs, ...unpacks];
  const dotSelectors = [
    ...packs.map((s) => `${s} [data-testid="slot-dot"]`),
    ...unpacks.map((s) => `${s} [data-testid="slot-dot"]`),
  ];

  style.textContent = selectors.length ? `
${selectors.join(",\n")}{
  position:relative;
  overflow:visible;
  width:12px !important;
  min-width:12px !important;
  height:30px !important;
  min-height:30px !important;
  border-radius:999px;
  box-sizing:border-box;
  background:rgba(156,163,175,.94);
  border:1.35px solid rgba(255,255,255,.34);
  box-shadow:inset 0 0 0 1px rgba(20,24,30,.18);
  display:flex;
  align-items:center;
  justify-content:center;
}
${dotSelectors.join(",\n")}{
  position:relative;
  z-index:1;
  flex:none;
}
` : "";
}

let vueStyleQueued = false;
function queueVueStyleRefresh() {
  if (vueStyleQueued) return;
  vueStyleQueued = true;
  requestAnimationFrame(() => {
    vueStyleQueued = false;
    refreshVuePortStyle();
  });
}

function patchBusNode(node) {
  if (!node) return;
  const type = nodeType(node);
  if (type !== PACK_TYPE && type !== UNPACK_TYPE) return;
  queueVueStyleRefresh();
  if (node.__terryBusCapsulePatched) return;
  node.__terryBusCapsulePatched = true;

  const originalForeground = node.onDrawForeground;
  node.onDrawForeground = function (ctx) {
    const result = originalForeground?.apply?.(this, arguments);
    try {
      if (nodeType(this) === PACK_TYPE) drawCapsulePort(ctx, this, true, 0);
      else if (nodeType(this) === UNPACK_TYPE) drawCapsulePort(ctx, this, false, 0);
    } catch (error) {
      console.warn("[Terry Wire Bus] Failed to draw bus capsule port", error);
    }
    return result;
  };
}

function patchExistingBusNodes() {
  for (const node of app.graph?._nodes || []) patchBusNode(node);
  queueVueStyleRefresh();
}

function hideBusLinksForNativeDraw(graph) {
  const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
  if (!busLinks.length) return () => {};

  const bags = [];
  const seenBags = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag || seenBags.has(bag)) continue;
    seenBags.add(bag);
    bags.push(bag);
  }

  const removed = [];
  for (const bag of bags) {
    const isMap = typeof bag.delete === "function" && typeof bag.set === "function";
    for (const link of busLinks) {
      const id = link?.id ?? link?.link_id ?? link?.linkId;
      if (id == null) continue;
      for (const key of [id, String(id)]) {
        const exists = isMap ? bag.has?.(key) : Object.prototype.hasOwnProperty.call(bag, key);
        if (!exists) continue;
        const value = isMap ? bag.get(key) : bag[key];
        removed.push({ bag, isMap, key, value });
        if (isMap) bag.delete(key);
        else delete bag[key];
        break;
      }
    }
  }

  return () => {
    for (const item of removed) {
      if (item.isMap) item.bag.set(item.key, item.value);
      else item.bag[item.key] = item.value;
    }
  };
}

function patchCanvas(canvas) {
  if (!canvas || canvas.__terryWireBusRibbonPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryWireBusRibbonPatched = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function (ctx) {
    const graph = this.graph || app.graph;
    const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
    const restore = hideBusLinksForNativeDraw(graph);
    let result;
    try {
      result = original.apply(this, arguments);
    } finally {
      restore();
    }

    try {
      const baseWidth = Math.max(3, Number(this.connections_width) || 3);
      for (const link of busLinks) {
        const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
        if (!origin || !target) continue;
        drawBusCable(ctx, pointForOutput(origin, originSlot), pointForInput(target, targetSlot), busColor(link), baseWidth);
      }
    } catch (error) {
      console.warn("[Terry Wire Bus] Failed to draw bus cable", error);
    }
    return result;
  };
}

function ensurePatched() {
  patchCanvas(app.canvas);
  patchExistingBusNodes();
}

app.registerExtension({
  name: "TerryTools.WireBusVisual",
  setup() { ensurePatched(); },
  nodeCreated(node) { patchBusNode(node); },
  loadedGraphNode(node) { patchBusNode(node); patchCanvas(app.canvas); },
});
