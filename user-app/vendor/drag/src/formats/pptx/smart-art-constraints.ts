import {UnsupportedSmartArt,type LayoutInstance} from './smart-art-program';
import type {BoundsIR} from '../../core/model';
export type DiagramBox=BoundsIR&{font:number;rotation:number};
export interface PlacedDiagram {layout:LayoutInstance;box:DiagramBox;children:PlacedDiagram[];parent?:PlacedDiagram;locked:Set<string>}
const fail=(s:string):never=>{throw new UnsupportedSmartArt(s);};
export const diagramNumber=(s:string|null,fallback:number)=>{const n=s===null?fallback:Number(s);if(!Number.isFinite(n)||Math.abs(n)>1e7)throw new Error('invalid-file');return n;};
const walk=(n:PlacedDiagram):PlacedDiagram[]=>n.children.flatMap(c=>[c,...walk(c)]);
export function diagramTargets(node:PlacedDiagram,selector:string,name:string,type='all'):PlacedDiagram[]{
 let list:PlacedDiagram[];switch(selector){case 'self':list=[node];break;case 'ch':list=node.children;break;case 'des':list=walk(node);break;default:return fail(`constraint selector:${selector}`);}
 return list.filter(n=>(!name||n.layout.name===name)&&(type==='all'||n.layout.points.some(p=>p.type===type)));
}
const read=(b:DiagramBox,t:string):number=>{switch(t){case 'w':return b.width;case 'h':return b.height;case 'l':return b.x;case 't':return b.y;case 'primFontSz':case 'secFontSz':return b.font;default:return fail(`constraint:${t}`);}};
const write=(b:DiagramBox,t:string,v:number):void=>{switch(t){case 'w':b.width=v;break;case 'h':b.height=v;break;case 'l':b.x=v;break;case 't':b.y=v;break;case 'primFontSz':case 'secFontSz':b.font=v;break;default:fail(`constraint:${t}`);}};
const derived:Record<string,[string,string,number]>={r:['l','w',1],b:['t','h',1],ctrX:['l','w',.5],ctrY:['t','h',.5]};
interface Assignment {element:Element;ref?:PlacedDiagram;type:string;scope:PlacedDiagram}
/** One dependency graph spans the complete instantiated layout, including named descendants. */
export function solveDiagramConstraints(root:PlacedDiagram):void {
 const nodes=[root,...walk(root)],assignments=new Map<PlacedDiagram,Map<string,Assignment[]>>(),initial=new Map(nodes.map(n=>[n,{...n.box}]));
 let operations=0;
 for(const scope of nodes)for(const e of scope.layout.constraints){
  const type=e.getAttribute('type')??'',op=e.getAttribute('op')??'equ';if(!['equ','gte','lte'].includes(op))fail('constraint operator');
  const selected=diagramTargets(scope,e.getAttribute('for')??'self',e.getAttribute('forName')??'',e.getAttribute('ptType')??'all');
  const refs=diagramTargets(scope,e.getAttribute('refFor')??'self',e.getAttribute('refForName')??'',e.getAttribute('refPtType')??'all');
  if(e.getAttribute('forName')&&!selected.length)fail('missing constraint target');
  selected.forEach(target=>{
   let ref:PlacedDiagram|undefined;const refType=e.getAttribute('refType');
   if(refType&&refType!=='none'){
    if(refs.length===1)ref=refs[0];else{const same=refs.filter(n=>n.layout.data===target.layout.data);if(same.length===1)ref=same[0];else fail('ambiguous constraint reference');}
    if(!ref)fail('missing constraint reference');
   }
   const key=derived[type]?.[0]??type,props=assignments.get(target)??new Map(),list=props.get(key)??[];
   list.push({element:e,type,scope,...(ref?{ref}:{})});props.set(key,list);assignments.set(target,props);target.locked.add(key);
   if(++operations>4096)throw new Error('security-limit');
  });
 }
 const active=new Map<PlacedDiagram,Set<string>>(),done=new Map<PlacedDiagram,Map<string,number>>();
 const absolute=(node:PlacedDiagram|undefined,type:string):number=>node?resolve(node,type)+absolute(node.parent,type):0;
 const resolve=(node:PlacedDiagram,type:string):number=>{
  if(++operations>100000)throw new Error('security-limit');
  const d=derived[type];if(d)return resolve(node,d[0])+resolve(node,d[1])*d[2];
  const cached=done.get(node)?.get(type);if(cached!==undefined)return cached;
  const list=assignments.get(node)?.get(type);if(!list)return read(initial.get(node)!,type);
  const stack=active.get(node)??new Set();if(stack.has(type))fail('cyclic constraints');stack.add(type);active.set(node,stack);
  let equality:number|undefined,lo=-Infinity,hi=Infinity;
  for(const a of list){
   const e=a.element,refType=e.getAttribute('refType');let value:number;
   if(a.ref&&refType){value=resolve(a.ref,refType)*diagramNumber(e.getAttribute('fact'),1);
    // Position references are expressed in the target parent's coordinate space.
    const axis=['l','r','ctrX'].includes(refType)?'l':['t','b','ctrY'].includes(refType)?'t':undefined;
    if(axis&&['l','t','r','b','ctrX','ctrY'].includes(a.type))value+=absolute(a.ref.parent,axis)-absolute(node.parent,axis);
    if(e.hasAttribute('val')&&diagramNumber(e.getAttribute('val'),0)!==0)fail('mixed literal/reference constraint');
   }else value=diagramNumber(e.getAttribute('val'),0);
   const targetDerived=derived[a.type];if(targetDerived)value-=resolve(node,targetDerived[1])*targetDerived[2];
   switch(e.getAttribute('op')??'equ'){case 'equ':if(equality!==undefined&&Math.abs(equality-value)>1e-6)fail('conflicting equalities');equality=value;break;case 'gte':lo=Math.max(lo,value);break;case 'lte':hi=Math.min(hi,value);break;}
  }
  if(lo>hi+1e-6||equality!==undefined&&(equality<lo-1e-6||equality>hi+1e-6))fail('inconsistent bounds');
  const value=equality??Math.max(lo,Math.min(hi,read(initial.get(node)!,type)));if(!Number.isFinite(value))fail('nonfinite constraint');
  stack.delete(type);const cache=done.get(node)??new Map();cache.set(type,value);done.set(node,cache);return value;
 };
 // Resolve everything before mutating any boxes, so XML declaration order cannot leak in.
 for(const [node,props]of assignments)for(const type of props.keys())resolve(node,type);
 for(const [node,props]of done)for(const [type,value]of props)write(node.box,type,value);
 for(const scope of nodes)for(const e of scope.layout.rules){
  const type=e.getAttribute('type')??'';if(!['primFontSz','secFontSz','w','h'].includes(type))fail(`rule:${type}`);
  for(const target of diagramTargets(scope,e.getAttribute('for')??'self',e.getAttribute('forName')??'',e.getAttribute('ptType')??'all')){
   const value=read(target.box,type),minimum=diagramNumber(e.getAttribute('min'),0),maximum=diagramNumber(e.getAttribute('max'),1e7);if(minimum>maximum)throw new Error('invalid-file');
   // Font rules provide a lower fallback limit; shrink only if the text overflows.
   let candidate=value;
   if(type==='primFontSz'||type==='secFontSz'){
    const text=target.layout.points.map(p=>p.text).join('\n'),fits=(size:number)=>text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length*size*.55/Math.max(1,target.box.width))),0)*size*1.2<=target.box.height;
    const floor=Math.max(minimum,e.hasAttribute('fact')?value*diagramNumber(e.getAttribute('fact'),1):diagramNumber(e.getAttribute('val'),1));
    if(!fits(value)){let lo=Math.min(value,floor),hi=value;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(fits(mid))lo=mid;else hi=mid;}candidate=lo;}
   }else if(e.hasAttribute('fact')||e.hasAttribute('val'))fail('dimension relaxation rule');
   write(target.box,type,Math.max(minimum,Math.min(maximum,candidate)));
  }
 }
 for(const node of nodes){const b=node.box;if(![b.x,b.y,b.width,b.height,b.font].every(Number.isFinite)||b.width<=0||b.height<=0||Math.max(Math.abs(b.x),Math.abs(b.y),b.width,b.height)>1e6)fail('unsatisfiable dimensions');}
}
