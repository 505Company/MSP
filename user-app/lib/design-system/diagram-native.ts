import type {ElementIR,BoundsIR} from '../../vendor/drag/src/core/model'
import type {SourceScene} from './source-scene'
import type {DiagramGraph,DiagramNode,DiagramEdge,GraphPort} from './diagram-graph'
import {validateGraph} from './diagram-graph'
import {flatten} from './compiler'
const contains=(a:BoundsIR,b:BoundsIR)=>a.x<=b.x+.1&&a.y<=b.y+.1&&a.x+a.width>=b.x+b.width-.1&&a.y+a.height>=b.y+b.height-.1
const hex=(c:{r:number;g:number;b:number})=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)
const polyline=(e:ElementIR)=>e.kind==='path'&&e.stroke&&!e.fill&&/^M\s*[\d.e+\-]+[ ,]+[\d.e+\-]+(?:\s*L\s*[\d.e+\-]+[ ,]+[\d.e+\-]+)+\s*$/.test(e.pathData??'')
/** Infer attachment only for readable native straight/orthogonal connectors.
 * Unsupported transforms are retained, never silently flattened. */
export function nativeDiagramGraph(scene:SourceScene,sourceIds:string[]):DiagramGraph|null{
 const selected=new Set(sourceIds),members=[...scene.records.values()].filter(r=>r.disposition==='visible'&&(selected.has(r.element.id)||r.ancestors.some(id=>selected.has(id))))
 const roots=members.filter(r=>!r.ancestors.some(id=>members.some(m=>m.element.id===id)))
 const connectorIds=new Set(roots.filter(r=>flatten([r.element]).some(polyline)&&!flatten([r.element]).some(e=>e.kind==='text'||'fill'in e&&e.fill&&e.bounds.width>20&&e.bounds.height>20)).flatMap(r=>flatten([r.element]).map(e=>e.id)))
 if(!roots.length||members.some(r=>!connectorIds.has(r.element.id)&&(r.element.rotation||r.element.centeredTransform?.flipH||r.element.centeredTransform?.flipV)||r.element.blur||r.element.effects?.length||('gradient' in r.element&&r.element.gradient)||('pattern' in r.element&&r.element.pattern)||('clipBounds' in r.element&&r.element.clipBounds)||('children' in r.element&&(r.element.clipPathData||(r.element.clipsContent||r.element.opacity!==1)&&flatten([r.element]).some(e=>e.kind==='text')))))return null
 const x=Math.min(...roots.map(r=>r.bounds.x)),y=Math.min(...roots.map(r=>r.bounds.y)),width=Math.max(...roots.map(r=>r.bounds.x+r.bounds.width))-x,height=Math.max(...roots.map(r=>r.bounds.y+r.bounds.height))-y
 const local=(e:ElementIR,b:BoundsIR)=>{const r=scene.records.get(e.id)!,m=r.matrix,cx=m[0]*e.bounds.width/2+m[2]*e.bounds.height/2+m[4],cy=m[1]*e.bounds.width/2+m[3]*e.bounds.height/2+m[5];return {...structuredClone(e),bounds:e.rotation||e.centeredTransform?.flipH||e.centeredTransform?.flipV?{x:cx-e.bounds.width/2-x,y:cy-e.bounds.height/2-y,width:e.bounds.width,height:e.bounds.height}:{...b,x:b.x-x,y:b.y-y}}}
 const nodes:DiagramNode[]=[],edgeRoots:typeof roots=[],extras:typeof roots=[]
 for(const r of roots){
  const leaves=flatten([r.element]).filter(e=>!('children' in e)),body=leaves.filter(e=>['rectangle','ellipse','path'].includes(e.kind)&&'fill' in e&&e.fill&&(e.bounds.width>20&&e.bounds.height>20))
  const line=leaves.find(polyline)
  if(body.length&&r.bounds.width>20&&r.bounds.height>20){const e=local(r.element,r.bounds);nodes.push({id:r.element.id,kind:'block',bounds:e.bounds,elements:[{...e,bounds:{...e.bounds,x:0,y:0}}],sourceIds:flatten([e]).map(e=>e.id)})}
  else if(line)edgeRoots.push(r)
  else extras.push(r)
 }
 if(nodes.length<2||!edgeRoots.length)return null
 for(const r of extras){const n=nodes.filter(n=>contains(n.bounds,{...r.bounds,x:r.bounds.x-x,y:r.bounds.y-y})).sort((a,b)=>a.bounds.width*a.bounds.height-b.bounds.width*b.bounds.height)[0];if(!n)return null;const e=local(r.element,r.bounds);e.bounds.x-=n.bounds.x;e.bounds.y-=n.bounds.y;n.elements.push(e);n.sourceIds.push(...flatten([e]).map(e=>e.id))}
 const segments=edgeRoots.flatMap(r=>{
  const leaves=flatten([r.element]),line=leaves.find(polyline)!,lr=scene.records.get(line.id)!,m=lr.matrix
  const coordinates=line.kind==='path'?line.pathData!.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)!.map(Number):[]
  const points=Array.from({length:coordinates.length/2},(_,i)=>{const a=coordinates[i*2],b=coordinates[i*2+1];return {x:m[0]*a+m[2]*b+m[4]-x,y:m[1]*a+m[3]*b+m[5]-y}})
  const head=leaves.find(e=>e.name==='Arrowhead'),hb=head?scene.records.get(head.id)!.bounds:null,center=hb?{x:hb.x-x+hb.width/2,y:hb.y-y+hb.height/2}:null
  const arrow=!center?'none':dist(center,points[0])<dist(center,points.at(-1)!)?'start':'end'
  return points.slice(1).map((p,i)=>({r,part:i,whole:points.length===2,points:[points[i],p],line,arrow:arrow==='start'&&i===0?'start' as const:arrow==='end'&&i===points.length-2?'end' as const:'none' as const}))
 })
 const tolerance=Math.max(3,Math.min(width,height)*.008),junctions:{x:number;y:number}[]=[]
 const projection=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{const dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);return {t,x:a.x+t*dx,y:a.y+t*dy}}
 for(const a of segments)for(const p of a.points)for(const b of segments)if(a!==b){const q=projection(p,b.points[0],b.points[1]);if(q.t>=-.001&&q.t<=1.001&&dist(p,q)<=tolerance&&!junctions.some(j=>dist(j,q)<=tolerance))junctions.push({x:q.x,y:q.y})}
 for(const [i,p] of junctions.entries())nodes.push({id:`junction-${i}`,kind:'junction',bounds:{...p,width:0,height:0},elements:[],sourceIds:[]})
 const attach=(p:{x:number;y:number}):GraphPort|null=>{
  const j=nodes.find(n=>n.kind==='junction'&&dist(n.bounds,p)<=tolerance);if(j)return {nodeId:j.id,u:0,v:0,dx:p.x-j.bounds.x,dy:p.y-j.bounds.y}
  const near=nodes.filter(n=>n.kind==='block').flatMap(n=>{
   const b=n.bounds,ports=[{u:0,v:Math.max(0,Math.min(1,(p.y-b.y)/b.height))},{u:1,v:Math.max(0,Math.min(1,(p.y-b.y)/b.height))},{v:0,u:Math.max(0,Math.min(1,(p.x-b.x)/b.width))},{v:1,u:Math.max(0,Math.min(1,(p.x-b.x)/b.width))}]
   return ports.map(port=>{const q={x:b.x+port.u*b.width,y:b.y+port.v*b.height};return {distance:dist(p,q),port:{nodeId:n.id,...port,dx:p.x-q.x,dy:p.y-q.y}}})
  }).sort((a,b)=>a.distance-b.distance)
  if(!near.length||near[0].distance>Math.min(35,width*.035))return null
  // Comparable distances to two different blocks would be an ambiguous attachment.
  if(near.some(a=>a.port.nodeId!==near[0].port.nodeId&&Math.abs(a.distance-near[0].distance)<1))return null
  return near[0].port
 }
 const edges:DiagramEdge[]=[]
 for(const s of segments){
  const cuts=[{...s.points[0],t:0},...junctions.map(p=>projection(p,s.points[0],s.points[1])).filter(p=>p.t>.001&&p.t<.999&&junctions.some(j=>dist(j,p)<=tolerance)),{...s.points[1],t:1}].sort((a,b)=>a.t-b.t).filter((p,i,a)=>!i||dist(p,a[i-1])>.01)
  for(let i=1;i<cuts.length;i++){
   const a=cuts[i-1],b=cuts[i],from=attach(a),to=attach(b);if(!from||!to)return null;if(from.nodeId===to.nodeId){if(dist(a,b)<=tolerance)continue;return null}
   const stroke='stroke' in s.line?s.line.stroke:undefined;if(!stroke)return null
   edges.push({id:s.r.element.id+`-edge-${s.part}-${i}`,from,to,points:[{x:a.x,y:a.y},{x:b.x,y:b.y}],arrow:s.arrow==='start'&&i===1?'start':s.arrow==='end'&&i===cuts.length-1?'end':'none',color:hex(stroke.paint.color),width:stroke.width,sourceIds:flatten([s.r.element]).map(e=>e.id),...(s.whole&&cuts.length===2?{original:[local(s.r.element,s.r.bounds)]}:{})})
  }
 }
 const slide=scene.slides.find(s=>s.number===roots[0].source.slide)
 const background=[...scene.records.values()].find(r=>r.source.slide===slide?.number&&!r.ancestors.length&&r.disposition==='visible'&&r.element.name==='Slide background'&&r.element.kind==='rectangle'&&!r.element.gradient&&!r.element.pattern&&r.element.fill?.color.a===1&&r.element.opacity===1&&Math.abs(r.bounds.x)<.5&&Math.abs(r.bounds.y)<.5&&Math.abs(r.bounds.width-slide!.width)<.5&&Math.abs(r.bounds.height-slide!.height)<.5)?.element
 const sourceSurface=background&&'fill'in background&&background.fill?hex(background.fill.color):undefined
 try{return validateGraph({width,height,...(sourceSurface?{sourceSurface}:{}),nodes,edges,origin:'native',sourceIds:[...new Set(members.map(r=>r.element.id))],warnings:['Присоединения восстановлены по геометрии; исходные линии сохранены.'],decoration:[],sourceElements:roots.map(r=>local(r.element,r.bounds))})}catch{return null}
}
