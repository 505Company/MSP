import { PptxCatalogReader, DRAWING as A, OFFICE_REL } from "./catalog";
import { child } from "./appearance";
export const DIAGRAM="http://schemas.openxmlformats.org/drawingml/2006/diagram";
/** Keep stored labels, without inventing a SmartArt layout or executing its rules. */
export function smartArtText(reader:PptxCatalogReader,data:Element|undefined,part:string):string|undefined{
  const id=child(data,"relIds",DIAGRAM)?.getAttributeNS(OFFICE_REL,"dm");
  const rel=id?reader.relationships(part).get(id):undefined;
  if(!rel||rel.external||rel.type!==`${OFFICE_REL}/diagramData`)return undefined;
  const model=reader.xml(rel.target,DIAGRAM,"dataModel");
  const texts=Array.from(model.getElementsByTagNameNS(DIAGRAM,"t")).map(body=>Array.from(body.getElementsByTagNameNS(A,"p")).map(p=>Array.from(p.children).filter(e=>e.namespaceURI===A&&["r","fld","br"].includes(e.localName)).map(e=>e.localName==="br"?"\n":child(e,"t")?.textContent??"").join("")).join("\n")).filter(t=>t.trim());
  const text=texts.join("\n\n");
  if(text.length>100000)throw new Error("security-limit");
  return text||undefined;
}

export const DIAGRAM_DRAWING="http://schemas.microsoft.com/office/drawing/2008/diagram";
/** Read the source application's last successful layout; never execute diagram rules. */
export function smartArtDrawing(reader:PptxCatalogReader,data:Element|undefined,part:string):{tree:Element;part:string}|undefined {
  const id=child(data,"relIds",DIAGRAM)?.getAttributeNS(OFFICE_REL,"dm");
  const rel=id?reader.relationships(part).get(id):undefined;
  if(!rel||rel.external||rel.type!==`${OFFICE_REL}/diagramData`)return undefined;
  const model=reader.xml(rel.target,DIAGRAM,"dataModel");
  const extensions=Array.from(model.getElementsByTagNameNS(DIAGRAM_DRAWING,"dataModelExt"));
  if(extensions.length>1)throw new Error("invalid-file");
  const drawingId=extensions[0]?.getAttribute("relId");
  if(!drawingId)return undefined;
  const drawing=reader.relationships(rel.target).get(drawingId);
  if(!drawing||drawing.external||drawing.type!=="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing")return undefined;
  const root=reader.xml(drawing.target,DIAGRAM_DRAWING,"drawing"),tree=child(root,"spTree",DIAGRAM_DRAWING);
  if(!tree)return undefined;
  const doc=tree.ownerDocument;
  // Presentation and cached diagram shapes share DrawingML properties; normalize only
  // the diagram wrapper namespace in a fresh DOM, leaving cached source XML intact.
  const copy=(source:Element):Element=>{
    const ns=source.namespaceURI===DIAGRAM_DRAWING?"http://schemas.openxmlformats.org/presentationml/2006/main":source.namespaceURI;
    const node=doc.createElementNS(ns,source.localName);
    for(const attribute of Array.from(source.attributes))if(attribute.namespaceURI!=="http://www.w3.org/2000/xmlns/")node.setAttributeNS(attribute.namespaceURI,attribute.name,attribute.value);
    for(const child of Array.from(source.childNodes))node.appendChild(child.nodeType===1?copy(child as Element):child.cloneNode(true));
    return node;
  };
  return {tree:copy(tree),part:drawing.target};
}
