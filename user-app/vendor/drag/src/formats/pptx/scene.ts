import {appearanceEffects,appearanceBounds,renderAppearance} from "./appearance-renderer";
import {layoutSmartArt} from "./smart-art-layout";
import {PptxReadBudget} from "./read-budget";
import {rasterizeImage,validSourceCrop,type ImageFallbackPlan} from "./image-fallback";
import {graphicPath} from "./graphic-path";
import {presetPath} from "./preset-geometry";
import {arrowheads,pathArrowheads} from "./arrowheads";
import {PATTERNS,type PatternIR} from "../../core/pattern";
import { lineStyle } from "./line-style";
import type { LinearGradientIR, BaseElementIR, ElementIR, GroupElementIR, PageIR, SolidPaintIR, ShapeElementIR } from "../../core/model";
import { parsePageIR } from "../../core/page-ir";
import { SECURITY_LIMITS } from "../../core/limits";
import {normalizePptxImage} from "./normalize-image";
import { PptxCatalogReader, type PptxSlideDescriptor, PRESENTATION as P, DRAWING as A, OFFICE_REL } from "./catalog";
import { appearance, child, kids, path, number, enabled, shapeTree, placeholder, properties, shapeLayers, fill, hasFill, color, referenceStyle } from "./appearance";
import { slideText } from "./text";
import { readTable } from "./table";
import { readChart } from "./chart";
import { ancillary } from "./ancillary";
import { readEffects } from "./effects";
import { readGradient } from "./gradient";
import { customGeometry, UnsupportedGeometry } from "./custom-geometry";
import { alternateChildren } from "./alternate-content";
import { smartArtText, smartArtDrawing, DIAGRAM } from "./smart-art";
import { C } from "./chart-data";

const messages: Record<string, string> = {
  "pptx-image-downsampled": "An oversized image was reduced locally to fit the 4-million-pixel image budget.",
  "pptx-paint": "A fill, outline or color effect could not be reproduced completely.",
  "pptx-appearance-rasterized": "Office appearance was reconstructed as a local bitmap. 3D materials, soft edges and reflections are approximate; text inside this object is no longer separately editable.",
  "pptx-effect": "An unsupported visual effect was omitted; its object remains editable where supported.",
  "pptx-geometry": "An unsupported shape or transform could not be reproduced completely.",
  "pptx-text-layout": "Text spacing, bullets, autofit or orientation is approximate. Check this text block in Figma.",
  "pptx-text-style": "Some text formatting or dynamic fields are simplified; visible text was retained.",
  "pptx-image": "An unsupported image or image effect was omitted or simplified.",
  "pptx-table": "A table without usable geometry or content was omitted.",
  "pptx-chart": "A chart without a usable reference or geometry was omitted.",
  "pptx-table-style": "Some table styling could not be reproduced. Cell text remains editable.",
  "pptx-table-layout": "The table uses its row and column dimensions because its outer frame has different bounds.",
  "pptx-chart-layout": "Chart layout is reconstructed from editable shapes and text. Check spacing and labels.",
  "pptx-chart-cache": "Chart values come from the saved cache. The embedded workbook was not opened.",
  "pptx-chart-data": "Some chart values are missing or invalid in the saved cache.",
  "pptx-chart-style": "Some chart styling or supplementary elements were simplified.",
  "pptx-chart-format": "Some chart number or date formats were simplified.",
  "pptx-chart-unsupported": "This chart style is unsupported. Available values were imported as editable text.",
  "pptx-object": "An unsupported slide object was omitted.",
  "pptx-animation": "Animations and transitions were omitted.",
  "pptx-notes": "Speaker notes were placed in the service block beside this slide.",
  "pptx-media": "Media playback is not imported. Available image posters and safe links were retained.",
  "pptx-media-poster": "This media object has no supported image poster; an editable placeholder was used.",
  "pptx-link": "An unsupported or unsafe hyperlink/action was omitted.",
  "pptx-link-internal": "Internal links were retained as source-slide references in the service block.",
  "pptx-comments": "Classic comments were placed in the service block beside this slide.",
  "pptx-comments-unsupported": "Modern threaded comments are not supported in this build.",
  "pptx-alternate-content": "The source file’s fallback representation was imported; some objects may no longer be separately editable.",
  "pptx-smartart": "SmartArt layout is unsupported. Available labels were retained in the service block.",
  "pptx-smartart-generated": "SmartArt layout was reconstructed from its source data and supported layout instructions. Geometry, spacing, styles and text fitting are approximate; check the source slide.",
  "pptx-smartart-cached": "SmartArt uses the saved source layout. Supported shapes and text remain editable; diagram rules are not imported.",
  "pptx-image-rasterized": "An image mask or color effect was preserved as a local bitmap. Its pixels are no longer separately editable.",
  "pptx-placeholder": "A graphic has no supported source representation. A placeholder marks its original position; check the source slide.",
  "pptx-theme": "A theme override is not supported in this build; inherited theme values were used.",
};

