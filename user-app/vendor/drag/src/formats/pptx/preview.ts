import {patternPixels} from "../../core/pattern";
import {flowText,scaleText} from "../../core/text-flow";
import {layoutTable} from "../../core/table-layout";
import { paragraphText, paragraphLineHeight } from "../../core/paragraph-text";
import type { ParagraphIR } from "../../core/model";
import type { ElementIR, PageIR, SolidPaintIR, TextElementIR } from "../../core/model";

/** Reconstruction preview, deliberately not an independent PowerPoint reference render. */
export async function renderSlidePreview(page: PageIR, maxEdge: number, signal?: AbortSignal, transparent = false): Promise<string> {
  if (!Number.isFinite(maxEdge) || maxEdge < 1 || maxEdge > 1024) throw new Error("preview-size-limit");
  return renderScene(page,maxEdge,signal,transparent);
}
export async function renderGraphicRegion(page:PageIR,signal?:AbortSignal):Promise<string>{
  if(page.width<=0||page.height<=0||page.width*2>4096||page.height*2>4096||Math.ceil(page.width*2)*Math.ceil(page.height*2)>4000000)throw new Error("image-pixel-limit");
  return renderScene(page,Math.max(page.width,page.height)*2,signal,true);
}
async function renderScene(page:PageIR,maxEdge:number,signal:AbortSignal|undefined,transparent:boolean):Promise<string>{
  const canvas = document.createElement("canvas");
  const scale = maxEdge / Math.max(page.width, page.height);
  canvas.width = Math.max(1, Math.round(page.width * scale)); canvas.height = Math.max(1, Math.round(page.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.width = 0; canvas.height = 0; throw new Error("preview-unavailable"); }
  const loaded = new Map<string, HTMLImageElement>(), urls: string[] = [];
  const deadline = performance.now() + 15000;
  const check = () => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); if (performance.now() > deadline) throw new Error("raster-render-timeout"); };
  try {
    if(!transparent){ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);} ctx.scale(scale, scale);
    let renderedNodes = 0;
    const draw = async (element: ElementIR): Promise<void> => {
      if (++renderedNodes % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      check(); if (!element.visible) return;
      if ('tableGrid' in element && element.tableGrid) element=await layoutTable(element,async text=>{ctx.save();try{return await drawText(ctx,{...text,flow:{columns:1,gap:0,autoFit:"NONE"}},check,undefined,true);}finally{ctx.restore();}});
      ctx.save();
      try {
        const { x, y, width: w, height: h } = element.bounds;
        if ('clipBounds' in element && element.clipBounds) { const b=element.clipBounds;ctx.beginPath();ctx.rect(b.x,b.y,b.width,b.height);ctx.clip(); }
        ctx.translate(x, y);
        if (element.centeredTransform) {
          ctx.translate(w/2, h/2); ctx.rotate(element.rotation * Math.PI / 180);
          ctx.scale(element.centeredTransform.flipH ? -1 : 1, element.centeredTransform.flipV ? -1 : 1); ctx.translate(-w/2, -h/2);
        } else ctx.rotate(element.rotation * Math.PI / 180);
        ctx.globalAlpha *= element.opacity;
        if (element.kind === "group" || element.kind === "table" || element.kind === "chart") {
          if (element.clipPathData) ctx.clip(new Path2D(element.clipPathData));
          else if (element.clipsContent) { ctx.beginPath(); ctx.rect(0,0,w,h); ctx.clip(); }
          for (const child of [...element.children].sort((a,b) => a.zIndex-b.zIndex)) await draw(child);
        } else if (element.kind === "text") await drawText(ctx, element, check);
        else if (element.kind === "raster") {
          let image = loaded.get(element.assetId);
          if (!image) {
            const asset = page.assets?.find(a => a.id === element.assetId); if (!asset) throw new Error("missing-image-asset");
            const url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.bytes[0] === 255 ? "image/jpeg" : "image/png" })); urls.push(url);
            image = await loadImage(url, Math.max(1, deadline - performance.now()), signal); loaded.set(element.assetId, image);
          }
          ctx.drawImage(image,0,0,w,h);
        } else if (element.kind === "rectangle" || element.kind === "ellipse" || element.kind === "line" || element.kind === "path") {
          const shape = new Path2D(element.kind === "path" ? element.pathData : undefined);
          if (element.kind === "rectangle") shape.rect(0,0,w,h);
          if (element.kind === "ellipse") shape.ellipse(w/2,h/2,w/2,h/2,0,0,2*Math.PI);
          if (element.kind === "line") { shape.moveTo(0,0); shape.lineTo(w,h); }
          if (element.fill) { ctx.fillStyle = css(element.fill); ctx.fill(shape, element.windingRule === "EVENODD" ? "evenodd" : "nonzero"); }
          if (element.gradient) {
            const g=element.gradient;
            let gradientShape=shape;
            if(g.type==="radial"){
              const x=g.start.x*w,y=g.start.y*h,sx=(g.end.x-g.start.x)*w,sy=(g.end.y-g.start.y)*h;
              ctx.save();ctx.translate(x,y);ctx.scale(sx,sy);
              // Canvas gradients use the transform at paint time. Keep the
              // ellipse transform active and map the shape back into that space.
              gradientShape=new Path2D();gradientShape.addPath(shape,new DOMMatrix([1/sx,0,0,1/sy,-x/sx,-y/sy]));
            }
            try{
              const paint=g.type==="radial"?ctx.createRadialGradient(.5,.5,0,.5,.5,.5):ctx.createLinearGradient(g.start.x*w,g.start.y*h,g.end.x*w,g.end.y*h);
              for(const stop of g.stops)paint.addColorStop(stop.position,css({type:"solid",color:stop.color}));
              ctx.fillStyle=paint;ctx.fill(gradientShape,element.windingRule==="EVENODD"?"evenodd":"nonzero");
            }finally{if(g.type==="radial")ctx.restore();}
          }
          if(element.pattern){const tile=document.createElement("canvas");tile.width=8;tile.height=8;const tc=tile.getContext("2d")!;tc.putImageData(new ImageData(new Uint8ClampedArray(patternPixels(element.pattern)),8,8),0,0);const pattern=ctx.createPattern(tile,"repeat");if(pattern){ctx.fillStyle=pattern;ctx.fill(shape,element.windingRule==="EVENODD"?"evenodd":"nonzero");}}
          if (element.stroke) { ctx.strokeStyle = css(element.stroke.paint); ctx.lineWidth = element.stroke.width; ctx.setLineDash(element.stroke.dash ?? []); ctx.lineCap=element.stroke.cap === "ROUND" ? "round" : element.stroke.cap === "SQUARE" ? "square" : "butt"; ctx.lineJoin=element.stroke.join === "ROUND" ? "round" : element.stroke.join === "BEVEL" ? "bevel" : "miter"; ctx.stroke(shape); }
        }
      } finally { ctx.restore(); }
    };
    for (const element of [...page.elements].sort((a,b)=>a.zIndex-b.zIndex)) await draw(element);
    check(); return canvas.toDataURL("image/png");
  } finally { for (const url of urls) URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
}
function css(paint: SolidPaintIR): string { const c = paint.color; return `rgba(${c.r*255},${c.g*255},${c.b*255},${c.a})`; }
export type TextMetricsIR = { width:number; height:number; overflow:boolean; lines?:number };
/** Uses exactly the layout/font measurements used by the preview painter. */
export async function measureTextBox(element:TextElementIR,paragraph?:ParagraphIR):Promise<TextMetricsIR>{
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('text-measurement-unavailable');
  const metrics={width:0,height:0,overflow:false};
  try{await drawText(ctx,paragraph?{...element,paragraphs:undefined}:element,()=>{},paragraph,true,metrics);return metrics;}
  finally{canvas.width=canvas.height=0;}
}
/** Use the source typesetter for vector text as well as canvas previews.
 * Ink bounds (rather than font line-box height) determine visible overflow. */
