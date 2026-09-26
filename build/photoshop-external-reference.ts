import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type ExternalLayer = {
  path: number[]; name: string; type: string; kind: string;
  visible: boolean; opacity: number; blend: string; clipping: boolean;
  mask: boolean; vectorMask: boolean; text?: string; font?: string;
};
export type ExternalDocument = {
  application: string; version: string; width: number; height: number;
  resolution: number; depth: string; profile: string; mode: string;
  profileReadError?: string;
  layers: ExternalLayer[]; channels: Array<{ name: string; kind: string }>; render: { width: number; height: number; profile: string; resampling: string };
};

// Executed only by the explicit local qualification command. Never saves an
// input, never closes a pre-existing document, and restores global preferences.
// Kept ES3-compatible for Photoshop's installed ExtendScript runtime.
const script = String.raw`
(function (args) {
  function json(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "string") return '"' + v.replace(/[\\"\u0000-\u001f]/g, function(c) {
      if(c === '"') return '\\"'; if(c === '\\') return '\\\\';
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"';
    if(typeof v === "number" || typeof v === "boolean") return String(v);
    var out = [], k;
    if(v instanceof Array) { for(k=0;k<v.length;k++)out.push(json(v[k]));return '['+out.join(',')+']'; }
    for(k in v)if(v.hasOwnProperty(k))out.push(json(k)+':'+json(v[k]));
    return '{'+out.join(',')+'}';
  }
  var input = new File(args[0]), output = new File(args[1]);
  var w = Number(args[2]), h = Number(args[3]), editPath = args[4], opacity = Number(args[5]);
  if(!input.exists || output.exists || !(w>0 && h>0 && w*h<=1048576)) throw Error('Unsafe reference request');
  for(var i=0;i<app.documents.length;i++) {
    try { if(app.documents[i].fullName.fsName === input.fsName) throw Error('LUMA_INPUT_ALREADY_OPEN'); }
    catch(e) { if(String(e).indexOf('LUMA_INPUT_ALREADY_OPEN')>=0) throw e; }
  }
  var previousDialogs = app.displayDialogs, previousUnits = app.preferences.rulerUnits;
  var previous = app.documents.length ? app.activeDocument : null, doc = null, copy = null, stage = 'open';
  try {
    app.displayDialogs = DialogModes.NO; app.preferences.rulerUnits = Units.PIXELS;
    doc = app.open(input);
    stage = 'apply-edit';
    if(editPath) {
      var indexes=editPath.split('/'), target=doc;
      for(i=0;i<indexes.length;i++) target=target.layers[Number(indexes[i])];
      target.opacity=opacity;
    }
    stage = 'document-metadata';
    var profile = 'unavailable', profileReadError = null;
    try { profile = doc.colorProfileName; } catch (profileFailure) { profileReadError = String(profileFailure); }
    var result={application:'Adobe Photoshop',version:app.version,width:doc.width.as('px'),height:doc.height.as('px'),
      resolution:doc.resolution,depth:String(doc.bitsPerChannel),profile:profile,mode:String(doc.mode),layers:[],channels:[]};
    if(profileReadError)result.profileReadError=profileReadError;
    for(i=0;i<doc.channels.length;i++)result.channels.push({name:doc.channels[i].name,kind:String(doc.channels[i].kind)});
    function collect(container, path) {
      for(var j=0;j<container.layers.length;j++) {
        var layer=container.layers[j], address=path.concat([j]);
        var ref=new ActionReference();ref.putIdentifier(charIDToTypeID('Lyr '),layer.id);
        var desc=executeActionGet(ref), maskKey=stringIDToTypeID('hasUserMask'), vectorKey=stringIDToTypeID('hasVectorMask');
        var item={path:address,name:layer.name,type:layer.typename,kind:layer.typename==='LayerSet'?'group':String(layer.kind),
          visible:layer.visible,opacity:layer.opacity,blend:String(layer.blendMode),clipping:layer.typename==='ArtLayer'?layer.grouped:false,
          mask:desc.hasKey(maskKey)&&desc.getBoolean(maskKey),vectorMask:desc.hasKey(vectorKey)&&desc.getBoolean(vectorKey)};
        if(layer.typename==='ArtLayer' && layer.kind===LayerKind.TEXT){item.text=layer.textItem.contents;item.font=layer.textItem.font;}
        result.layers.push(item); if(layer.typename==='LayerSet')collect(layer,address);
      }
    }
    stage = 'layer-metadata'; collect(doc,[]);
    stage = 'duplicate';
    copy=doc.duplicate('Luma independent reference',false);
    stage = 'color-conversion';
    copy.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
    // Merge at source resolution before downsampling. Resizing the editable
    // stack first can change effects and text layout independently.
    stage = 'merge'; if(copy.layers.length>1)copy.mergeVisibleLayers();
    copy.bitsPerChannel=BitsPerChannelType.EIGHT;
    stage = 'resize'; copy.resizeImage(UnitValue(w,'px'),UnitValue(h,'px'),undefined,ResampleMethod.BICUBIC);
    stage = 'save-reference';
    var png=new PNGSaveOptions();copy.saveAs(output,png,true,Extension.LOWERCASE);
    result.render={width:w,height:h,profile:'sRGB IEC61966-2.1',resampling:'Photoshop bicubic after merge'};
    return json(result);
  } catch (failure) {
    throw Error('LUMA_PHOTOSHOP_STAGE=' + stage + ': ' + String(failure));
  } finally {
    if(copy)copy.close(SaveOptions.DONOTSAVECHANGES);
    if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);
    app.displayDialogs=previousDialogs;app.preferences.rulerUnits=previousUnits;
    if(previous)try{app.activeDocument=previous;}catch(ignore){}
  }
})(arguments);
`;

export async function photoshopReference(input: string, output: string, width: number, height: number, edit?: { path: number[]; opacity: number }): Promise<ExternalDocument> {
  if (process.platform !== "darwin") throw new Error("Independent Photoshop automation currently requires macOS");
  if (edit && (edit.path.some(n => !Number.isSafeInteger(n) || n < 0) || !edit.path.length || !Number.isFinite(edit.opacity) || edit.opacity < 0 || edit.opacity > 100)) throw new Error("Invalid reference edit");
  const appleScript = 'on run argv\ntell application "Adobe Photoshop 2026"\nwith timeout of 120 seconds\nreturn do javascript (item 1 of argv) with arguments {item 2 of argv, item 3 of argv, item 4 of argv, item 5 of argv, item 6 of argv, item 7 of argv}\nend timeout\nend tell\nend run';
  const { stdout } = await promisify(execFile)("osascript", ["-e", appleScript, script, input, output, String(width), String(height), edit?.path.join("/") ?? "", String(edit?.opacity ?? 100)], { timeout: 125000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim()) as ExternalDocument;
  if (result.application !== "Adobe Photoshop" || !Array.isArray(result.layers) || result.render.width !== width || result.render.height !== height) throw new Error("Invalid independent Photoshop receipt");
  return result;
}
