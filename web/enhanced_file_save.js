import { app } from "../../scripts/app.js";
import { installFileSavePanel, scheduleFileSavePanel } from "./file_save_panel_ui.js";

const NODE_ID="EnhancedFileSave";
const PANEL_PROP="__terryEnhancedSavePanel";
const VALUES_PROP="terry_enhanced_file_save_values";
const DEFAULT_DATE_FORMAT="YYYYMMDDHHmmss";
const DATE_FORMAT_VALUES=new Set(["none","YYYYMMDD_HHmmss","YYYY-MM-DD_HH-mm-ss","YYYY_MM_DD_HH_mm_ss","YYYYMMDDHHmmss","YYYYMMDD_HHmm","YYYY-MM-DD_HH-mm","YYYY_MM_DD_HH_mm","YYYYMMDDHHmm","YYYYMMDD_HH","YYYY-MM-DD_HH","YYYY_MM_DD_HH","YYYYMMDDHH","YYYYMMDD","YYYY-MM-DD","YYYY_MM_DD","YYYYMM"]);
const TYPE_WIDGETS={IMAGE:["image_compress_level"],AUDIO:["audio_format","audio_quality"],VIDEO:["video_format","video_codec","video_encoding","video_crf"],STRING:["text_extension","text_custom_extension"]};
const FILE_WIDGETS=["filename_template","date_format","append_sequence","sequence_start","sequence_padding"];
const VALUE_WIDGETS=[...Object.values(TYPE_WIDGETS).flat(),...FILE_WIDGETS];

function isTarget(node){return [node?.comfyClass,node?.type,node?.constructor?.type,node?.constructor?.nodeData?.name].some((v)=>String(v||"")===NODE_ID);}
function widget(node,name){return node?.widgets?.find((w)=>w?.name===name)||null;}
function setValue(node,name,value){const w=widget(node,name);if(!w)return;w.value=value;if(w._state)w._state.value=value;}
function namedValues(node){const out={};for(const name of VALUE_WIDGETS){const w=widget(node,name);if(w)out[name]=w.value;}return out;}
function restoreNamedValues(node,values){if(!values||typeof values!=="object")return false;let ok=false;for(const name of VALUE_WIDGETS){if(!Object.prototype.hasOwnProperty.call(values,name))continue;setValue(node,name,values[name]);ok=true;}return ok;}
function repairCorruptedValues(node){
  const filename=widget(node,"filename_template"),date=widget(node,"date_format"),rawDate=String(date?.value??"");
  if(date&&!DATE_FORMAT_VALUES.has(rawDate)){
    const current=String(filename?.value??"").trim();
    const filenameInvalid=!current||["auto","h264","re-encode"].includes(current);
    const misplaced=rawDate.includes("%date%")||rawDate.includes("/")||rawDate.includes("\\");
    if(filename&&filenameInvalid&&misplaced)setValue(node,"filename_template",rawDate);
    setValue(node,"date_format",DEFAULT_DATE_FORMAT);
  }
  const f=String(widget(node,"filename_template")?.value??"").trim();
  if(!f||["auto","h264","re-encode"].includes(f))setValue(node,"filename_template","ComfyUI_%date%");
  const vf=widget(node,"video_format");if(vf&&!String(vf.value??"").trim())setValue(node,"video_format","auto");
  const vc=widget(node,"video_codec");if(vc&&!["auto","h264"].includes(String(vc.value??"")))setValue(node,"video_codec","auto");
  const ve=widget(node,"video_encoding");if(ve&&!["auto","re-encode"].includes(String(ve.value??"")))setValue(node,"video_encoding","auto");
  const ap=widget(node,"append_sequence");if(ap&&typeof ap.value!=="boolean")setValue(node,"append_sequence",false);
  const st=widget(node,"sequence_start");if(st&&!Number.isFinite(Number(st.value)))setValue(node,"sequence_start",1);
  const pd=widget(node,"sequence_padding");if(pd&&(!Number.isFinite(Number(pd.value))||Number(pd.value)<1))setValue(node,"sequence_padding",5);
}
function initNode(node){
  if(!isTarget(node)||typeof node.addDOMWidget!=="function")return;
  repairCorruptedValues(node);
  installFileSavePanel(node,{panelProp:PANEL_PROP,widgetName:"terry_enhanced_file_save_panel",typeWidgets:TYPE_WIDGETS,fileWidgets:FILE_WIDGETS,sequence:true});
  scheduleFileSavePanel(node,PANEL_PROP);
}

app.registerExtension({
  name:"TerryTools.EnhancedFileSave.RoundedPanel",
  beforeRegisterNodeDef(nodeType,nodeData){
    if(nodeData.name!==NODE_ID)return;
    const created=nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated=function(){const r=created?.apply(this,arguments);initNode(this);return r;};
    const connections=nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange=function(){const r=connections?.apply(this,arguments);scheduleFileSavePanel(this,PANEL_PROP);return r;};
    const configure=nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure=function(info){const named=info?.properties?.[VALUES_PROP];const r=configure?.apply(this,arguments);queueMicrotask(()=>{if(!restoreNamedValues(this,named))repairCorruptedValues(this);initNode(this);});return r;};
    const serialize=nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize=function(info){repairCorruptedValues(this);const r=serialize?.apply(this,arguments);if(info){info.properties||={};info.properties[VALUES_PROP]=namedValues(this);}return r;};
  },
  nodeCreated(node){if(isTarget(node))queueMicrotask(()=>initNode(node));},
  loadedGraphNode(node){if(isTarget(node))queueMicrotask(()=>initNode(node));},
});
