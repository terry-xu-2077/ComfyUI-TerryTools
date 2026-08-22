import { app } from "../../scripts/app.js";

function installStyle() {
  if (document.getElementById("terry-h3-timeline-scroll-layout-fix")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-scroll-layout-fix";
  style.textContent = `
/* Keep the timeline controls fixed in the node. Only text-heavy editors scroll. */
.terry-h3-timeline-root{
  max-height:none!important;
  overflow:visible!important;
  padding-right:7px!important;
}

/* Global description can grow to a useful size, then scroll inside itself. */
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich{
  max-height:180px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
}

/* Shot descriptions form the main scrolling area. The orange timeline above stays put. */
.terry-h3-timeline-root .terry-tl-cards{
  max-height:390px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding-right:6px;
}

/* Very long individual shot descriptions should not stretch a card indefinitely. */
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich{
  max-height:170px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
}

.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar{width:8px}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-track,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-track{background:rgba(255,255,255,.025);border-radius:8px}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-thumb,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-thumb:hover,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.25)}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3TimelineScrollLayoutFix",
  setup() { installStyle(); },
});
