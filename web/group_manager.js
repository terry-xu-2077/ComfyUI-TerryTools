import { app } from "../../scripts/app.js";

const NODE_ID = "TerryGroupManager";
const STATE_PROPERTY = "terry_group_manager_groups";
const STYLE_ID = "terry-group-manager-style";
const ROW_HEIGHT = 34;
const ROW_GAP = 6;
const PANEL_PADDING = 8;
const NODE_MIN_WIDTH = 240;
const REFRESH_INTERVAL = 450;
const MODE_ALWAYS = 0;
const MODE_BYPASS = 4;

let refreshTimer = null;

function isChinese() {
  try {
    const locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(locale).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function labels() {
  if (isChinese()) {
    return {
      title: "Terry 分组开关",
      description: "手动选择工作流分组，独立启用或旁路每个分组内的节点。",
      category: "TerryTools/工作流管理",
      choose: "选择分组…",
      missing: "分组不存在",
      enabled: "已启用",
      bypassed: "已旁路",
    };
  }
  return {
    title: "Terry Group Manager",
    description: "Choose workflow groups manually and enable or bypass their nodes independently.",
    category: "TerryTools/Workflow Management",
    choose: "Select a group…",
    missing: "Group unavailable",
    enabled: "Enabled",
    bypassed: "Bypassed",
  };
}

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""
  );
}

function isManager(node) {
  return nodeType(node) === NODE_ID;
}

function graphChildren(graph) {
  const children = [];
  for (const node of graph?._nodes || graph?.nodes || []) {
    if (node?.subgraph) children.push(node.subgraph);
  }
  for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
    if (!collection) continue;
    const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
    for (const child of values) {
      const subgraph = child?.subgraph || child;
      if (subgraph) children.push(subgraph);
    }
  }
  return children;
}

function allGraphs(root = app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    result.push(graph);
    queue.push(...graphChildren(graph));
  }
  return result;
}

function graphGroups(graph) {
  const groups = graph?._groups ?? graph?.groups ?? [];
  if (Array.isArray(groups)) return groups;
  if (typeof groups.values === "function") return [...groups.values()];
  return Object.values(groups);
}

function groupDescriptor(group, graph, graphIndex, groupIndex) {
  const title = String(group?.title || "").trim();
  if (!title) return null;
  const rawGraphId = graph?.id ?? graph?._id ?? graphIndex;
  const rawGroupId = group?.id ?? group?._id;
  const graphId = String(rawGraphId);
  const groupId = rawGroupId == null || rawGroupId === "" ? "" : String(rawGroupId);
  const key = groupId ? `${graphId}:${groupId}` : `${graphId}:title:${title}:${groupIndex}`;
  return { group, graph, graphId, groupId, groupIndex, key, title, label: title };
}

function workflowGroups() {
  const result = [];
  for (const [graphIndex, graph] of allGraphs().entries()) {
    for (const [groupIndex, group] of graphGroups(graph).entries()) {
      const item = groupDescriptor(group, graph, graphIndex, groupIndex);
      if (item) result.push(item);
    }
  }

  const totals = new Map();
  const counts = new Map();
  for (const item of result) totals.set(item.title, (totals.get(item.title) || 0) + 1);
  for (const item of result) {
    if ((totals.get(item.title) || 0) <= 1) continue;
    const count = (counts.get(item.title) || 0) + 1;
    counts.set(item.title, count);
    item.label = `${item.title} (${count})`;
  }
  return result;
}

function savedGroups(node) {
  node.properties ||= {};
  if (!Array.isArray(node.properties[STATE_PROPERTY])) node.properties[STATE_PROPERTY] = [];
  return node.properties[STATE_PROPERTY];
}

function matchingGroup(entry, groups) {
  if (!entry) return null;
  if (entry.groupId) {
    const exact = groups.find((item) => item.groupId === String(entry.groupId) && item.graphId === String(entry.graphId));
    if (exact) return exact;
    const sameId = groups.filter((item) => item.groupId === String(entry.groupId));
    if (sameId.length === 1) return sameId[0];
  }
  if (entry.key) {
    const exact = groups.find((item) => item.key === entry.key);
    if (exact) return exact;
  }
  return groups.find((item) => item.title === entry.title && item.graphId === String(entry.graphId))
    || groups.find((item) => item.title === entry.title)
    || null;
}

function entryForGroup(item, enabled) {
  return {
    key: item.key,
    graphId: item.graphId,
    groupId: item.groupId,
    title: item.title,
    enabled: Boolean(enabled),
  };
}