export async function renderTextSvg(element:TextElementIR):Promise<{svg:string;ink:{left:number;top:number;right:number;bottom:number};overflow:boolean}>{
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('text-measurement-unavailable');
  const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const parts:string[]=[],bounds:Array<{x:number;y:number}>=[];
  const matrix=()=>{const m=ctx.getTransform();return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;};
  ctx.fillText=(text,x,y)=>{
    const m=ctx.getTransform(),metric=ctx.measureText(text);
    if(text.trim())for(const [xx,yy] of [[x-metric.actualBoundingBoxLeft,y-metric.actualBoundingBoxAscent],[x+metric.actualBoundingBoxRight,y+metric.actualBoundingBoxDescent]])bounds.push({x:m.a*xx+m.c*yy+m.e,y:m.b*xx+m.d*yy+m.f});
    parts.push(`<text transform="${matrix()}" x="${x}" y="${y}" style="font:${escape(ctx.font)};white-space:pre" fill="${escape(ctx.fillStyle)}">${escape(text)}</text>`);
  };
  ctx.fillRect=(x,y,width,height)=>{parts.push(`<rect transform="${matrix()}" x="${x}" y="${y}" width="${width}" height="${height}" fill="${escape(ctx.fillStyle)}"/>`);};
  try{
    await drawText(ctx,element,()=>{});
    const ink={left:Math.min(0,...bounds.map(p=>p.x)),top:Math.min(0,...bounds.map(p=>p.y)),right:Math.max(0,...bounds.map(p=>p.x)),bottom:Math.max(0,...bounds.map(p=>p.y))};
    return {svg:parts.join(''),ink,overflow:ink.left < -3||ink.top < -3||ink.right>element.bounds.width+3||ink.bottom>element.bounds.height+3};
  }
  finally{canvas.width=canvas.height=0;}
}
async function drawText(ctx: CanvasRenderingContext2D, element: TextElementIR, check: () => void, paragraph?:ParagraphIR, measure=false, metrics?:TextMetricsIR): Promise<number> {
  if (element.text.length > 50000) throw new Error("preview-text-limit");
  if(element.paragraphs){
    const measureText=async(text:TextElementIR,p:ParagraphIR)=>{ctx.save();try{const m={width:0,height:0,overflow:false};await drawText(ctx,text,check,p,true,m);return m;}finally{ctx.restore();}};
    let laid=await flowText(element,measureText);
    if(element.flow?.autoFit==="SHRINK"&&laid.overflow){let low=.2,high=1,best=await flowText(scaleText(element,low),measureText);for(let i=0;i<6;i++){const mid=(low+high)/2,trial=await flowText(scaleText(element,mid),measureText);if(trial.overflow)high=mid;else{low=mid;best=trial;}}laid=best;}
    if(!measure)for(const item of laid.items){ctx.save();try{
      ctx.translate(item.x,item.y);
      // flowText already positioned this paragraph, including a negative bottom-anchor shift.
      // Its drawing clip must span the laid-out paragraph, not the original unshifted frame.
      const text={...item.text,bounds:{...item.text.bounds,height:Math.max(item.text.bounds.height,item.height)}};
      await drawText(ctx,text,check,item.paragraph);
    }finally{ctx.restore();}}
    if(metrics)Object.assign(metrics,{height:laid.height,width:Math.max(0,...laid.items.map(i=>i.x+i.width)),overflow:laid.overflow});
    return laid.height;
  }
  const { width, height } = element.bounds;
  ctx.beginPath(); ctx.rect(0,0,width,height); ctx.clip(); ctx.textBaseline = "alphabetic";
  type Glyph = { chars: string; x: number; font: string; color: string; size: number; decoration: string | undefined; width:number; ascent:number; descent:number; shift:number };
  const lines: { glyphs: Glyph[]; width: number; height: number }[] = [{ glyphs: [], width: paragraph?.indent??0, height: paragraph?paragraphLineHeight(paragraph):element.fontSize * 1.2 }];
  let offset = 0, styleIndex = 0, colorIndex = 0, processed = 0;
  for (const chars of element.text) {
    if (++processed % 1024 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
    while (element.styleRuns?.[styleIndex] && element.styleRuns[styleIndex]!.end <= offset) styleIndex++;
    while (element.colorRuns?.[colorIndex] && element.colorRuns[colorIndex]!.end <= offset) colorIndex++;
    const candidate = element.styleRuns?.[styleIndex], colorCandidate = element.colorRuns?.[colorIndex];
    const style = candidate && candidate.start <= offset ? candidate : undefined;
    const color = colorCandidate && colorCandidate.start <= offset ? colorCandidate.fill : undefined;
    const size = style?.fontSize ?? element.fontSize, family = style?.fontFamily ?? element.fontFamily, fontStyle = style?.fontStyle ?? element.fontStyle ?? "Regular";
    const font = `${fontStyle.includes("Italic") ? "italic " : ""}${fontStyle.includes("Bold") ? "bold " : ""}${size}px ${JSON.stringify(family)}`;
    ctx.font = font;
    let line = lines[lines.length-1]!;
    const measuredGlyph=ctx.measureText(chars),shift=(style?.baselineShift??0)*size;
    const ascent=measuredGlyph.fontBoundingBoxAscent??size*.8,descent=measuredGlyph.fontBoundingBoxDescent??size*.2;
    const measured = Math.max(0,measuredGlyph.width + (style?.letterSpacing ?? 0));
    if (chars === "\n") { line = { glyphs: [], width: 0, height: paragraph?paragraphLineHeight(paragraph):size*1.2 }; lines.push(line); }
    else if (element.textBox?.wrap && line.width + measured > width && line.glyphs.length) {
      // Keep a word together when it fits on the next line. A word longer than
      // the whole field still breaks by glyph; the source text is never changed.
      const boundary=line.glyphs.findLastIndex(g=>g.chars===' '||g.chars==='-'||g.chars==='\u2010');
      const carry=boundary>=0?line.glyphs.splice(boundary+1):[];
      const start=carry[0]?.x??line.width;
      if(carry.length){line.width=start;if(!paragraph?.lineHeight)line.height=Math.max(paragraph?paragraphLineHeight(paragraph):element.fontSize*1.2,...line.glyphs.map(g=>g.size*1.2));}
      const next={glyphs:carry.map(g=>({...g,x:g.x-start})),width:carry.reduce((sum,g)=>sum+g.width,0),height:paragraph?paragraphLineHeight(paragraph):Math.max(size,...carry.map(g=>g.size))*1.2};
      line=next;lines.push(line);
    }
    if (chars !== "\n") { line.glyphs.push({ chars, x: line.width, font, color: color ? css(color) : "black", size, decoration:style?.decoration, width:measured,ascent,descent,shift }); line.width += measured; if(!paragraph?.lineHeight)line.height = Math.max(line.height,size*1.2); }
    offset += chars.length;
  }
  const total = lines.reduce((sum,line)=>sum+line.height,0);
  let inkEnd=0,advance=0;
  const baselines:number[]=[];
  for(const line of lines){
    const ascent=Math.max(0,...line.glyphs.map(g=>g.ascent+g.shift)),descent=Math.max(0,...line.glyphs.map(g=>g.descent-g.shift));
    // Explicit paragraph spacing advances the baseline. Recomputing it from
    // each line's top and its smaller font caused units to overlap big numbers.
    const baseline=paragraph?.lineHeight&&baselines.length
      ? baselines[baselines.length-1]!+lines[baselines.length-1]!.height
      : advance+Math.max(0,(line.height-ascent-descent)/2)+ascent;
    baselines.push(baseline);inkEnd=Math.max(inkEnd,baseline+descent);advance+=line.height;
  }
  const occupied=Math.max(total,inkEnd);
  if(metrics){const measuredWidth=Math.max(0,...lines.map(line=>line.width));Object.assign(metrics,{height:occupied,width:measuredWidth,lines:lines.length,overflow:occupied>height+1||measuredWidth>width+1});}
  if(measure)return occupied;
  const y = element.textBox?.vertical === "CENTER" ? (height-occupied)/2 : element.textBox?.vertical === "BOTTOM" ? height-occupied : 0;
  for (const [index,line] of lines.entries()) {
    check();
    const x = element.textBox?.align === "CENTER" ? (width-line.width)/2 : element.textBox?.align === "RIGHT" ? width-line.width : 0;
    const baseline=y+baselines[index]!;
    for (const glyph of line.glyphs) { ctx.font = glyph.font; ctx.fillStyle = glyph.color; const gy=baseline-glyph.shift;ctx.fillText(glyph.chars,x+glyph.x,gy); if(glyph.decoration && glyph.decoration!=="NONE")ctx.fillRect(x+glyph.x,gy+glyph.size*(glyph.decoration==="UNDERLINE"?.10:-.3),glyph.width,Math.max(1,glyph.size/16)); }
  }
  return occupied;
}
function loadImage(url: string, timeout: number, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve,reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort",abort); image.onload = null; image.onerror = null; };
    const abort = () => { cleanup(); image.src = ""; reject(new Error("preview-unavailable")); };
    const timer = setTimeout(abort,timeout);
    image.onload = () => { cleanup(); resolve(image); }; image.onerror = abort;
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort",abort,{ once: true }); image.src = url;
  });
}
