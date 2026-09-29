import {DIAGRAM as D} from './smart-art';
import {DRAWING as A} from './catalog';
import {child} from './appearance';

export class UnsupportedSmartArt extends Error {}
export interface DiagramPoint {id:string; type:string; text:string; source?:Element; children:DiagramPoint[]; parent?:DiagramPoint}
export interface LayoutInstance {
 data:DiagramPoint; name:string; points:DiagramPoint[]; algorithm:string; params:Map<string,string>;
 moveWith:string; styleLabel:string; shapeElement?:Element; shape:string; children:LayoutInstance[]; constraints:Element[]; rules:Element[];
}
const elements=(e:Element)=>Array.from(e.children).filter(c=>c.namespaceURI===D);
const tokens=(e:Element,k:string,fallback:string)=> (e.getAttribute(k)??fallback).trim().split(/\s+/);
export function diagramModel(model:Element):DiagramPoint {
 const points=new Map<string,DiagramPoint>();let length=0;
 for(const e of elements(child(model,'ptLst',D)??model).filter(e=>e.localName==='pt')){
  const id=e.getAttribute('modelId');if(!id||points.has(id))throw new Error('invalid-file');
  const text=Array.from(e.getElementsByTagNameNS(A,'p')).map(p=>Array.from(p.getElementsByTagNameNS(A,'t')).map(t=>t.textContent??'').join('')).join('\n');length+=text.length;
  points.set(id,{id,type:e.getAttribute('type')??'node',text,source:e,children:[]});
 }
 if(points.size>256||length>100000)throw new Error('security-limit');
 const edges=elements(child(model,'cxnLst',D)??model).filter(e=>e.localName==='cxn'&&e.getAttribute('type')==='parOf');
 if(edges.length>512)throw new Error('security-limit');
 const order=(e:Element)=>{const v=Number(e.getAttribute('srcOrd')??0);if(!Number.isInteger(v)||v<0||v>1000000)throw new Error('invalid-file');return v;};
 for(const e of edges)order(e);
 for(const e of edges.sort((a,b)=>order(a)-order(b))){
  const from=points.get(e.getAttribute('srcId')??''),to=points.get(e.getAttribute('destId')??'');
  if(!from||!to||to.parent||to===from)throw new Error('invalid-file');to.parent=from;from.children.push(to);
 }
 for(const p of points.values()){const seen=new Set<DiagramPoint>();let at:DiagramPoint|undefined=p;while(at){if(seen.has(at))throw new Error('invalid-file');seen.add(at);if(seen.size>33)throw new Error('security-limit');at=at.parent;}}
 for(const e of elements(child(model,'cxnLst',D)??model).filter(e=>e.localName==='cxn'&&e.getAttribute('type')==='presOf')){
  const from=points.get(e.getAttribute('srcId')??''),to=points.get(e.getAttribute('destId')??'');if(!from||!to||from===to)throw new Error('invalid-file');
  if(to.type!=='pres'||from.type==='pres')throw new UnsupportedSmartArt('presentation association');
  if(!to.text){to.text=from.text;const copy=to.source!.cloneNode(true) as Element,sourceText=child(from.source,'t',D);if(sourceText&&!child(copy,'t',D))copy.appendChild(sourceText.cloneNode(true));to.source=copy;}
 }
 const roots=[...points.values()].filter(p=>!p.parent);if(roots.length===1&&roots[0]!.type==='doc')return roots[0]!;
 const root:DiagramPoint={id:'$document',type:'doc',text:'',children:roots};for(const p of roots)p.parent=root;return root;
}
const descend=(p:DiagramPoint):DiagramPoint[]=>p.children.flatMap(c=>[c,...descend(c)]);
function axis(p:DiagramPoint,a:string):DiagramPoint[]{
 const siblings=p.parent?.children??[p],i=siblings.indexOf(p);
 switch(a){case 'self':return[p];case 'ch':return p.children;case 'des':return descend(p);case 'desOrSelf':return[p,...descend(p)];case 'par':return p.parent?[p.parent]:[];case 'root':{while(p.parent)p=p.parent;return[p];}case 'ancst':case 'ancstOrSelf':{const out:DiagramPoint[]=a==='ancstOrSelf'?[p]:[];while(p.parent){p=p.parent;out.push(p);}return out;}case 'followSib':return siblings.slice(i+1);case 'precedSib':return siblings.slice(0,i);case 'follow':case 'preced':{let root=p;while(root.parent)root=root.parent;const all=[root,...descend(root)],at=all.indexOf(p);return a==='follow'?all.slice(at+1):all.slice(0,at);}default:throw new UnsupportedSmartArt(`axis:${a}`);}
}
function select(e:Element,current:DiagramPoint):DiagramPoint[]{
 const axes=tokens(e,'axis','self'),types=tokens(e,'ptType','all'),starts=tokens(e,'st','1'),steps=tokens(e,'step','1'),counts=tokens(e,'cnt','0');
 let set=[current];
 for(let i=0;i<axes.length;i++){
  const type=types[i]??types[0]!,start=Number(starts[i]??starts[0]),step=Number(steps[i]??steps[0]),count=Number(counts[i]??counts[0]);
  if(!Number.isInteger(start)||start<1||!Number.isInteger(step)||step<1||!Number.isInteger(count)||count<0)throw new Error('invalid-file');
  if(!['all','node','doc','pres','parTrans','sibTrans','nonAsst','asst'].includes(type))throw new UnsupportedSmartArt(`point:${type}`);
  if(type==='nonAsst'||type==='asst')throw new UnsupportedSmartArt('assistant filtering');
  set=set.flatMap(p=>axis(p,axes[i]!).filter(p=>type==='all'||p.type===type).filter((_,j)=>j>=start-1&&(j-start+1)%step===0).slice(0,count||undefined));
  set=[...new Set(set)];if(set.length>256)throw new Error('security-limit');
 }
 if(['1','true'].includes(e.getAttribute('hideLastTrans')??'')){const last=set.at(-1);if(last&&['parTrans','sibTrans'].includes(last.type))set.pop();}
 return set;
}
interface Context {point:DiagramPoint; position:number; count:number; vars:Map<string,string>}
function condition(e:Element,c:Context):boolean {
 const fn=e.getAttribute('func')??'cnt',op=e.getAttribute('op')??'equ',expected=e.getAttribute('val')??'0';let actual:string|number;
 switch(fn){case 'cnt':actual=select(e,c.point).length;break;case 'pos':actual=c.position;break;case 'revPos':actual=c.count-c.position+1;break;case 'posEven':actual=c.position%2===0?1:0;break;case 'posOdd':actual=c.position%2;break;case 'depth':{let p=c.point;actual=0;while(p.parent){actual++;p=p.parent;}break;}case 'maxDepth':{const depth=(p:DiagramPoint):number=>p.children.length?1+Math.max(...p.children.map(depth)):0;actual=depth(c.point);break;}case 'var':actual=c.vars.get(e.getAttribute('arg')??'')??'';break;default:throw new UnsupportedSmartArt(`function:${fn}`);}
 if(op==='equ')return String(actual)===expected;if(op==='neq')return String(actual)!==expected;
 const a=Number(actual),b=Number(expected);if(!Number.isFinite(a)||!Number.isFinite(b))throw new UnsupportedSmartArt('non-numeric comparison');
 switch(op){case 'gt':return a>b;case 'gte':return a>=b;case 'lt':return a<b;case 'lte':return a<=b;default:throw new UnsupportedSmartArt(`operator:${op}`);}
}
/** Executes only data/DOM instructions, with a shared expansion budget. No source code evaluation. */
export function compileSmartArt(layout:Element,model:Element):LayoutInstance {
 const root=diagramModel(model),templates=new Map<string,Element>();let visits=0,instances=0;
 const source=Array.from(layout.getElementsByTagNameNS(D,'*'));if(source.length>4096)throw new Error('security-limit');
 for(const e of source)if(e.localName==='forEach'&&e.getAttribute('name')){const name=e.getAttribute('name')!;if(templates.has(name))throw new Error('invalid-file');templates.set(name,e);}
 const create=(e:Element,c:Context,depth:number,refs:Set<string>):LayoutInstance=>{
  if(++instances>512||depth>32)throw new Error('security-limit');
  const node:LayoutInstance={data:c.point,name:e.getAttribute('name')??'SmartArt layout',points:[],moveWith:e.getAttribute('moveWith')??'',styleLabel:e.getAttribute('styleLbl')??'',algorithm:'composite',params:new Map(),shape:'none',children:[],constraints:[],rules:[]};
  execute(e,node,{...c,vars:new Map(c.vars)},depth,refs);return node;
 };
 const execute=(e:Element,node:LayoutInstance,c:Context,depth:number,refs:Set<string>):void=>{
  if(++visits>8192||depth>32)throw new Error('security-limit');
  // Variables belong to this layout scope, independent of their XML position.
  for(const list of elements(e).filter(n=>n.localName==='varLst'))for(const v of elements(list))c.vars.set(v.localName,v.getAttribute('val')??'');
  for(const item of elements(e))switch(item.localName){
   case 'layoutNode':node.children.push(create(item,c,depth+1,refs));break;
   case 'forEach':{
    let body=item;const next=new Set(refs);
    while(body.getAttribute('ref')){const ref=body.getAttribute('ref')!;if(next.has(ref))throw new Error('invalid-file');next.add(ref);const target=templates.get(ref);if(!target)throw new Error('invalid-file');body=target;}
    const selected=select(item,c.point);selected.forEach((point,i)=>execute(body,node,{...c,point,position:i+1,count:selected.length,vars:new Map(c.vars)},depth+1,next));break;
   }
   case 'choose':{const branches=elements(item);let chosen:Element|undefined;for(const b of branches){if(b.localName==='else'){chosen=b;break;}if(b.localName!=='if')throw new UnsupportedSmartArt(b.localName);if(condition(b,c)){chosen=b;break;}}if(chosen)execute(chosen,node,c,depth+1,refs);break;}
   case 'presOf':node.points=select(item,c.point);break;
   case 'alg':node.algorithm=item.getAttribute('type')??'';node.params=new Map(elements(item).filter(p=>p.localName==='param').map(p=>[p.getAttribute('type')??'',p.getAttribute('val')??'']));break;
   case 'shape':if(elements(item).some(e=>e.localName!=='adjLst'))throw new UnsupportedSmartArt('shape instruction');node.shapeElement=item;node.shape=item.getAttribute('type')??'rect';if(item.getAttribute('blip')||item.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','blip'))throw new UnsupportedSmartArt('picture shape');break;
   case 'constrLst':node.constraints.push(...elements(item));break;
   case 'ruleLst':node.rules.push(...elements(item));break;
   case 'varLst':break;
   case 'extLst':if(item.children.length)throw new UnsupportedSmartArt('layout extension');break;
   default:throw new UnsupportedSmartArt(item.localName);
  }
 };
 const definition=child(layout,'layoutNode',D);if(!definition)throw new Error('invalid-file');
 return create(definition,{point:root,position:1,count:1,vars:new Map()},0,new Set());
}
