import type {BoundsIR,ElementIR,GroupElementIR} from '../../vendor/drag/src/core/model'
import type {SourceSnapshot} from '../digital-designer/source-types'
import type {ComponentLibrary} from './types'
import {readSourceScene,type SceneRecord} from './source-scene'
import {scaled} from '../slides/document'
import {flatten} from './compiler'

export type SlideMasterItem={id:string;name:string;sourceIds:string[];sourceParts:string[];assetIds:string[];bounds:BoundsIR;scene:{width:number;height:number;elements:ElementIR[]};edge:'top'|'bottom'}
export type SlideMasterStyle={id:string;name:string;slides:number[];width:number;height:number;items:SlideMasterItem[]}
const identity={rotation:0,opacity:1,visible:true,zIndex:0}
function appearance(value:unknown):unknown{
 if(typeof value==='number')return Math.round(value*1e5)/1e5
 if(Array.isArray(value))return value.map(appearance)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['id','name','sourceIds','sourceParts','sourceRef','zIndex'].includes(k)).map(([k,v])=>[k,appearance(v)]))
 return value
}
const overlaps=(a:BoundsIR,b:BoundsIR)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)

/** Observed inherited branding is fixed slide chrome, not editable content or
 * a free-standing pattern. No deck names, wordmark text or slide IDs are used. */
export function buildSlideMasters(snapshot:SourceSnapshot,library:ComponentLibrary):SlideMasterStyle[]{
 const scene=readSourceScene(snapshot),order=new Map<string,number>(),masters:SlideMasterStyle[]=[],keys=new Map<string,SlideMasterStyle>()
 const visit=(nodes:ElementIR[])=>{for(const e of [...nodes].sort((a,b)=>a.zIndex-b.zIndex)){order.set(e.id,order.size);if('children'in e)visit(e.children)}}
 visit(scene.roots)
 const ref=(r:SceneRecord)=>[r.element,...[...r.ancestors].reverse().map(id=>scene.records.get(id)!.element)].find(e=>e.sourceRef)?.sourceRef
 const inherited=(r:SceneRecord)=>/^ppt\/(slideMasters|slideLayouts)\//.test(ref(r)?.part??'')
 const branch=(r:SceneRecord)=>{let node=structuredClone(r.element);for(const id of [...r.ancestors].reverse())node={...structuredClone(scene.records.get(id)!.element),children:[node]} as GroupElementIR;return node}
 for(const slide of snapshot.slides){
  const items:SlideMasterItem[]=[],covered=new Set<string>()
  for(const c of library.components.filter(c=>c.source.slide===slide.number&&c.semantics.some(s=>s.role==='logo')).sort((a,b)=>b.source.elementIds.length-a.source.elementIds.length)){
   let root=scene.records.get(c.source.rootId)
   // A logo's wordmark and glyph are often separate pictures in one compact
   // inherited group. Preserve that source group, not just its labelled leaf.
   for(const id of [...root?.ancestors??[]].reverse()){
    const parent=scene.records.get(id)!,b=parent.bounds
    if(!inherited(parent)||parent.disposition!=='visible'||b.y<slide.height*.75||b.width>slide.width*.35||b.height>slide.height*.12)break
    root=parent
   }
   const records=root?flatten([root.element]).flatMap(e=>scene.records.get(e.id)??[]):c.source.elementIds.flatMap(id=>scene.records.get(id)??[]),viewport=c.scene.elements.find(e=>e.id===c.source.rootId)
   const bounds=root?.bounds??(viewport?.kind==='group'&&!viewport.rotation?{x:-viewport.bounds.x,y:-viewport.bounds.y,width:c.scene.width,height:c.scene.height}:null)
   if(!bounds||!records.length||records.some(r=>r.disposition!=='visible'||!inherited(r))||records.every(r=>covered.has(r.element.id))||c.issues.some(i=>i.severity==='blocking'))continue
   const edge=bounds.y+bounds.height<=slide.height*.25?'top':bounds.y>=slide.height*.75?'bottom':null
   if(edge!=='bottom'||bounds.width>slide.width*.65||bounds.height>slide.height*.22)continue
   const last=Math.max(...records.map(r=>order.get(r.element.id)??0))
   // Rectangular masks in the observed layout can cover an old master logo.
   // Keep partial/translucent masks clipped to the logo, never a large panel
   // that would cover new content when the master is reused.
   const masks=[...scene.records.values()].filter(r=>r.source.slide===slide.number&&r.disposition==='visible'&&(order.get(r.element.id)??0)>last&&r.element.kind==='rectangle'&&r.element.fill&&overlaps(bounds,r.bounds)&&Math.abs(r.matrix[1])+Math.abs(r.matrix[2])<1e-8)
   const opaque=(r:SceneRecord)=>r.element.kind==='rectangle'&&r.element.fill?.color.a===1&&!r.element.gradient&&!r.element.pattern&&!r.element.blur&&!r.element.effects?.length&&[r.element,...r.ancestors.map(id=>scene.records.get(id)!.element)].every(e=>e.opacity===1&&!e.blur&&!e.effects?.length)
   if(masks.some(r=>opaque(r)&&r.bounds.x<=bounds.x+.01&&r.bounds.y<=bounds.y+.01&&r.bounds.x+r.bounds.width>=bounds.x+bounds.width-.01&&r.bounds.y+r.bounds.height>=bounds.y+bounds.height-.01))continue
   const frame={x:0,y:0,width:bounds.width,height:bounds.height},offset={...frame,x:-bounds.x,y:-bounds.y}
   const source:ElementIR[]=root?[{...identity,id:`master-source-${c.id}`,name:c.name,kind:'group',bounds:offset,children:[branch(root)]}]:structuredClone(c.scene.elements)
   const overlays=masks.filter(inherited).map((r,i):ElementIR=>({...identity,id:`master-mask-${r.element.id}`,name:'Source mask',kind:'group',zIndex:1000+i,bounds:offset,children:[branch(r)]}))
   const elements:ElementIR[]=[{...identity,id:`master-crop-${c.id}`,name:c.name,kind:'group',clipsContent:true,bounds:frame,children:[...source,...overlays]}]
   items.push({id:c.id,name:c.name,sourceIds:records.map(r=>r.element.id),sourceParts:[...new Set(records.map(r=>ref(r)!.part))],assetIds:[...new Set(flatten(elements).filter(e=>e.kind==='raster').map(e=>e.assetId))],bounds:{...bounds},scene:{width:bounds.width,height:bounds.height,elements},edge})
   records.forEach(r=>covered.add(r.element.id))
  }
  if(!items.length)continue
  items.sort((a,b)=>Math.min(...a.sourceIds.map(id=>order.get(id)??0))-Math.min(...b.sourceIds.map(id=>order.get(id)??0)))
  const key=JSON.stringify(appearance({width:slide.width,height:slide.height,items})),existing=keys.get(key)
  if(existing){existing.slides.push(slide.number);continue}
  const edges=new Set(items.map(i=>i.edge)),name=edges.size===2?'Шапка и подвал':edges.has('bottom')?'Подвал с логотипами':'Шапка с логотипами'
  const master={id:`master-${slide.id}`,name,slides:[slide.number],width:slide.width,height:slide.height,items}
  masters.push(master);keys.set(key,master)
 }
 // One default footer per library. Frequency is measured from equal rendered
 // appearances and positions; ties keep source order. No user variant editor.
 return masters.sort((a,b)=>b.slides.length-a.slides.length||a.slides[0]-b.slides[0]).slice(0,1).map(m=>({...m,name:'Фирменный подвал'}))
}

