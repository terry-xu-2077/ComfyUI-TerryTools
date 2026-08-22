import { app } from "../../scripts/app.js";

function installStyle() {
  if (document.getElementById("terry-h3-dialogue-select-theme")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-dialogue-select-theme";
  style.textContent = `
.terry-h3-dialogue-language{
  color:#d8dde6!important;
  background:#24272d!important;
  border:1px solid rgba(255,255,255,.12)!important;
  box-shadow:none!important;
  color-scheme:dark;
}
.terry-h3-dialogue-language:hover{
  background:#2b2f36!important;
  border-color:rgba(255,255,255,.18)!important;
}
.terry-h3-dialogue-language:focus{
  background:#2b2f36!important;
  border-color:rgba(160,180,200,.34)!important;
  outline:none!important;
}
.terry-h3-dialogue-language option{
  color:#d8dde6!important;
  background:#24272d!important;
}
.terry-h3-dialogue-language option:checked{
  color:#f2f4f7!important;
  background:#3a4049!important;
}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryTools.H3DialogueSelectTheme",
  setup() { installStyle(); },
});
