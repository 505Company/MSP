import {child,kids,color,fill,hasFill,number,type SlideAppearance} from './appearance';
import {DRAWING as A,PRESENTATION as P} from './catalog';
import {DIAGRAM as D} from './smart-art';
import {resolveTableTheme} from './table-theme';
import {readGradient} from './gradient';
import {readEffects} from './effects';
import {lineStyle} from './line-style';
import {slideText} from './text';
import type {LayoutInstance} from './smart-art-program';
import type {ShapeElementIR,SolidPaintIR,TextElementIR} from '../../core/model';
export interface SmartArtStyleContext {appearance:SlideAppearance;quickStyle?:Element;colors?:Element;warn:(code:string)=>void}
const blue:SolidPaintIR={type:'solid',color:{r:.15,g:.36,b:.7,a:1}};
function rgb(doc:Document,paint:SolidPaintIR):Element {
 const e=doc.createElementNS(A,'a:srgbClr');e.setAttribute('val',[paint.color.r,paint.color.g,paint.color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''));
 const a=doc.createElementNS(A,'a:alpha');a.setAttribute('val',String(Math.round(paint.color.a*100000)));e.appendChild(a);return e;
}
function label(root:Element|undefined,name:string):Element|undefined {
 const matches=kids(root,D).filter(e=>e.localName==='styleLbl'&&e.getAttribute('name')===name);if(matches.length>1)throw new Error('invalid-file');return matches[0];
}
/** Color lists are resolved once for each rendered layout instance, never on package DOM. */
function palette(list:Element|undefined,index:number,context:SmartArtStyleContext):SolidPaintIR|undefined {
 const choices=kids(list);if(choices.length>256)throw new Error('security-limit');if(!choices.length)return undefined;
 const method=list?.getAttribute('meth')??'span';
 if(!['repeat','cycle','span'].includes(method)){context.warn('pptx-paint');return undefined;}
 // Span needs the total number of matching nodes to interpolate; disclose its approximation.
 if(method==='span'&&choices.length>1)context.warn('pptx-paint');
 const at=method==='repeat'?Math.min(index,choices.length-1):index%choices.length;
 return color(choices[at],context.appearance,()=>context.warn('pptx-paint'));
}
export function smartArtStyle(layout:LayoutInstance,index:number,width:number,height:number,font:number,context:SmartArtStyleContext):{shape:Partial<ShapeElementIR>;text?:Omit<TextElementIR,'id'|'name'|'zIndex'|'rotation'|'opacity'|'visible'>} {
 const {appearance:appearance,warn}=context,doc=appearance.slide.ownerDocument,quick=label(context.quickStyle,layout.styleLabel),colors=label(context.colors,layout.styleLabel),props=doc.createElementNS(A,'a:spPr');
 const paintWarn=()=>warn('pptx-paint'),fillColor=palette(child(colors,'fillClrLst',D),index,context),lineColor=palette(child(colors,'linClrLst',D),index,context),textColor=palette(child(colors,'txFillClrLst',D),index,context);
 const style=child(quick,'style',D)?.cloneNode(true) as Element|undefined;
 if(style){
  for(const [name,paint]of [['fillRef',fillColor],['lnRef',lineColor]] as const){const ref=child(style,name);if(ref&&paint){for(const e of kids(ref))e.remove();ref.appendChild(rgb(doc,paint));}}
  const resolved=resolveTableTheme(style,appearance,paintWarn);
  for(const e of kids(resolved)){if(e.localName==='fill')for(const f of kids(e))props.appendChild(f.cloneNode(true));else if(['ln','effectLst'].includes(e.localName))props.appendChild(e.cloneNode(true));}
 }
 const direct=child(layout.points[0]?.source??layout.data.source,'spPr',D);
 if(direct){for(const e of kids(direct)){if(e.localName.endsWith('Fill'))for(const old of kids(props).filter(p=>p.localName.endsWith('Fill')))old.remove();else for(const old of kids(props).filter(p=>p.localName===e.localName))old.remove();props.appendChild(e.cloneNode(true));}}
 const shape:Partial<ShapeElementIR>={};
 const gradient=readGradient(child(props,'gradFill'),appearance,width,height,paintWarn);
 if(gradient)shape.gradient=gradient;else {const paint=hasFill(props)?fill(props,appearance,paintWarn):fillColor??blue;if(paint)shape.fill=paint;}
 const line=child(props,'ln'),linePaint=line?fill(line,appearance,paintWarn):lineColor,weight=line?number(line,'w',9525)/9525:1;
 if(weight<0||weight>1000)throw new Error('security-limit');if(linePaint&&weight)shape.stroke={width:weight,paint:linePaint,...lineStyle(line,weight,paintWarn)};
 const effects=readEffects(props,appearance,1,1,warn);if(effects)shape.effects=effects;
 if(child(quick,'scene3d',D)||child(quick,'sp3d',D))warn('pptx-effect');
 const source=doc.createElementNS(P,'p:sp'),body=doc.createElementNS(P,'p:txBody');source.appendChild(body);
 const bodyPr=doc.createElementNS(A,'a:bodyPr');for(const k of ['lIns','rIns','tIns','bIns'])bodyPr.setAttribute(k,'0');bodyPr.setAttribute('anchor','ctr');body.appendChild(bodyPr);
 const defaults=doc.createElementNS(A,'a:lstStyle'),p=doc.createElementNS(A,'a:lvl1pPr'),r=doc.createElementNS(A,'a:defRPr');p.setAttribute('algn','ctr');r.setAttribute('sz',String(Math.round(font*75)));p.appendChild(r);defaults.appendChild(p);body.appendChild(defaults);
 const tc=textColor??{type:'solid' as const,color:layout.shape==='none'?{r:0,g:0,b:0,a:1}:{r:1,g:1,b:1,a:1}},solid=doc.createElementNS(A,'a:solidFill');solid.appendChild(rgb(doc,tc));r.appendChild(solid);
 const quickText=child(quick,'txPr',D);for(const e of kids(quickText)){if(e.localName==='bodyPr'){for(const a of Array.from(e.attributes))bodyPr.setAttribute(a.name,a.value);}else if(e.localName==='lstStyle'){for(const level of kids(e)){const existing=child(defaults,level.localName);if(existing)existing.replaceWith(level.cloneNode(true));else defaults.appendChild(level.cloneNode(true));}}}
 for(const point of layout.points){const text=child(point.source,'t',D);for(const para of kids(text).filter(e=>e.localName==='p'))body.appendChild(para.cloneNode(true));}
 const fontRef=child(style,'fontRef');if(fontRef){const styleNode=doc.createElementNS(P,'p:style');styleNode.appendChild(fontRef.cloneNode(true));source.appendChild(styleNode);}
 const text=slideText([source],appearance,width,height,warn);return{shape,...(text?{text}:{})};
}
