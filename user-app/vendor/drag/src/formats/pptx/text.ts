import { paragraphProperties, percentage } from "./paragraph";
import { listCounter } from "./numbering";
import type { TextElementIR, TextStyleRunIR, ParagraphIR } from "../../core/model";
import { PRESENTATION as P } from "./catalog";
import { child, kids, path, number, themeFont, textBody, placeholder, fill, color, type SlideAppearance } from "./appearance";

export function slideText(layers: Element[], context: SlideAppearance, width: number, height: number, warn: (code: string) => void, resolveLink?: (node: Element) => string | undefined): (Omit<TextElementIR, "id" | "name" | "zIndex" | "rotation" | "opacity" | "visible"> & Partial<Pick<TextElementIR,'rotation'>>) | undefined {
  const source = layers[layers.length - 1]!;
  const body = textBody(source);
  if (!body) return undefined;
  const bodyAttrs: Record<string, string> = {};
  for (const layer of layers) for (const attr of Array.from(child(textBody(layer), "bodyPr")?.attributes ?? [])) bodyAttrs[attr.localName] = attr.value;
  const vertical=bodyAttrs.vert??"horz";
  if(!["horz","vert","vert270"].includes(vertical))warn("pptx-text-layout");
  // The shape's bounds already include group scaling. DrawingML font sizes,
  // text insets and paragraph distances remain absolute point/EMU metrics.
  const columns=Number(bodyAttrs.numCol??1),gap=Number(bodyAttrs.spcCol??0)/9525;
  if(!Number.isInteger(columns)||columns<1||columns>16||!Number.isFinite(gap)||gap<0||gap>10000)throw new Error("security-limit");
  const bodyRotation=Number(bodyAttrs.rot??0)/60000+(vertical==="vert"?90:vertical==="vert270"?-90:0);
  if(!Number.isFinite(bodyRotation)||Math.abs(bodyRotation)>36000)throw new Error("security-limit");
  let auto:Element|undefined;
  for(const layer of layers){const next=kids(child(textBody(layer),"bodyPr")).find(e=>["normAutofit","noAutofit","spAutoFit"].includes(e.localName));if(next)auto=next;}
  const fontScale=auto?.localName==="normAutofit"?percentage(auto.getAttribute("fontScale"),100)/100:1;
  const reduction=auto?.localName==="normAutofit"?percentage(auto.getAttribute("lnSpcReduction"),0):0;
  if(fontScale<=0||fontScale>1||reduction>=100)throw new Error("security-limit");

  const inset = (key: string, fallback: number) => {
    const raw = bodyAttrs[key] === undefined ? fallback : Number(bodyAttrs[key]);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1000000000) throw new Error("invalid-file");
    return raw / 9525;
  };
  const left = inset("lIns", 91440), right = inset("rIns", 91440), top = inset("tIns", 45720), bottom = inset("bIns", 45720);
  let text = "";
  const links: NonNullable<TextElementIR["linkRuns"]> = [];
  const styles: TextStyleRunIR[] = [], colors: NonNullable<TextElementIR["colorRuns"]> = [];
  const paragraphs = kids(body).filter(c => c.localName === "p");
  if(paragraphs.length>2048)throw new Error("security-limit");
  const alignments: string[] = [];
  const paragraphRuns:ParagraphIR[]=[];
  let needsFlow=columns>1||auto?.localName==="normAutofit"||auto?.localName==="spAutoFit";
  const nextMarker = listCounter();
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const pp = child(paragraph, "pPr"), level = number(pp, "lvl", 0);
    if (level < 0 || level > 8 || !Number.isInteger(level)) throw new Error("invalid-file");
    const ph = layers.map(s => placeholder(s)).find(p => p);
    const type = ph ? ph.getAttribute("type") ?? "obj" : undefined;
    const category = type === "title" || type === "ctrTitle" ? "titleStyle" : type === "body" || type === "obj" || type === "subTitle" ? "bodyStyle" : "otherStyle";
    const propertyLayers = [child(context.defaultText, `lvl${level + 1}pPr`), child(child(context.master, "txStyles", P), category, P)].map((e, i) => i === 1 ? child(e, `lvl${level + 1}pPr`) : e);
    for (const layer of layers) {
      propertyLayers.push(path(textBody(layer), "lstStyle", `lvl${level + 1}pPr`));
      if (layer !== source) propertyLayers.push(child(kids(textBody(layer)).find(e => e.localName === "p"), "pPr"));
    }
    propertyLayers.push(pp);
    const merged: Record<string, string> = {};
    for (const p of propertyLayers) for (const attr of Array.from(p?.attributes ?? [])) merged[attr.localName] = attr.value;
    const alignment = ({ l: "LEFT", ctr: "CENTER", r: "RIGHT", just: "JUSTIFIED" } as Record<string, string>)[merged.algn ?? "l"] ?? "LEFT";
    alignments.push(alignment);

    let bullet: Element | undefined;
    for (const p of propertyLayers) { const next = kids(p).find(c => ["buNone", "buChar", "buAutoNum", "buBlip"].includes(c.localName)); if (next) bullet = next; }
    if (paragraphIndex) text += "\n";
    const paragraphStart=text.length,styleStart=styles.length,colorStart=colors.length;
    const runs = kids(paragraph).filter(c => ["r", "fld", "br"].includes(c.localName));
    const marker = nextMarker(level, bullet);
    if (bullet && bullet.localName !== "buNone") {
      warn("pptx-text-layout");
      text += bullet.localName === "buChar" ? `${bullet.getAttribute("char") || "•"} ` : marker ?? "• ";
    }
    const markerLength=text.length-paragraphStart;
    for (const run of runs) {
      const chars = run.localName === "br" ? "\n" : child(run, "t")?.textContent ?? "";
      if (!chars) continue;
      const defaults = propertyLayers.map(p => child(p, "defRPr"));
      const rpr = child(run, "rPr");
      const styleLayers = [...defaults, rpr].filter((e): e is Element => Boolean(e));
      const attrs: Record<string, string> = {};
      let family = "", paint: ReturnType<typeof fill>;
      let reference: Element | undefined;
      for (const layer of layers) { const ref = child(child(layer, "style", P), "fontRef"); if (ref) reference = ref; }
      paint = color(kids(reference)[0], context, () => warn("pptx-paint"));
      family = themeFont(reference?.getAttribute("idx") === "major" || category === "titleStyle" ? "+mj-lt" : "+mn-lt", context);
      for (const style of styleLayers) {
        for (const attr of Array.from(style.attributes)) attrs[attr.localName] = attr.value;
        const latin = child(style, "latin")?.getAttribute("typeface");
        if (latin) family = themeFont(latin, context);
        const next = fill(style, context, () => warn("pptx-paint")); if (next) paint = next;
        if (child(style, "noFill")) paint = { type: "solid", color: { r: 0, g: 0, b: 0, a: 0 } };
        if (kids(style).some(e => ["effectLst", "highlight", "uFill", "ln"].includes(e.localName))) warn("pptx-text-style");
      }
      if (attrs.cap && !["none", "0"].includes(attrs.cap)) warn("pptx-text-style");
      const baselineShift=attrs.baseline===undefined?undefined:Number(attrs.baseline)/100000;
      if(baselineShift!==undefined&&(!Number.isFinite(baselineShift)||Math.abs(baselineShift)>4))throw new Error('invalid-file');
      let decoration: TextStyleRunIR["decoration"];
      if (attrs.u) { if (["none","sng"].includes(attrs.u)) decoration = attrs.u === "sng" ? "UNDERLINE" : "NONE"; else warn("pptx-text-style"); }
      if (attrs.strike && attrs.strike !== "noStrike") { if(attrs.strike === "sngStrike" && decoration !== "UNDERLINE") decoration="STRIKETHROUGH"; else warn("pptx-text-style"); }
      const letterSpacing = attrs.spc === undefined ? undefined : Number(attrs.spc) / 100 * 96 / 72;
      if(letterSpacing !== undefined && (!Number.isFinite(letterSpacing) || Math.abs(letterSpacing)>1000)) throw new Error("security-limit");
      const bold = ["1", "true"].includes(attrs.b ?? ""), italic = ["1", "true"].includes(attrs.i ?? "");
      const fontStyle = bold ? italic ? "Bold Italic" : "Bold" : italic ? "Italic" : "Regular";
      const fontSize = (attrs.sz === undefined ? 18 : Number(attrs.sz) / 100) * 96 / 72 * fontScale;
      if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 10000 || !family || family.length > 256) throw new Error("invalid-file");
      const start = text.length; text += chars;
      const hyperlink = child(rpr, "hlinkClick");
      if (hyperlink) { const url = resolveLink?.(hyperlink); if (url) links.push({ start, end: text.length, url }); else if (!resolveLink) warn("pptx-link"); }
      styles.push({ start, end: text.length, fontFamily: family, fontStyle, fontSize, ...(baselineShift===undefined?{}:{baselineShift}), ...(decoration ? {decoration}:{}), ...(letterSpacing === undefined ? {} : {letterSpacing}) });
      colors.push({ start, end: text.length, fill: paint ?? { type: "solid", color: { r: 0, g: 0, b: 0, a: 1 } } });
      if (run.localName === "fld") warn("pptx-text-style");
    }
    if(markerLength && styles.length>styleStart){
      const markerEnd=paragraphStart+markerLength;
      let bulletColor:Element|undefined;
      for(const p of propertyLayers){const next=kids(p).find(n=>n.localName==="buClr"||n.localName==="buClrTx");if(next)bulletColor=next;}
      const paint=bulletColor?.localName==="buClr"?color(kids(bulletColor)[0],context,()=>warn("pptx-paint")):undefined;
      styles.splice(styleStart,0,{...styles[styleStart]!,start:paragraphStart,end:markerEnd});
      colors.splice(colorStart,0,{start:paragraphStart,end:markerEnd,fill:paint??colors[colorStart]!.fill});
    }
    const endProperties=child(paragraph,"endParaRPr");
    const emptySize=number(endProperties,"sz",1800)/100*96/72*fontScale;
    const maxSize=styles.length>styleStart?styles.slice(styleStart).reduce((n,s)=>Math.max(n,s.fontSize),0):emptySize;
    const props=paragraphProperties(propertyLayers,merged,1,1,maxSize,reduction,()=>warn("pptx-text-layout"));
    if(props.indent && runs.some(r=>r.localName==="br"))warn("pptx-text-layout");
    if(props.left||props.right||props.indent||props.before||props.after||props.lineHeight)needsFlow=true;
    paragraphRuns.push({start:paragraphStart,end:text.length,...props,...(markerLength?{markerLength}:{})});
  }
  if(text.includes("\t"))needsFlow=true;
  if (!text.trim()) return undefined;
  if(paragraphRuns.some(props=>props.left+props.right>=width-left-right))throw new Error("invalid-file");
  if (text.length > 1000000) throw new Error("security-limit");
  if (new Set(alignments).size > 1) needsFlow=true;
  if(paragraphRuns.length>2048)throw new Error("security-limit");
  const first = styles[0] ?? { fontFamily: "Arial", fontStyle: "Regular" as const, fontSize: 24 };
  if (width - left - right <= 0 || height - top - bottom <= 0) { warn("pptx-text-layout"); return undefined; }
  const contentWidth=width-left-right,contentHeight=height-top-bottom;
  const quarterTurn=vertical==="vert"||vertical==="vert270";
  const boxWidth=quarterTurn?contentHeight:contentWidth,boxHeight=quarterTurn?contentWidth:contentHeight;
  if((boxWidth-gap*(columns-1))/columns<=0)throw new Error("invalid-file");
  return { ...(bodyRotation?{rotation:bodyRotation,centeredTransform:{flipH:false,flipV:false}}:{}), ...(needsFlow?{paragraphs:paragraphRuns,flow:{columns,gap,autoFit:auto?.localName==="normAutofit"?"SHRINK" as const:auto?.localName==="spAutoFit"?"GROW" as const:"NONE" as const}}:{}), kind: "text", text, fontFamily: first.fontFamily, fontStyle: first.fontStyle, fontSize: first.fontSize,
    ...(links.length ? { linkRuns: links } : {}), styleRuns: styles, colorRuns: colors, bounds: { x: left+(contentWidth-boxWidth)/2, y: top+(contentHeight-boxHeight)/2, width: boxWidth, height: boxHeight },
    textBox: { align: (alignments[0] ?? "LEFT") as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED", vertical: bodyAttrs.anchor === "ctr" ? "CENTER" : bodyAttrs.anchor === "b" ? "BOTTOM" : "TOP", wrap: bodyAttrs.wrap !== "none" } };
}
