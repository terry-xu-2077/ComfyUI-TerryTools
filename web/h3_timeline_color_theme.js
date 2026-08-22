import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function refreshTimelineAssets(node) {
  if (!isTarget(node)) return;
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.__terryTimelineSyncChips?.();
}

function bindViewRefresh(node) {
  if (!isTarget(node)) return false;
  const root = node.__terryH3ShotTimeline?.root;
  if (!root) return false;
  if (root.__terryTimelineViewRefreshBound) return true;
  root.__terryTimelineViewRefreshBound = true;

  const refreshSoon = () => requestAnimationFrame(() => refreshTimelineAssets(node));
  root.addEventListener("click", (event) => {
    if (event.target?.closest?.(".terry-tl-shot,.terry-tl-meta")) refreshSoon();
  });
  root.addEventListener("focusin", (event) => {
    if (event.target?.closest?.(".terry-tl-card .terry-tl-rich")) refreshSoon();
  });
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => {
    attempts += 1;
    if (bindViewRefresh(node) || attempts >= 12) return;
    setTimeout(run, Math.min(720, attempts * 60));
  };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-color-theme")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-color-theme";
  style.textContent = `
/* Terry H3 timeline — section color hierarchy */
.terry-h3-timeline-root{
  --tl-orange:#f59e0b;
  --tl-orange-soft:rgba(245,158,11,.14);
  --tl-orange-border:rgba(245,158,11,.38);
  --tl-blue:#60a5fa;
  --tl-blue-soft:rgba(96,165,250,.10);
  --tl-blue-border:rgba(96,165,250,.28);
  --tl-purple:#c084fc;
  --tl-purple-soft:rgba(192,132,252,.10);
  --tl-purple-border:rgba(192,132,252,.26);
  --tl-green:#4ade80;
  --tl-green-soft:rgba(74,222,128,.09);
  --tl-green-border:rgba(74,222,128,.24);
  --tl-pink:#f472b6;
  --tl-pink-soft:rgba(244,114,182,.09);
  --tl-pink-border:rgba(244,114,182,.24);
  max-height:none!important;
  overflow:visible!important;
  padding-right:7px!important;
}

/* Header — neutral with an orange timeline identity accent. */
.terry-h3-timeline-root .terry-tl-header{
  padding:7px 8px;
  border:1px solid var(--tl-orange-border);
  border-radius:7px;
  background:linear-gradient(90deg,var(--tl-orange-soft),rgba(245,158,11,.035));
}
.terry-h3-timeline-root .terry-tl-header>b{color:#ffd38a}
.terry-h3-timeline-root .terry-tl-header input[type=range]{accent-color:var(--tl-orange)}
.terry-h3-timeline-root .terry-tl-header input[type=number]{border-color:var(--tl-orange-border);background:rgba(245,158,11,.07)}
.terry-h3-timeline-root .terry-tl-parse-button{border-color:var(--tl-orange-border);background:var(--tl-orange-soft);color:#ffd89a}
.terry-h3-timeline-root .terry-tl-parse-button:hover{background:rgba(245,158,11,.22)}

/* Global description — cool blue, scrolls only inside its own editor. */
.terry-h3-timeline-root .terry-tl-section{
  padding:7px;
  border:1px solid var(--tl-blue-border);
  border-radius:7px;
  background:var(--tl-blue-soft);
}
.terry-h3-timeline-root .terry-tl-section>label{color:#a9d0ff;opacity:.92;font-weight:700}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich{
  max-height:180px;
  overflow-y:auto;
  overscroll-behavior:contain;
  border-color:rgba(96,165,250,.22);
  background:rgba(22,50,84,.22);
}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich:focus{
  border-color:rgba(96,165,250,.55);
  box-shadow:0 0 0 1px rgba(96,165,250,.12);
}

/* Timeline — fixed in place, intentionally orange and visually dominant. */
.terry-h3-timeline-root .terry-tl-lane-head{
  margin-top:9px;
  padding:0 2px;
  color:#ffc56d;
  opacity:1;
  font-weight:700;
}
.terry-h3-timeline-root .terry-tl-lane-head button{
  border-color:var(--tl-orange-border);
  background:var(--tl-orange-soft);
  color:#ffd38a;
}
.terry-h3-timeline-root .terry-tl-lane{
  border-color:rgba(245,158,11,.42);
  background:rgba(72,40,6,.30);
  box-shadow:inset 0 0 0 1px rgba(245,158,11,.05);
}
.terry-h3-timeline-root .terry-tl-shot{
  border-right-color:rgba(255,190,75,.28);
  background:rgba(245,158,11,.11);
  color:#ffe3b0;
}
.terry-h3-timeline-root .terry-tl-shot:nth-of-type(even){background:rgba(251,146,60,.15)}
.terry-h3-timeline-root .terry-tl-shot:hover{background:rgba(245,158,11,.21)}
.terry-h3-timeline-root .terry-tl-shot.is-selected{
  background:rgba(245,158,11,.31);
  box-shadow:inset 0 0 0 1px rgba(255,198,92,.45);
  color:#fff1d6;
}
.terry-h3-timeline-root .terry-tl-shot.is-drop{box-shadow:inset 4px 0 0 #ffd071}
.terry-h3-timeline-root .terry-tl-seam:after{background:#ffb238;box-shadow:0 0 0 1px rgba(85,44,0,.55)}
.terry-h3-timeline-root .terry-tl-seam.is-active:after{background:#ffe0a3;box-shadow:0 0 8px rgba(245,158,11,.55)}

/* Shot descriptions — only this area scrolls vertically. */
.terry-h3-timeline-root .terry-tl-cards{
  max-height:390px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding:6px;
  border:1px solid var(--tl-purple-border);
  border-radius:7px;
  background:rgba(192,132,252,.035);
}
.terry-h3-timeline-root .terry-tl-card{
  border-color:rgba(192,132,252,.18);
  background:var(--tl-purple-soft);
}
.terry-h3-timeline-root .terry-tl-card.is-selected{
  border-color:rgba(192,132,252,.48);
  background:rgba(192,132,252,.16);
}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich{
  max-height:180px;
  overflow-y:auto;
  overscroll-behavior:contain;
  border-color:rgba(192,132,252,.18);
  background:rgba(46,26,66,.20);
}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich:focus{
  border-color:rgba(192,132,252,.48);
  box-shadow:0 0 0 1px rgba(192,132,252,.10);
}
.terry-h3-timeline-root .terry-tl-meta b{color:#dec0ff}
.terry-h3-timeline-root .terry-tl-delete{border-color:rgba(244,114,182,.22);background:rgba(244,114,182,.08);color:#ffc2df}

/* Optional sound blocks — green for diegetic ambience, pink for music. */
.terry-h3-timeline-root .terry-tl-audio{
  padding:8px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:7px;
  background:rgba(255,255,255,.018);
}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(1){color:#9ff1b8}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(2){color:#ffb3d7}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(1) input{accent-color:var(--tl-green)}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(2) input{accent-color:var(--tl-pink)}
.terry-h3-timeline-root .terry-tl-audio textarea:nth-of-type(1){border-color:var(--tl-green-border);background:var(--tl-green-soft)}
.terry-h3-timeline-root .terry-tl-audio textarea:nth-of-type(2){border-color:var(--tl-pink-border);background:var(--tl-pink-soft)}

/* Keep H3 token colors vivid and consistent with the main H3 editor. */
.terry-h3-timeline-root .terry-tl-chip.is-subject{background:rgba(180,140,255,.16);color:#dccaff;border-color:rgba(180,140,255,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-picture{background:rgba(0,210,180,.14);color:#b8fff2;border-color:rgba(0,210,180,.26)}
.terry-h3-timeline-root .terry-tl-chip.is-video{background:rgba(76,170,255,.15);color:#c2e2ff;border-color:rgba(76,170,255,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-audio{background:rgba(255,174,70,.14);color:#ffe0b7;border-color:rgba(255,174,70,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-speaker{background:rgba(255,120,160,.14);color:#ffcbdb;border-color:rgba(255,120,160,.26)}
.terry-h3-timeline-root .terry-tl-chip.is-dialogue{background:rgba(0,226,187,.14);color:#befff4;border-color:rgba(0,226,187,.25)}

/* Scrollbars belong only to text/card areas, never to the whole node. */
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar{width:8px}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-track,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-track{background:rgba(0,0,0,.10)}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-thumb,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-thumb{background:rgba(245,158,11,.26);border-radius:8px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3TimelineColorTheme",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineColorThemeInstalled) return;
    nodeType.prototype.__terryTimelineColorThemeInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        bindSoon(this);
        if (isTarget(this)) this.setDirtyCanvas?.(true, true);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) bindSoon(node); },
});
