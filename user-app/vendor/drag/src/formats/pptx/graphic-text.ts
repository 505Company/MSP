import { DRAWING as A, PRESENTATION as P } from "./catalog";
import { child } from "./appearance";
import { slideText } from "./text";
import type { GraphicContext } from "./graphic-context";

/** Reuse the text interpreter for DrawingML cell/chart text without passing XML into PageIR. */
export function drawingText(body: Element, ctx: GraphicContext, width: number, height: number, attrs: Record<string,string> = {}, defaultRun?: Element) {
  const doc = body.ownerDocument;
  const shape = doc.createElementNS(P,"p:sp"), txBody = doc.createElementNS(P,"p:txBody");
  for (const element of Array.from(body.children)) txBody.appendChild(element.cloneNode(true));
  let bodyPr = child(txBody,"bodyPr");
  if (!bodyPr) { bodyPr = doc.createElementNS(A,"a:bodyPr"); txBody.insertBefore(bodyPr,txBody.firstChild); }
  for (const [key,value] of Object.entries(attrs)) bodyPr.setAttribute(key,value);
  if (defaultRun) {
    let list = child(txBody,"lstStyle");
    if (!list) { list = doc.createElementNS(A,"a:lstStyle"); txBody.insertBefore(list,bodyPr.nextSibling); }
    for (let level=1;level<=9;level++) {
      let pp = child(list,`lvl${level}pPr`);
      if (!pp) { pp=doc.createElementNS(A,`a:lvl${level}pPr`);list.appendChild(pp); }
      const existing = child(pp,"defRPr"), merged = defaultRun.cloneNode(true) as Element;
      if (existing) {
        for (const a of Array.from(existing.attributes)) merged.setAttribute(a.name,a.value);
        for (const e of Array.from(existing.children)) { const old=child(merged,e.localName,e.namespaceURI ?? A);old?.remove();merged.appendChild(e.cloneNode(true)); }
        existing.remove();
      }
      pp.appendChild(merged);
    }
  }
  shape.appendChild(txBody);
  return slideText([shape],ctx.appearance,width,height,ctx.warn);
}