export function masterItemBounds(master:SlideMasterStyle,item:SlideMasterItem,size:{width:number;height:number}):BoundsIR{
 const k=Math.min(size.width/master.width,size.height/master.height),b=item.bounds
 const anchor=(start:number,extent:number,source:number,target:number)=>{
  const after=source-start-extent
  if(start<=after&&start<source*.15)return start*k
  if(after<start&&after<source*.15)return target-(extent+after)*k
  return (start+extent/2)/source*target-extent*k/2
 }
 return {x:anchor(b.x,b.width,master.width,size.width),y:anchor(b.y,b.height,master.height,size.height),width:item.scene.width*k,height:item.scene.height*k}
}
export function assembleSlideMaster(master:SlideMasterStyle,size:{width:number;height:number}):ElementIR[]{
 if(![size.width,size.height].every(v=>Number.isFinite(v)&&v>=32&&v<=8000))throw Error('Недопустимый размер оформления слайда')
 const k=Math.min(size.width/master.width,size.height/master.height)
 return master.items.map((item,index)=>({...identity,id:`slide-master-${index}`,name:item.name,kind:'group',zIndex:index,bounds:masterItemBounds(master,item,size),children:scaled(item.scene.elements,k,`master-${index}`)}))
}
export function masterContentArea(master:SlideMasterStyle,size={width:1920,height:1080}){
 const k=Math.min(size.width/master.width,size.height/master.height),gap=16*k
 let top=48,bottom=size.height-48
 for(const item of master.items){const b=masterItemBounds(master,item,size);if(item.edge==='top')top=Math.max(top,b.y+b.height+gap);else bottom=Math.min(bottom,b.y-gap)}
 return {x:48,y:top,w:size.width-96,h:Math.max(0,bottom-top)}
}
