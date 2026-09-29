import type {DiagramRecognition} from './diagram-graph'
import type {RasterPixels} from './pattern-recovery'
/** Refine model boxes against flat colour regions. No source text is invented.
 * Photographs/ambiguous palettes simply keep the model proposal for rejection
 * by the independent rendered-image comparison. */
export function refineDiagramGeometry(input:DiagramRecognition,image:RasterPixels):DiagramRecognition{
 const d=structuredClone(input),{width:w,height:h,data}=image
 if(d.width!==w||d.height!==h)return d
 const paints=[...new Set(d.nodes.map(n=>n.fill.toLowerCase()))],colors=paints.map(s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16))),labels=new Int16Array(w*h).fill(-1),seen=new Uint8Array(w*h)
 for(let i=0;i<labels.length;i++){if(data[i*4+3]<200)continue;const ds=colors.map(c=>Math.hypot(...c.map((v,j)=>v-data[i*4+j]))),min=Math.min(...ds);if(min<50)labels[i]=ds.indexOf(min)}
 const regions:{x:number;y:number;width:number;height:number;fill:string;area:number}[]=[]
 for(let start=0;start<labels.length;start++){
  if(seen[start]||labels[start]<0)continue;seen[start]=1;const label=labels[start],pixels=[start],hist=new Map<string,number>();let x=w,y=h,right=0,bottom=0
  for(let at=0;at<pixels.length;at++){const i=pixels[at],px=i%w,py=Math.floor(i/w);x=Math.min(x,px);y=Math.min(y,py);right=Math.max(right,px);bottom=Math.max(bottom,py);const color='#'+[0,1,2].map(j=>data[i*4+j].toString(16).padStart(2,'0')).join('');hist.set(color,(hist.get(color)??0)+1);for(const k of [px?i-1:-1,px<w-1?i+1:-1,py?i-w:-1,py<h-1?i+w:-1])if(k>=0&&!seen[k]&&labels[k]===label){seen[k]=1;pixels.push(k)}}
  if(pixels.length>=100&&right-x>=12&&bottom-y>=12)regions.push({x,y,width:right-x+1,height:bottom-y+1,fill:[...hist].sort((a,b)=>b[1]-a[1])[0][0],area:pixels.length})
 }
 const previous=new Map(d.nodes.map(n=>[n.id,{...n.bounds}])),used=new Set<number>()
 for(const n of d.nodes){const b=n.bounds,candidates=regions.map((r,i)=>({r,i,cost:Math.hypot((r.x+r.width/2-b.x-b.width/2)/Math.max(r.width,b.width),(r.y+r.height/2-b.y-b.height/2)/Math.max(r.height,b.height))})).filter(c=>!used.has(c.i)&&c.cost<.8).sort((a,b)=>a.cost-b.cost);if(!candidates.length||candidates[1]?.cost-candidates[0].cost<.05)continue;const {r,i}=candidates[0];used.add(i);n.bounds={x:r.x,y:r.y,width:r.width,height:r.height};n.fill=r.fill;n.fontSize*=Math.min(r.width/b.width,r.height/b.height)}
 for(const e of d.edges){const a=d.nodes.find(n=>n.id===e.from.nodeId),b=d.nodes.find(n=>n.id===e.to.nodeId),pa=previous.get(e.from.nodeId),pb=previous.get(e.to.nodeId);if(!a||!b||!pa||!pb)continue
  const da={x:a.bounds.x+a.bounds.width*e.from.u-pa.x-pa.width*e.from.u,y:a.bounds.y+a.bounds.height*e.from.v-pa.y-pa.height*e.from.v},db={x:b.bounds.x+b.bounds.width*e.to.u-pb.x-pb.width*e.to.u,y:b.bounds.y+b.bounds.height*e.to.v-pb.y-pb.height*e.to.v}
  const total=e.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-e.points[i].x,p.y-e.points[i].y),0);let at=0
  e.points=e.points.map((p,i,points)=>{if(i)at+=Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y);const t=total?at/total:0;return {x:p.x+da.x*(1-t)+db.x*t,y:p.y+da.y*(1-t)+db.y*t}})
 }
 return d
}