function groupNodes(group) {
  try {
    group?.recomputeInsideNodes?.();
  } catch (error) {
    console.warn("[TerryTools] Unable to refresh nodes inside group:", error);
  }

  const children = group?._children;
  if (children && typeof children.values === "function") {
    return [...children.values()].filter((node) => node && typeof node.mode === "number");
  }
  const nodes = group?.nodes ?? group?._nodes ?? [];
  return Array.from(nodes).filter((node) => node && typeof node.mode === "number");
}

function groupIsEnabled(group) {
  const nodes = groupNodes(group);
  return nodes.length === 0 || nodes.some((node) => node.mode === MODE_ALWAYS);
}

function changeNodesMode(nodes, mode, visited = new Set()) {
  for (const node of nodes) {
    if (!node || visited.has(node) || isManager(node)) continue;
    visited.add(node);
    node.mode = mode;
    node.setDirtyCanvas?.(true, true);
    const subgraph = node.subgraph;
    if (subgraph) changeNodesMode(subgraph._nodes || subgraph.nodes || [], mode, visited);
  }
}

function markChanged(node) {
  node.graph?.change?.();
  node.graph?.setDirtyCanvas?.(true, true);
  node.setDirtyCanvas?.(true, true);
}

function toggleGroup(node, entry, enabled) {
  const item = matchingGroup(entry, workflowGroups());
  if (!item) return;
  changeNodesMode(groupNodes(item.group), enabled ? MODE_ALWAYS : MODE_BYPASS);
  Object.assign(entry, entryForGroup(item, enabled));
  item.graph?.change?.();
  item.graph?.setDirtyCanvas?.(true, true);
  markChanged(node);
  refreshAllManagers(true);
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .terry-group-manager {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: ${ROW_GAP}px;
      padding: ${PANEL_PADDING}px;
      width: 100%;
    }
    .terry-group-manager__row {
      align-items: center;
      display: flex;
      gap: 8px;
      height: ${ROW_HEIGHT}px;
      min-width: 0;
    }
    .terry-group-manager__select {
      appearance: auto;
      background: var(--comfy-input-bg, #222);
      border: 1px solid var(--border-color, #484848);
      border-radius: 8px;
      box-sizing: border-box;
      color: var(--input-text, #ddd);
      cursor: pointer;
      flex: 1 1 auto;
      font: 12px Inter, system-ui, sans-serif;
      height: ${ROW_HEIGHT}px;
      min-width: 0;
      padding: 0 8px;
      width: 100%;
    }
    .terry-group-manager__select:focus-visible,
    .terry-group-manager__toggle:focus-visible {
      outline: 2px solid var(--p-primary-color, #74a4cf);
      outline-offset: 2px;
    }
    .terry-group-manager__toggle {
      background: #555;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      flex: 0 0 38px;
      height: 22px;
      padding: 2px;
      position: relative;
      transition: background 120ms ease;
      width: 38px;
    }
    .terry-group-manager__toggle::after {
      background: #f4f4f4;
      border-radius: 50%;
      content: "";
      height: 18px;
      left: 2px;
      position: absolute;
      top: 2px;
      transition: transform 120ms ease;
      width: 18px;
    }
    .terry-group-manager__toggle[aria-checked="true"] {
      background: var(--p-primary-color, #71a2c8);
    }
    .terry-group-manager__toggle[aria-checked="true"]::after {
      transform: translateX(16px);
    }
    .terry-group-manager__toggle:disabled {
      cursor: not-allowed;
      opacity: .42;
    }
  `;
  document.head.append(style);
}

function panelHeight(node) {
  return (savedGroups(node).length + 1) * ROW_HEIGHT
    + savedGroups(node).length * ROW_GAP
    + PANEL_PADDING * 2;
}

function resizeManager(node) {
  const measured = node.computeSize?.();
  if (!measured) return;
  const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || 0, Number(measured[0]) || 0);
  const height = Number(measured[1]) || panelHeight(node);
  if (node.size?.[0] !== width || node.size?.[1] !== height) node.setSize?.([width, height]);
  node.setDirtyCanvas?.(true, true);
}

function makeOption(value, label, disabled = false) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  return option;
}

function buildRow(node, panel, groups, entry, index) {
  const text = labels();
  const row = document.createElement("div");
  row.className = "terry-group-manager__row";

  const select = document.createElement("select");
  select.className = "terry-group-manager__select";
  select.setAttribute("aria-label", text.choose);
  select.append(makeOption("", text.choose));

  const selected = entry ? matchingGroup(entry, groups) : null;
  const selectedElsewhere = new Set(
    savedGroups(node)
      .filter((candidate) => candidate !== entry)
      .map((candidate) => matchingGroup(candidate, groups)?.key)
      .filter(Boolean)
  );

  if (entry && !selected) {
    select.append(makeOption("__terry_missing__", `${entry.title} (${text.missing})`, true));
  }
  for (const item of groups) {
    if (selectedElsewhere.has(item.key)) continue;
    select.append(makeOption(item.key, item.label));
  }
  select.value = selected?.key || (entry ? "__terry_missing__" : "");

  select.addEventListener("change", () => {
    const values = savedGroups(node);
    if (!select.value) {
      if (entry) values.splice(index, 1);
    } else {
      const chosen = workflowGroups().find((item) => item.key === select.value);
      if (!chosen) return;
      const next = entryForGroup(chosen, groupIsEnabled(chosen.group));
      if (entry) values[index] = next;
      else values.push(next);
    }
    markChanged(node);
    renderManager(node, true);
  });
  row.append(select);

  if (entry) {
    if (selected) {
      const enabled = groupIsEnabled(selected.group);
      Object.assign(entry, entryForGroup(selected, enabled));
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "terry-group-manager__toggle";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(Boolean(entry.enabled)));
    button.setAttribute("aria-label", `${entry.title}: ${entry.enabled ? text.enabled : text.bypassed}`);
    button.title = entry.enabled ? text.enabled : text.bypassed;
    button.disabled = !selected;
    button.addEventListener("click", () => toggleGroup(node, entry, !entry.enabled));
    row.append(button);
  }

  panel.append(row);
}

function signatureFor(node, groups) {
  return JSON.stringify({
    zh: isChinese(),
    groups: groups.map((item) => [item.key, item.title, item.label]),
    selected: savedGroups(node).map((entry) => {
      const group = matchingGroup(entry, groups);
      const enabled = group ? groupIsEnabled(group.group) : entry.enabled;
      return [entry.key, entry.title, enabled, Boolean(group)];
    }),
  });
}

function renderManager(node, force = false) {
  const panel = node.__terryGroupManager?.panel;
  if (!panel) return;
  const groups = workflowGroups();
  const signature = signatureFor(node, groups);
  if (!force && panel.__terrySignature === signature) return;

  const focused = document.activeElement;
  if (!force && focused && panel.contains(focused)) return;

  panel.__terrySignature = signature;
  panel.replaceChildren();
  for (const [index, entry] of savedGroups(node).entries()) buildRow(node, panel, groups, entry, index);
  buildRow(node, panel, groups, null, savedGroups(node).length);
  resizeManager(node);
}

function installManager(node) {
  if (!isManager(node) || node.__terryGroupManager || typeof node.addDOMWidget !== "function") return;
  installStyle();

  const panel = document.createElement("div");
  panel.className = "terry-group-manager";
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("keydown", (event) => event.stopPropagation());

  const widget = node.addDOMWidget("terry_group_manager_panel", "terry_group_manager_panel", panel, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => panelHeight(node),
    getMaxHeight: () => panelHeight(node),
  });
  if (!widget) {
    panel.remove();
    return;
  }
  widget.serialize = false;
  node.__terryGroupManager = { panel, widget };
  renderManager(node, true);
}

function refreshAllManagers(force = false) {
  let found = false;
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (!isManager(node)) continue;
      found = true;
      installManager(node);
      renderManager(node, force);
    }
  }
  return found;
}

function startRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setInterval(() => {
    if (!refreshAllManagers()) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }, REFRESH_INTERVAL);
}

app.registerExtension({
  name: "TerryTools.GroupManager",

  addCustomNodeDefs(defs) {
    const text = labels();
    defs[NODE_ID] = {
      name: NODE_ID,
      display_name: text.title,
      description: text.description,
      category: text.category,
      python_module: "custom_nodes.ComfyUI-TerryTools",
      input: { required: {} },
      output: [],
      output_name: [],
      output_is_list: [],
      output_node: false,
    };
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      this.isVirtualNode = true;
      this.serialize_widgets = false;
      savedGroups(this);
      installManager(this);
      startRefresh();
      return result;
    };

    nodeType.prototype.applyToGraph = function () {};

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configure?.apply(this, arguments);
      this.isVirtualNode = true;
      savedGroups(this);
      queueMicrotask(() => {
        installManager(this);
        renderManager(this, true);
        startRefresh();
      });
      return result;
    };
  },

  nodeCreated(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => {
      installManager(node);
      renderManager(node, true);
      startRefresh();
    });
  },

  loadedGraphNode(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => {
      installManager(node);
      renderManager(node, true);
      startRefresh();
    });
  },

  afterConfigureGraph() {
    if (refreshAllManagers(true)) startRefresh();
  },
});