export async function readSlide(reader: PptxCatalogReader, descriptor: PptxSlideDescriptor, signal?: AbortSignal): Promise<PageIR> {
  const budget=new PptxReadBudget(signal);
  const check = () => budget.check();
  let visited=0;
  check();
  const context = appearance(reader, descriptor.part);
  const page: PageIR = { schemaVersion: 1, id: descriptor.id, sourceIndex: descriptor.sourceIndex, width: descriptor.width, height: descriptor.height, elements: [], assets: [], degradations: [] };
  const emitted = new Set<string>();
  const warn = (code: string) => { if (!emitted.has(code)) { emitted.add(code); page.degradations.push({ code, message: messages[code] ?? "An unsupported PPTX feature was omitted." }); } };
  const extras = ancillary(reader, descriptor.part, warn);
  let sequence = 0, assetBytes = 0, rasterRegions=0;
  const assets = new Map<string, string>();
  const base = (name: string, width: number, height: number): BaseElementIR => {
    if (++sequence >= SECURITY_LIMITS.maxNodesPerPage) throw new Error("security-limit");
    return { id: `object-${sequence}`, name, zIndex: sequence, bounds: { x: 0, y: 0, width, height }, rotation: 0, opacity: 1, visible: true };
  };
  const paintWarn = () => warn("pptx-paint");
  let background: Element | undefined;
  for (const root of [context.master, context.layout, context.slide]) { const bg = child(child(root, "cSld", P), "bg", P); if (bg) background = bg; }
  let backgroundPaint: SolidPaintIR | undefined, backgroundGradient: LinearGradientIR | undefined;
  if (background) {
    const props = child(background, "bgPr", P), ref = child(background, "bgRef", P);
    if (props) { if(child(props,"gradFill"))backgroundGradient=readGradient(child(props,"gradFill"),context,page.width,page.height,paintWarn);else backgroundPaint = fill(props, context, paintWarn); if (kids(props).some(e => e.localName === "effectLst" && e.children.length)) warn("pptx-effect"); }
    else if (ref) {
      const idx = number(ref, "idx", 0);
      const list = path(context.theme, "themeElements", "fmtScheme", idx >= 1001 ? "bgFillStyleLst" : "fillStyleLst");
      const paint = kids(list)[idx >= 1001 ? idx - 1001 : idx - 1];
      const phColor = color(kids(ref)[0], context, paintWarn);
      if (paint?.localName === "solidFill") backgroundPaint = color(kids(paint)[0], context, paintWarn, phColor); else paintWarn();
    }
  }
  if (backgroundGradient) page.elements.push({ ...base("Slide background", page.width, page.height), kind:"rectangle", gradient: backgroundGradient });
  if (backgroundPaint) page.elements.push({ ...base("Slide background", page.width, page.height), kind: "rectangle", fill: backgroundPaint });
  for (const rootPart of [context.slidePart, context.layoutPart, context.masterPart].filter((s): s is string => Boolean(s))) {
    for (const rel of reader.relationships(rootPart).values()) {
      if (rel.type === `${OFFICE_REL}/themeOverride`) warn("pptx-theme");

    }
  }
  if (child(context.slide, "timing", P) || child(context.slide, "transition", P)) warn("pptx-animation");

  const activeDrawings=new Set<string>();
  const tree = async (root: Element | undefined, part: string, inherited: boolean, sx = 1, sy = 1, ox = 0, oy = 0, depth = 0): Promise<ElementIR[]> => {
    if (depth > SECURITY_LIMITS.maxElementDepth - 3) throw new Error("security-limit");
    const output: ElementIR[] = [];
    for (const shape of alternateChildren(root, warn)) {
      if(++visited%25===0)await new Promise(resolve=>setTimeout(resolve,0));
      check();
      if (shape.namespaceURI !== P) { warn("pptx-object"); continue; }
      check();
      if (["nvGrpSpPr", "grpSpPr", "extLst"].includes(shape.localName)) continue;
      if (inherited && placeholder(shape)) continue;
      const nonvisual = kids(shape, P).find(e => e.localName.startsWith("nv"));
      if (enabled(child(nonvisual, "cNvPr", P), "hidden")) continue;
      if (!["sp", "pic", "cxnSp", "grpSp", "graphicFrame"].includes(shape.localName)) { warn("pptx-object"); continue; }
      extras.inspectLinks(shape, part);
      const mediaKind = extras.media(shape, part);
      const layers = inherited ? [shape] : shapeLayers(shape, context);
      let transform: Element | undefined, offset: Element | undefined, extent: Element | undefined;
      let angle = 0, flipH = false, flipV = false;
      for (const layer of layers) {
        const next = shape.localName === "graphicFrame" ? child(layer, "xfrm", P) : child(shape.localName === "grpSp" ? child(layer, "grpSpPr", P) : properties(layer), "xfrm");
        if (next) {
          transform = next; offset = child(next, "off") ?? offset; extent = child(next, "ext") ?? extent;
          angle = number(next, "rot", angle * 60000) / 60000;
          flipH = enabled(next, "flipH", flipH); flipV = enabled(next, "flipV", flipV);
        }
      }
      if (!offset || !extent) {
        const uri = path(child(shape, "graphic"), "graphicData")?.getAttribute("uri") ?? "";
        warn(uri.endsWith("/table") ? "pptx-table" : uri.endsWith("/chart") ? "pptx-chart" : "pptx-geometry"); continue;
      }
      const x = (number(offset, "x", 0) / 9525 - ox) * sx, y = (number(offset, "y", 0) / 9525 - oy) * sy;
      const w = number(extent, "cx", 0) / 9525 * sx, h = number(extent, "cy", 0) / 9525 * sy;
      if (w < 0 || h < 0 || [x,y,w,h].some(n => !Number.isFinite(n) || Math.abs(n) > 1000000)) throw new Error("security-limit");
      if (angle && Math.abs(sx - sy) > 0.00001) warn("pptx-geometry");
      const wrapper: GroupElementIR = { ...base(shape.localName === "pic" ? "Image" : shape.localName === "grpSp" ? "Group" : "Shape", Math.max(w, 0.01), Math.max(h, 0.01)), kind: "group", children: [], centeredTransform: { flipH, flipV } };
      const nonVisual=kids(shape,P).find(e=>e.localName.startsWith('nv'));
      const sourceInfo=child(nonVisual,'cNvPr',P),sourceName=sourceInfo?.getAttribute('name');
      if(sourceName)wrapper.name=sourceName.slice(0,512);
      const shapeId=sourceInfo?.getAttribute('id');
      if(shapeId)wrapper.sourceRef={part,shapeId};
      wrapper.bounds.x = x; wrapper.bounds.y = y; wrapper.rotation = angle;
      for (const layer of layers) {
        const props = shape.localName === "grpSp" ? child(layer, "grpSpPr", P) : properties(layer);
        if (child(props, "effectLst")) { const effects = readEffects(props, context, sx, sy, warn); if (effects) wrapper.effects = effects; else delete wrapper.effects; }
      }
      if (mediaKind) wrapper.name = `${mediaKind} poster`;
      const mediaPlaceholder = () => {
        warn("pptx-media-poster");
        wrapper.children.push({ ...base(`${mediaKind} placeholder`, w, h), kind: "rectangle", fill: { type: "solid", color: { r: .94, g: .95, b: .97, a: 1 } } });
        wrapper.children.push({ ...base(`${mediaKind} label`, w, h), kind: "text", text: `${mediaKind} — poster unavailable`, fontFamily: "Arial", fontSize: Math.max(1, Math.min(18, h/3)), textBox: { align: "CENTER", vertical: "CENTER", wrap: true } });
        output.push(wrapper);
      };
      const placeholderGraphic=(label:string)=>{
        warn("pptx-placeholder");wrapper.name="Unavailable graphic";
        wrapper.children.push({...base("Graphic placeholder",w,h),kind:"rectangle",fill:{type:"solid",color:{r:.96,g:.96,b:.96,a:1}},stroke:{width:1,paint:{type:"solid",color:{r:.6,g:.3,b:.2,a:1}},dash:[6,4]}});
        wrapper.children.push({...base("Graphic status",w,h),kind:"text",text:label,fontFamily:"Arial",fontSize:Math.max(1,Math.min(16,h/4,w/15)),textBox:{align:"CENTER",vertical:"CENTER",wrap:true}});
      };
      if (shape.localName === "graphicFrame") {
        const data = path(child(shape, "graphic"), "graphicData"), uri = data?.getAttribute("uri");
        const graphic = { reader, appearance: context, base, warn, check, width: w, height: h, scaleX: sx, scaleY: sy };
        if (w <= 0 || h <= 0) { warn("pptx-geometry"); continue; }
        if (uri === `http://schemas.openxmlformats.org/drawingml/2006/table` && child(data, "tbl")) {
          wrapper.name = "Table container"; wrapper.children.push(await readTable(child(data, "tbl")!, graphic));
          wrapper.bounds.width=wrapper.children[0]!.bounds.width;wrapper.bounds.height=wrapper.children[0]!.bounds.height;
          const table=wrapper.children[0] as GroupElementIR;
          if(table.tableGrid){wrapper.tableGrid={...table.tableGrid,containers:[table.id,...table.tableGrid.containers]};delete table.tableGrid;}
        } else if (uri === C) {
          const id = child(data, "chart", C)?.getAttributeNS(OFFICE_REL, "id");
          const rel = id ? reader.relationships(part).get(id) : undefined;
          if (!rel || rel.type !== `${OFFICE_REL}/chart`) { warn("pptx-chart"); continue; }
          wrapper.name = "Chart container"; wrapper.children.push(await readChart(reader.xml(rel.target, C, "chartSpace"), graphic));
        } else if(uri===DIAGRAM) {
          const cached=smartArtDrawing(reader,data,part);
          if(cached){
            if(activeDrawings.has(cached.part))throw new Error("invalid-file");
            const xf=child(child(cached.tree,"grpSpPr",P),"xfrm"),ce=child(xf,"chExt"),co=child(xf,"chOff");
            const cw=number(ce,"cx",w/sx*9525)/9525,ch=number(ce,"cy",h/sy*9525)/9525;
            if(cw<=0||ch<=0)throw new Error("invalid-file");
            activeDrawings.add(cached.part);
            try{wrapper.children=await tree(cached.tree,cached.part,true,w/cw,h/ch,number(co,"x",0)/9525,number(co,"y",0)/9525,depth+1);}finally{activeDrawings.delete(cached.part);}
            if(wrapper.children.length){const sourceText=smartArtText(reader,data,part);if(sourceText)extras.add({title:"SmartArt source text",text:sourceText});wrapper.name="SmartArt — saved layout";warn("pptx-smartart-cached");output.push(wrapper);continue;}
          }
          const generated=layoutSmartArt(reader,data,part,w,h,base,{appearance:context,warn});
          if(generated){wrapper.name="SmartArt — reconstructed layout";wrapper.children=generated;warn("pptx-smartart-generated");const sourceText=smartArtText(reader,data,part);if(sourceText)extras.add({title:"SmartArt source text",text:sourceText});output.push(wrapper);continue;}
          const text=smartArtText(reader,data,part);
          if(text)extras.add({title:"SmartArt text — layout unavailable",text});
          warn("pptx-smartart");placeholderGraphic("SmartArt layout unavailable");output.push(wrapper);continue;
        } else { warn(uri === `http://schemas.openxmlformats.org/drawingml/2006/table` ? "pptx-table" : "pptx-object"); placeholderGraphic("Graphic unavailable"); output.push(wrapper); continue; }
        output.push(wrapper); continue;
      }
      if (shape.localName === "grpSp") {
        readEffects(child(shape, "grpSpPr", P), context, sx, sy, warn);
        const childExt = child(transform, "chExt"), childOff = child(transform, "chOff");
        const cw = number(childExt, "cx", 0) / 9525, ch = number(childExt, "cy", 0) / 9525;
        if (cw <= 0 || ch <= 0) throw new Error("invalid-file");
        wrapper.children = await tree(shape, part, inherited, w / cw, h / ch, number(childOff, "x", 0) / 9525, number(childOff, "y", 0) / 9525, depth + 1);
        if (wrapper.children.length) output.push(wrapper);
        continue;
      }
      for (const layer of layers) {
        const sp = properties(layer);
        readEffects(sp, context, sx, sy, warn);
      }
      if (shape.localName === "pic") {
        const blipFill = child(shape, "blipFill", P), blip = child(blipFill, "blip");
        const id = blip?.getAttributeNS(OFFICE_REL, "embed");
        const rel = id ? reader.relationships(part).get(id) : undefined;
        if (!rel || rel.external || rel.type !== `${OFFICE_REL}/image`) { if (mediaKind) mediaPlaceholder(); else warn("pptx-image"); continue; }
        const effects=kids(blip),gray=effects.some(e=>e.localName==="grayscl"),bi=child(blip,"biLevel"),alpha=child(blip,"alphaModFix");
        if(effects.some(e=>!["grayscl","biLevel","alphaModFix"].includes(e.localName)))warn("pptx-image");
        const geom = child(properties(shape), "prstGeom");
        const custom=child(properties(shape),"custGeom"),preset=geom?.getAttribute("prst")??"rect";
        let mask:string|undefined;
        if(preset!=="rect"&&preset!=="ellipse")mask=presetPath(preset,w,h,geom,()=>warn("pptx-geometry"));
        if(custom){try{mask=customGeometry(custom,w,h,sx,sy).filter(p=>p.filled).map(p=>{
          // Custom geometry returns normalized paths. Restore each subpath offset for a common mask.
          return p.pathData.replace(/([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/gi,(()=>{let i=0;return (n:string)=>String(Number(n)+(i++%2?p.bounds.y:p.bounds.x));})());
        }).join(" ");}catch(error){if(error instanceof UnsupportedGeometry)warn("pptx-geometry");else throw error;}}
        if(child(blipFill,"tile")||preset!=="rect"&&preset!=="ellipse"&&!mask||custom&&!mask){warn("pptx-image");placeholderGraphic("Image appearance unavailable");output.push(wrapper);continue;}
        const outline=()=>{
          const ln=child(properties(shape),'ln'),paint=fill(ln,context,paintWarn),weight=number(ln,'w',9525)/9525*sy;
          if(!paint||weight<=0)return;
          const node={...wrapper,id:wrapper.id+'-outline',name:'Picture outline',bounds:{x:0,y:0,width:w,height:h},rotation:0,centeredTransform:undefined,children:undefined,sourceRef:undefined,stroke:{paint,width:weight,...lineStyle(ln,weight,paintWarn)}};
          wrapper.children.push(mask?{...node,kind:'path',pathData:mask,windingRule:'NONZERO'}:{...node,kind:preset==='ellipse'?'ellipse':'rectangle'});
        };
        let assetId = assets.get(rel.target);
        let sourceBytes = assetId ? page.assets!.find(a => a.id === assetId)!.bytes : undefined;
        if (!sourceBytes) {
          let bytes = reader.readAsset(rel.target);
          try { const normalized=await normalizePptxImage(bytes,signal);bytes=normalized.bytes;if(normalized.resized)warn("pptx-image-downsampled");check(); } catch (error) { if (error instanceof Error && error.message === "unsupported-image") { warn("pptx-image"); if (mediaKind) mediaPlaceholder(); else {placeholderGraphic("Image unavailable");output.push(wrapper);} continue; } throw error; }
          // A masked crop only retains its rendered region. Keeping its large
          // intermediate source in PageIR exhausted the per-page byte budget
          // on collages even when all visible regions together were small.
          if (bytes.length > SECURITY_LIMITS.maxPageAssetBytes) throw new Error("page-image-byte-limit");
          sourceBytes = bytes;
        }
        const crop = child(blipFill, "srcRect"), l = number(crop, "l", 0) / 100000, r = number(crop, "r", 0) / 100000, t = number(crop, "t", 0) / 100000, b = number(crop, "b", 0) / 100000;
        const fr=child(child(blipFill,'stretch'),'fillRect'),target={l:number(fr,'l',0)/100000,r:number(fr,'r',0)/100000,t:number(fr,'t',0)/100000,b:number(fr,'b',0)/100000};
        if(!validSourceCrop(target)){warn('pptx-image');continue;}
        if (!validSourceCrop({l,r,t,b})) { warn("pptx-image"); continue; }
        const alphaAmount=alpha?number(alpha,"amt",100000)/100000:1;
        if(alphaAmount<0||alphaAmount>1)throw new Error("invalid-image-effect");
        if(mask||preset==="ellipse"||gray||bi||alphaAmount!==1){
          if(++rasterRegions>64)throw new Error("security-limit");
          const plan:ImageFallbackPlan={width:w,height:h,crop:{l,r,t,b},fillRect:target,...(mask?{mask}:{}),...(preset==="ellipse"?{ellipse:true}:{}),...(gray?{grayscale:true}:{}),...(bi?{threshold:number(bi,"thresh",50000)/100000}:{}),...(alphaAmount!==1?{alpha:alphaAmount}:{})};
          budget.reserveRaster(plan);
          const bytes=await rasterizeImage(sourceBytes,plan,signal);check();assetBytes+=bytes.length;if(assetBytes>SECURITY_LIMITS.maxPageAssetBytes)throw new Error("page-image-byte-limit");
          const regionId=`region-${rasterRegions}`;page.assets!.push({id:regionId,bytes});
          wrapper.children.push({...base("Flattened image appearance",w,h),kind:"raster",assetId:regionId,reason:"pptx-image-rasterized",stretch:true});outline();page.degradations.push({code:"pptx-image-rasterized",message:messages["pptx-image-rasterized"]!,elementId:wrapper.id});output.push(wrapper);continue;
        }
        if (!assetId) {
          assetBytes += sourceBytes.length;
          if (assetBytes > SECURITY_LIMITS.maxPageAssetBytes) throw new Error("page-image-byte-limit");
          assetId = `image-${assets.size + 1}`; assets.set(rel.target, assetId); page.assets!.push({ id: assetId, bytes: sourceBytes });
        }
        const iw = w*(1-target.l-target.r) / (1 - l - r), ih = h*(1-target.t-target.b) / (1 - t - b);
        wrapper.clipsContent = true;
        wrapper.children.push({ ...base("Source image", iw, ih), bounds: { x: target.l*w-l * iw, y: target.t*h-t*ih, width: iw, height: ih }, kind: "raster", assetId, reason: "source-image", stretch: true });outline();
      } else {
        let gradient: LinearGradientIR | undefined,pattern:PatternIR|undefined,imageFill:Element|undefined;
        let geometry: Element | undefined, fillPaint: SolidPaintIR | undefined, line: Element | undefined, linePaint: SolidPaintIR | undefined, lineWidth = 9525;
        for (const layer of layers) {
          const props = properties(layer), next = child(props, "prstGeom") ?? child(props, "custGeom"); if (next) geometry = next;
          const fillRef = referenceStyle(layer, "fill", context, paintWarn);
          if (fillRef.element?.localName === "solidFill") { gradient = undefined; fillPaint = color(kids(fillRef.element)[0], context, paintWarn, fillRef.phColor); }
          else if (fillRef.element?.localName === "gradFill") { gradient = readGradient(fillRef.element, context, w, h, paintWarn, fillRef.phColor); fillPaint = undefined; }
          else if (fillRef.element) paintWarn();
          if (hasFill(props)) {
            pattern=undefined;
            imageFill=child(props,"blipFill");
            const patterned=child(props,"pattFill");
            if(patterned){const preset=patterned.getAttribute("prst"),fg=color(kids(child(patterned,"fgClr"))[0],context,paintWarn),bg=color(kids(child(patterned,"bgClr"))[0],context,paintWarn);if(PATTERNS.includes(preset as typeof PATTERNS[number])&&fg&&bg)pattern={preset:preset as typeof PATTERNS[number],foreground:fg.color,background:bg.color};paintWarn();}
            if(child(props,"gradFill")){gradient=readGradient(child(props,"gradFill"),context,w,h,paintWarn);fillPaint=undefined;}
            else {gradient=undefined;fillPaint=fill(props,context,paintWarn);}
          }
          const lnRef = referenceStyle(layer, "ln", context, paintWarn);
          for (const currentLine of [lnRef.element, child(props, "ln")]) {
            if (!currentLine) continue;
            line = currentLine; lineWidth = number(currentLine, "w", lineWidth);
            if (hasFill(currentLine)) linePaint = fill(currentLine, context, paintWarn, lnRef.phColor);
          }
          if (number(child(child(layer, "style", P), "effectRef"), "idx", 0) > 0) warn("pptx-effect");
        }
        const sourcePreset = geometry?.getAttribute("prst") ?? (shape.localName === "cxnSp" ? "line" : "rect");
        const preset = sourcePreset === "straightConnector1" ? "line" : sourcePreset;
        const shapeBase = base("Editable shape", w, h);
        let primitive: ShapeElementIR | undefined;
        const primitives: ShapeElementIR[] = [], flags = new Map<string,{filled:boolean;stroked:boolean}>();
        if (geometry?.localName === "custGeom") {
          try {
            for(const item of customGeometry(geometry,w,h,sx,sy)) {
              const node:ShapeElementIR={...base("Custom path",item.bounds.width,item.bounds.height),kind:"path",bounds:item.bounds,pathData:item.pathData,windingRule:"NONZERO"};
              primitives.push(node);flags.set(node.id,item);
            }
            if(child(geometry,"rect"))warn("pptx-geometry");
          } catch(error) { if(error instanceof UnsupportedGeometry)warn("pptx-geometry");else throw error; }
        }
        else if (preset === "rect" || preset === "ellipse") primitive = { ...shapeBase, kind: preset === "rect" ? "rectangle" : "ellipse" };
        else if (preset === "line") primitive = { ...shapeBase, kind: "path", pathData: `M 0 0 L ${w} ${h}`, windingRule: "NONZERO" };
        else if (preset === "triangle") primitive = { ...shapeBase, kind: "path", pathData: `M ${w/2} 0 L ${w} ${h} L 0 ${h} Z`, windingRule: "NONZERO" };
        else if (preset === "roundRect") {
          const guide = path(geometry, "avLst", "gd")?.getAttribute("fmla");
          let adj = 16667;
          if (guide) { if (/^val \d+$/.test(guide)) adj = Number(guide.slice(4)); else warn("pptx-geometry"); }
          const radius = Math.min(w, h) * Math.max(0, Math.min(50000, adj)) / 100000;
          // Cubic circular quadrants (max radial error < 0.028%); stay inside the IR's M/L/C/Q/Z contract.
          const k = radius * 0.5522847498307936;
          primitive = { ...shapeBase, kind: "path", windingRule: "NONZERO", pathData: `M ${radius} 0 L ${w-radius} 0 C ${w-radius+k} 0 ${w} ${radius-k} ${w} ${radius} L ${w} ${h-radius} C ${w} ${h-radius+k} ${w-radius+k} ${h} ${w-radius} ${h} L ${radius} ${h} C ${radius-k} ${h} 0 ${h-radius+k} 0 ${h-radius} L 0 ${radius} C 0 ${radius-k} ${radius-k} 0 ${radius} 0 Z` };
        } else {const data=presetPath(preset,w,h,geometry,()=>warn("pptx-geometry"));if(data)primitive={...shapeBase,...graphicPath(data),kind:"path",windingRule:"NONZERO"};else warn("pptx-geometry");}
        if(primitive)primitives.push(primitive);
        if(!primitives.length)placeholderGraphic("Shape unavailable");
        if(imageFill){
          const blip=child(imageFill,"blip"),rel=reader.relationships(part).get(blip?.getAttributeNS(OFFICE_REL,"embed")??"");
          const fraction=(node:Element|undefined)=>({l:number(node,"l",0)/100000,r:number(node,"r",0)/100000,t:number(node,"t",0)/100000,b:number(node,"b",0)/100000});
          const crop=fraction(child(imageFill,"srcRect")),target=fraction(child(child(imageFill,"stretch"),"fillRect"));
          if(!rel||rel.external||rel.type!==`${OFFICE_REL}/image`||child(imageFill,"tile")||!validSourceCrop(crop)||!validSourceCrop(target))warn("pptx-image");
          else{
            let assetId=assets.get(rel.target),bytes=assetId?page.assets!.find(a=>a.id===assetId)!.bytes:undefined;
            if(!bytes){const normalized=await normalizePptxImage(reader.readAsset(rel.target),signal);bytes=normalized.bytes;if(normalized.resized)warn("pptx-image-downsampled");check();}
            const alpha=number(child(blip,"alphaModFix"),"amt",100000)/100000,gray=!!child(blip,"grayscl"),bi=child(blip,"biLevel");
            if(kids(blip).some(e=>!["alphaModFix","grayscl","biLevel"].includes(e.localName)))warn("pptx-image");
            const mask=primitive?.kind==='path'?primitive.pathData:undefined;
            if(preset!=="rect"&&preset!=="ellipse"&&!mask)warn("pptx-image");
            else if(mask||preset==="ellipse"||gray||bi||alpha!==1){
              if(++rasterRegions>64)throw new Error("security-limit");
              const plan:ImageFallbackPlan={width:w,height:h,crop,fillRect:target,mask,ellipse:preset==="ellipse",grayscale:gray,...(bi?{threshold:number(bi,"thresh",50000)/100000}:{}),alpha};
              budget.reserveRaster(plan);bytes=await rasterizeImage(bytes,plan,signal);check();assetBytes+=bytes.length;if(assetBytes>SECURITY_LIMITS.maxPageAssetBytes)throw new Error("page-image-byte-limit");
              const id=`region-${rasterRegions}`;page.assets!.push({id,bytes});wrapper.children.push({...shapeBase,id:shapeBase.id+'-fill',name:"Shape image fill",kind:"raster",assetId:id,reason:"pptx-image-rasterized",stretch:true});
            }else{
              if(!assetId){assetBytes+=bytes.length;if(assetBytes>SECURITY_LIMITS.maxPageAssetBytes)throw new Error("page-image-byte-limit");assetId=`image-${assets.size+1}`;assets.set(rel.target,assetId);page.assets!.push({id:assetId,bytes});}
              const iw=w*(1-target.l-target.r)/(1-crop.l-crop.r),ih=h*(1-target.t-target.b)/(1-crop.t-crop.b),ix=w*target.l-crop.l*iw,iy=h*target.t-crop.t*ih;
              wrapper.children.push({...shapeBase,id:shapeBase.id+'-fill',name:"Shape image fill",kind:"raster",assetId,reason:"source-image",stretch:true,bounds:{x:ix,y:iy,width:iw,height:ih},clipBounds:{x:-ix,y:-iy,width:w,height:h}});
            }
          }
          fillPaint=undefined;gradient=undefined;pattern=undefined;
        }
        for (const primitive of primitives) {
          const canFill=preset!=="line" && !preset.includes("Connector") && flags.get(primitive.id)?.filled!==false;
          if(pattern&&canFill)primitive.pattern=pattern;
          if (fillPaint && canFill&&!pattern) primitive.fill = fillPaint;
          if (gradient && !pattern && canFill && primitive.bounds.width>0 && primitive.bounds.height>0) {
            const b=primitive.bounds;
            primitive.gradient={...gradient,start:{x:(gradient.start.x*w-b.x)/b.width,y:(gradient.start.y*h-b.y)/b.height},end:{x:(gradient.end.x*w-b.x)/b.width,y:(gradient.end.y*h-b.y)/b.height}};
          }
          if (linePaint && flags.get(primitive.id)?.stroked!==false) {
            const weight = lineWidth / 9525 * sy;
            if (weight > 0) primitive.stroke = { width: weight, paint: linePaint, ...lineStyle(line, weight, () => warn("pptx-paint")) };
          }
          if (primitive.fill || primitive.gradient || primitive.pattern || primitive.stroke) wrapper.children.push(primitive);
        }
        if(preset==="line"&&linePaint&&lineWidth>0)for(const head of arrowheads(line,w,h,lineWidth/9525*sy,paintWarn)){wrapper.children.push({...base("Arrowhead",head.bounds.width,head.bounds.height),bounds:head.bounds,kind:"path",pathData:head.pathData,windingRule:"NONZERO",...(head.open?{stroke:{width:lineWidth/9525*sy,paint:linePaint}}:{fill:linePaint})});}
        if(preset!=="line"&&primitive?.kind==='path'&&linePaint&&lineWidth>0)for(const head of pathArrowheads(line,primitive.pathData!,lineWidth/9525*sy,paintWarn)){wrapper.children.push({...shapeBase,id:shapeBase.id+`-arrow-${head.end?'end':'start'}`,name:'Arrowhead',bounds:head.bounds,kind:'path',pathData:head.pathData,windingRule:'NONZERO',...(head.open?{stroke:{width:lineWidth/9525*sy,paint:linePaint}}:{fill:linePaint})});}
        const blur=child(child(properties(shape),"effectLst"),"blur");if(blur){const radius=number(blur,"rad",0)/9525*sy;if(radius<0||radius>1000)throw new Error("security-limit");wrapper.blur=radius;}
        const text = slideText(layers, context, w, h, warn, node => extras.resolve(node, part));
        if (text) {
          // DrawingML mirrors the shape geometry, not its text glyphs. Reflect
          // the inset box too, so unequal margins stay in their original place.
          if(flipH||flipV){const b=text.bounds!;text.bounds={...b,x:flipH?w-b.x-b.width:b.x,y:flipV?h-b.y-b.height:b.y};text.centeredTransform={flipH,flipV};if(flipH!==flipV&&text.rotation)text.rotation=-text.rotation;}
          wrapper.children.push({ ...base(sourceName||"Editable text", w, h), ...text });
        }
      }
      const appearanceConfig=shape.localName==="sp"?appearanceEffects(properties(shape),sy,()=>warn("pptx-effect"),wrapper):undefined;
      if(appearanceConfig&&wrapper.children.length){
        const bounds=appearanceBounds(w,h,appearanceConfig);budget.reserveRaster({width:bounds.width,height:bounds.height,crop:{l:0,r:0,t:0,b:0}});
        const rendered=await renderAppearance(wrapper,page.assets,appearanceConfig,signal);check();assetBytes+=rendered.bytes.length;if(assetBytes>SECURITY_LIMITS.maxPageAssetBytes)throw new Error("page-image-byte-limit");
        const assetId=`appearance-${wrapper.id}`;page.assets!.push({id:assetId,bytes:rendered.bytes});
        wrapper.children=[{...base("Flattened Office appearance",bounds.width,bounds.height),bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},kind:"raster",assetId,reason:"pptx-appearance-rasterized",stretch:true}];
        page.degradations.push({code:"pptx-appearance-rasterized",message:messages["pptx-appearance-rasterized"]!,elementId:wrapper.id});
      }
      if (wrapper.children.length) output.push(wrapper);
      if (sequence % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return output;
  };
  if (enabled(context.slide, "showMasterSp", true)) {
    if (context.master && context.masterPart && enabled(context.layout, "showMasterSp", true)) page.elements.push(...await tree(shapeTree(context.master), context.masterPart, true));
    if (context.layout && context.layoutPart) page.elements.push(...await tree(shapeTree(context.layout), context.layoutPart, true));
  }
  page.elements.push(...await tree(shapeTree(context.slide), context.slidePart, false));
  extras.readNotes();
  if (extras.notes.length) page.serviceNotes = extras.notes;
  check();
  return parsePageIR(page);
}
