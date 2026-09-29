import {PATTERNS,type PatternIR} from "../../core/pattern";
import {resolveTableTheme} from "./table-theme";
import {readGradient} from "./gradient";
import {readEffects} from "./effects";
import {builtinTableStyle} from "./builtin-table-style";
import {lineStyle} from "./line-style";
import type { ElementIR, GroupElementIR, SolidPaintIR, LinearGradientIR } from "../../core/model";
import { DRAWING as A, OFFICE_REL } from "./catalog";
import { child, kids, path, number, enabled, color, fill, hasFill, themeFont } from "./appearance";
import type { GraphicContext } from "./graphic-context";
import { drawingText } from "./graphic-text";
import { graphicPath } from "./graphic-path";

interface Anchor { row:number; col:number; rows:number; cols:number; source:Element }
export async function readTable(table: Element, ctx: GraphicContext): Promise<GroupElementIR> {
  const rows=kids(table).filter(e=>e.localName==="tr"), grid=kids(child(table,"tblGrid")).filter(e=>e.localName==="gridCol");
  if (!rows.length || !grid.length) throw new Error("invalid-file");
  if (rows.length*grid.length>2000) throw new Error("security-limit");
  const widths=grid.map(c=>number(c,"w",0)/9525), heights=rows.map(r=>number(r,"h",0)/9525);
  if ([...widths,...heights].some(n=>n<=0 || !Number.isFinite(n))) throw new Error("invalid-file");
  const sum=(ns:number[])=>ns.reduce((a,b)=>a+b,0);
  const sx=ctx.scaleX,sy=ctx.scaleY;
  const width=sum(widths)*sx,height=sum(heights)*sy;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width>1000000||height>1000000)throw new Error("security-limit");
  if(Math.abs(width-ctx.width)>.01||Math.abs(height-ctx.height)>.01)ctx.warn("pptx-table-layout");
  ctx={...ctx,width,height};
  const xs=[0],ys=[0];for(const w of widths)xs.push(xs[xs.length-1]!+w*sx);for(const h of heights)ys.push(ys[ys.length-1]!+h*sy);
  const occupancy:(Anchor|undefined)[][]=rows.map(()=>Array(grid.length));
  const anchors:Anchor[]=[];let merged=false;
  for(const [r,row] of rows.entries()) {
    const cells=kids(row).filter(c=>c.localName==="tc");
    if(cells.length!==grid.length)throw new Error("invalid-file");
    for(const [c,cell] of cells.entries()) {
      const occupied=occupancy[r]![c], hm=enabled(cell,"hMerge"), vm=enabled(cell,"vMerge");
      if(hm || vm) {
        if(!occupied || hm!==(c>occupied.col) || vm!==(r>occupied.row))throw new Error("invalid-file");
        if(child(cell,"txBody")?.textContent?.trim())throw new Error("invalid-file");
        continue;
      }
      if(occupied)throw new Error("invalid-file");
      const cols=number(cell,"gridSpan",1),spanRows=number(cell,"rowSpan",1);
      if(!Number.isInteger(cols)||!Number.isInteger(spanRows)||cols<1||spanRows<1||c+cols>grid.length||r+spanRows>rows.length)throw new Error("invalid-file");
      const anchor={row:r,col:c,rows:spanRows,cols,source:cell}; anchors.push(anchor);merged ||= cols>1 || spanRows>1;
      for(let y=r;y<r+spanRows;y++)for(let x=c;x<c+cols;x++){if(occupancy[y]![x])throw new Error("invalid-file");occupancy[y]![x]=anchor;}
    }
  }
  const tablePr=child(table,"tblPr");
  let tableStyle:Element|undefined;
  const styleRel=[...ctx.reader.relationships(ctx.reader.presentationPart()).values()].find(r=>r.type===`${OFFICE_REL}/tableStyles`);
  let styleId=child(tablePr,"tableStyleId")?.textContent;
  if(styleRel){const styles=ctx.reader.xml(styleRel.target,A,"tblStyleLst");styleId ||= styles.getAttribute("def") ?? undefined;tableStyle=kids(styles).find(e=>e.localName==="tblStyle"&&e.getAttribute("styleId")===styleId);}
  if(styleId&&!tableStyle){tableStyle=builtinTableStyle(styleId,table.ownerDocument);ctx.warn("pptx-table-style");}
  if(tableStyle)tableStyle=resolveTableTheme(tableStyle,ctx.appearance,()=>ctx.warn("pptx-table-style"));
  const root:GroupElementIR={...ctx.base(merged?"Table — merged cells":"Table",ctx.width,ctx.height),kind:"table",children:[],...(merged?{}:{layout:"VERTICAL" as const})};
  const rowFrames=rows.map((_,r):GroupElementIR=>({...ctx.base(`Row ${r+1}`,ctx.width,heights[r]!*sy),kind:"group",layout:"HORIZONTAL",bounds:{x:0,y:ys[r]!,width:ctx.width,height:heights[r]!*sy},children:[]}));
  const warnPaint=()=>ctx.warn("pptx-table-style");
  const borderLayers:ElementIR[]=[];
  const gridCells:NonNullable<GroupElementIR['tableGrid']>['cells']=[];
  for(const anchor of anchors) {
    ctx.check();
    const {row:r,col:c,rows:rs,cols:cs,source}=anchor;
    const width=xs[c+cs]!-xs[c]!,height=ys[r+rs]!-ys[r]!;
    const cell:GroupElementIR={...ctx.base(`Cell ${r+1}:${c+1}`,width,height),kind:"group",bounds:{x:xs[c]!,y:merged?ys[r]!:0,width,height},children:[]};
    const gridCell:NonNullable<GroupElementIR['tableGrid']>['cells'][number]={id:cell.id,row:r,rowSpan:rs};gridCells.push(gridCell);
    const styleNames=["wholeTbl"];
    if(enabled(tablePr,"bandRow")&&!(r===0&&enabled(tablePr,"firstRow"))&&!(r+rs===rows.length&&enabled(tablePr,"lastRow")))styleNames.push((r-(enabled(tablePr,"firstRow")?1:0))%2===0?"band1H":"band2H");
    if(enabled(tablePr,"bandCol"))styleNames.push((c-(enabled(tablePr,"firstCol")?1:0))%2===0?"band1V":"band2V");
    if(c===0&&enabled(tablePr,"firstCol"))styleNames.push("firstCol");
    if(c+cs===grid.length&&enabled(tablePr,"lastCol"))styleNames.push("lastCol");
    if(r===0&&enabled(tablePr,"firstRow"))styleNames.push("firstRow");
    if(r+rs===rows.length&&enabled(tablePr,"lastRow"))styleNames.push("lastRow");
    if(r===0&&enabled(tablePr,"firstRow")&&c===0&&enabled(tablePr,"firstCol"))styleNames.push("nwCell");
    if(r===0&&enabled(tablePr,"firstRow")&&c+cs===grid.length&&enabled(tablePr,"lastCol"))styleNames.push("neCell");
    if(r+rs===rows.length&&enabled(tablePr,"lastRow")&&c===0&&enabled(tablePr,"firstCol"))styleNames.push("swCell");
    if(r+rs===rows.length&&enabled(tablePr,"lastRow")&&c+cs===grid.length&&enabled(tablePr,"lastCol"))styleNames.push("seCell");
    const styles=styleNames.map(name=>child(tableStyle,name)).filter((s):s is Element=>Boolean(s));
    const tcPr=child(source,"tcPr");
    let paint:SolidPaintIR|undefined,gradient:LinearGradientIR|undefined,pattern:PatternIR|undefined;
    const applyFill=(container:Element|undefined)=>{if(!hasFill(container))return;pattern=undefined;const patt=child(container,"pattFill");if(patt){const preset=patt.getAttribute("prst"),fg=color(kids(child(patt,"fgClr"))[0],ctx.appearance,warnPaint),bg=color(kids(child(patt,"bgClr"))[0],ctx.appearance,warnPaint);if(PATTERNS.includes(preset as PatternIR["preset"])&&fg&&bg)pattern={preset:preset as PatternIR["preset"],foreground:fg.color,background:bg.color};warnPaint();}const grad=child(container,"gradFill");gradient=grad?readGradient(grad,ctx.appearance,width,height,warnPaint):undefined;paint=grad||patt?undefined:fill(container,ctx.appearance,warnPaint);};
    applyFill(tablePr);
    for(const style of styles){const cellStyle=child(style,"tcStyle");applyFill(child(cellStyle,"fill")??cellStyle);if(child(cellStyle,"effectLst")){const effects=readEffects(cellStyle,ctx.appearance,ctx.scaleX,ctx.scaleY,()=>warnPaint());if(effects)cell.effects=effects;else delete cell.effects;}}
    applyFill(tcPr);
    if(paint||gradient||pattern)cell.children.push({...ctx.base("Cell fill",width,height),kind:"rectangle",...(paint?{fill:paint}:{}),...(gradient?{gradient}:{}),...(pattern?{pattern}:{})});
    for(const [side,local] of [["left","lnL"],["right","lnR"],["top","lnT"],["bottom","lnB"],["diagonalDown","lnTlToBr"],["diagonalUp","lnBlToTr"]] as const){
      let line:Element|undefined;
      for(const style of styles){const borders=path(style,"tcStyle","tcBdr");const inside=side==="top"&&r>0||side==="bottom"&&r+rs<rows.length?"insideH":side==="left"&&c>0||side==="right"&&c+cs<grid.length?"insideV":undefined;line=child(child(borders,side),"ln")??(inside?child(child(borders,inside),"ln"):undefined)??line;}
      line=child(tcPr,local)??line;
      const borderGradient=readGradient(child(line,"gradFill"),ctx.appearance,width,height,warnPaint),stroke=borderGradient?undefined:fill(line,ctx.appearance,warnPaint),weight=number(line,"w",9525)/9525*ctx.scaleY;
      if((stroke||borderGradient)&&weight>0){
        const coords=side==="left"?[0,0,0,height]:side==="right"?[width,0,width,height]:side==="top"?[0,0,width,0]:side==="bottom"?[0,height,width,height]:side==="diagonalDown"?[0,0,width,height]:[0,height,width,0];
        const compound=line?.getAttribute("cmpd")??"sng",patterns:Record<string,number[]>={sng:[1],dbl:[1,1,1],tri:[1,1,1,1,1],thinThick:[1,1,2],thickThin:[2,1,1]},bands=Object.hasOwn(patterns,compound)?patterns[compound]!:[1],total=bands.reduce((a,b)=>a+b,0),settings=line?.cloneNode(true) as Element|undefined;if(Object.hasOwn(patterns,compound))settings?.removeAttribute("cmpd");if(["tri","thinThick","thickThin"].includes(compound))warnPaint();
        const style=lineStyle(settings,weight,warnPaint),length=Math.hypot(coords[2]!-coords[0]!,coords[3]!-coords[1]!);
        let cursor=-weight/2;for(let band=0;band<bands.length;band++){const strokeWidth=weight*bands[band]!/total,offset=cursor+strokeWidth/2;cursor+=strokeWidth;if(band%2)continue;const dx=length?-(coords[3]!-coords[1]!)/length*offset:0,dy=length?(coords[2]!-coords[0]!)/length*offset:0;
          if(borderGradient){const nx=length?-(coords[3]!-coords[1]!)/length*strokeWidth/2:0,ny=length?(coords[2]!-coords[0]!)/length*strokeWidth/2:0,x1=coords[0]!+dx,y1=coords[1]!+dy,x2=coords[2]!+dx,y2=coords[3]!+dy,geometry=graphicPath(`M ${x1+nx} ${y1+ny} L ${x2+nx} ${y2+ny} L ${x2-nx} ${y2-ny} L ${x1-nx} ${y1-ny} Z`),b=geometry.bounds;
           if(b.width>0&&b.height>0){cell.children.push({...ctx.base(`Cell ${side} border`,b.width,b.height),kind:"path",...geometry,windingRule:"NONZERO",gradient:{...borderGradient,start:{x:(borderGradient.start.x*width-b.x)/b.width,y:(borderGradient.start.y*height-b.y)/b.height},end:{x:(borderGradient.end.x*width-b.x)/b.width,y:(borderGradient.end.y*height-b.y)/b.height}}});}if(style.dash||style.cap&&style.cap!=="NONE")warnPaint();
          }else if(stroke){
          cell.children.push({...ctx.base(`Cell ${side} border`,width,height),kind:"path",...graphicPath(`M ${coords[0]!+dx} ${coords[1]!+dy} L ${coords[2]!+dx} ${coords[3]!+dy}`),windingRule:"NONZERO",stroke:{paint:stroke,width:strokeWidth,...style}});
          }
        }
      }
    }
    if(kids(tcPr).some(e=>e.localName.includes("3d")))warnPaint();
    const body=child(source,"txBody");
    if(body){
      const defaults=source.ownerDocument.createElementNS(A,"a:defRPr");
      for(const style of styles){const tx=child(style,"tcTxStyle");if(!tx)continue;
        for(const key of ["b","i"]){const v=tx.getAttribute(key);if(v&&v!=="def")defaults.setAttribute(key,v==="on"?"1":v==="off"?"0":v);}
        const fontRef=child(tx,"fontRef");
        if(fontRef){const latin=source.ownerDocument.createElementNS(A,"a:latin");latin.setAttribute("typeface",themeFont(fontRef.getAttribute("idx")==="major"?"+mj-lt":"+mn-lt",ctx.appearance));child(defaults,"latin")?.remove();defaults.appendChild(latin);}
        const colorNode=kids(tx).find(e=>["schemeClr","srgbClr","sysClr"].includes(e.localName));
        if(colorNode){child(defaults,"solidFill")?.remove();const sf=source.ownerDocument.createElementNS(A,"a:solidFill");sf.appendChild(colorNode.cloneNode(true));defaults.appendChild(sf);}
      }
      const attrs:Record<string,string>={lIns:String(number(tcPr,"marL",91440)),rIns:String(number(tcPr,"marR",91440)),tIns:String(number(tcPr,"marT",45720)),bIns:String(number(tcPr,"marB",45720)),anchor:tcPr?.getAttribute("anchor")??"t"};
      if(tcPr?.hasAttribute("vert"))attrs.vert=tcPr.getAttribute("vert")!;
      const text=drawingText(body,ctx,width,height,attrs,defaults);
      if(text)cell.children.push({...ctx.base("Cell text",width,height),...text});
    }
    const borders=cell.children.filter(n=>n.name.startsWith("Cell ")&&n.name.endsWith(" border"));
    cell.children=cell.children.filter(n=>!borders.includes(n));
    if(borders.length){const layer:GroupElementIR={...ctx.base(`Cell borders ${r+1}:${c+1}`,width,height),kind:"group",bounds:{x:xs[c]!,y:ys[r]!,width,height},children:borders};borderLayers.push(layer);gridCell.borderId=layer.id;}
    if(merged)root.children.push(cell);else rowFrames[r]!.children.push(cell);
    if(anchors.indexOf(anchor)%25===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(!merged)root.children=rowFrames;
  const seenBorders=new Set<string>();
  for(const group of borderLayers)if("children"in group)group.children=group.children.filter(n=>{if(n.kind!=="path")return true;const key=JSON.stringify({bounds:{...n.bounds,x:n.bounds.x+group.bounds.x,y:n.bounds.y+group.bounds.y},path:n.pathData,stroke:n.stroke,gradient:n.gradient});if(seenBorders.has(key))return false;seenBorders.add(key);return true;});
  const overlay:GroupElementIR={...ctx.base("Table borders",ctx.width,ctx.height),kind:"group",children:borderLayers};
  return {...ctx.base("Table appearance",ctx.width,ctx.height),kind:"group",children:[root,...(borderLayers.length?[overlay]:[])],tableGrid:{rowHeights:heights.map(h=>h*sy),containers:[root.id,...(borderLayers.length?[overlay.id]:[])],rows:merged?[]:rowFrames.map(row=>row.id),cells:gridCells}};
}
