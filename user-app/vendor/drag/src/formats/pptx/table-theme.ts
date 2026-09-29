import {child,kids,path,number,color,type SlideAppearance} from "./appearance";
import {DRAWING as A} from "./catalog";
/** Materialize theme references on a fresh table style; never mutate package/theme DOM. */
export function resolveTableTheme(style:Element,context:SlideAppearance,warn:()=>void):Element {
 const root=style.cloneNode(true) as Element;
 const refs=[...root.getElementsByTagNameNS(A,"fillRef"),...root.getElementsByTagNameNS(A,"lnRef"),...root.getElementsByTagNameNS(A,"effectRef")];
 for(const ref of refs){
  const kind=ref.localName,idx=number(ref,"idx",0);
  if(!Number.isInteger(idx)||idx<0)throw new Error("invalid-file");
  if(!idx){const empty=root.ownerDocument.createElementNS(A,kind==="fillRef"?"a:fill":kind==="lnRef"?"a:ln":"a:effectLst");if(kind!=="effectRef")empty.appendChild(root.ownerDocument.createElementNS(A,"a:noFill"));ref.replaceWith(empty);continue;}
  const list=kind==="lnRef"?"lnStyleLst":kind==="effectRef"?"effectStyleLst":idx>=1001?"bgFillStyleLst":"fillStyleLst";
  const at=kind==="fillRef"&&idx>=1001?idx-1001:idx-1;
  const source=kids(path(context.theme,"themeElements","fmtScheme",list))[at];
  if(!source){warn();continue;}
  const copy=source.cloneNode(true) as Element,paint=color(kids(ref)[0],context,warn);
  for(const placeholder of [...copy.getElementsByTagNameNS(A,"schemeClr"),...(copy.localName==="schemeClr"?[copy]:[])]){
   if(placeholder.getAttribute("val")!=="phClr")continue;
   if(!paint){warn();continue;}
   const rgb=copy.ownerDocument.createElementNS(A,"a:srgbClr");rgb.setAttribute("val",[paint.color.r,paint.color.g,paint.color.b].map(v=>Math.round(v*255).toString(16).padStart(2,"0")).join(""));
   const alpha=copy.ownerDocument.createElementNS(A,"a:alpha");alpha.setAttribute("val",String(Math.round(paint.color.a*100000)));rgb.appendChild(alpha);
   for(const transform of kids(placeholder))rgb.appendChild(transform.cloneNode(true));placeholder.replaceWith(rgb);
  }
  if(kind==="fillRef"){const fill=root.ownerDocument.createElementNS(A,"a:fill");fill.appendChild(copy);ref.replaceWith(fill);}
  else if(kind==="lnRef")ref.replaceWith(copy);
  else {const effects=child(copy,"effectLst");if(effects)ref.replaceWith(effects);else {warn();ref.remove();}if(child(copy,"scene3d")||child(copy,"sp3d")||child(copy,"effectDag"))warn();}
 }
 return root;
}
