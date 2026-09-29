import type {PatternGeometry,PatternPrimitive} from './pattern-contract'
import {canonicalPrimitive,primitiveContains} from './pattern-geometry'

export type RasterPixels={width:number;height:number;data:Uint8ClampedArray|Uint8Array}
export type PatternRecovery={geometry:PatternGeometry|null;reason:string}
type Region={pixels:number[];x:number;y:number;width:number;height:number;label:number}
const hex=(v:number[])=>'#'+v.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')
const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])

/** Flat color segmentation plus analytic shape fitting, not contour tracing.
 * Complex content is retained intact when any meaningful fragment cannot fit. */
export function recoverPatternPixels(image:RasterPixels):PatternRecovery {
 const {width:w,height:h,data}=image,n=w*h,reject=(reason:string):PatternRecovery=>({geometry:null,reason})
 if(!Number.isSafeInteger(n)||Math.min(w,h)<24||Math.max(w,h)>768||data.length!==n*4)return reject('Размер изображения не поддерживается')
 const bins=new Map<string,{rgb:number[];count:number}>();let transparent=0
 for(let i=0;i<n;i++){
  if(data[i*4+3]<128){transparent++;continue}
  const rgb=[data[i*4],data[i*4+1],data[i*4+2]],key=rgb.map(v=>Math.round(v/16)).join(',');const b=bins.get(key)??{rgb:[0,0,0],count:0}
  b.rgb=b.rgb.map((v,j)=>v+rgb[j]);b.count++;bins.set(key,b)
 }
 const colors:number[][]=[]
 for(const b of [...bins.values()].sort((a,b)=>b.count-a.count)){
  if(b.count<Math.max(16,n*.002))continue
  const rgb=b.rgb.map(v=>v/b.count);if(colors.every(c=>distance(c,rgb)>30))colors.push(rgb)
 }
 if(!colors.length||colors.length>8)return reject('Сложная палитра: исходная графика сохранена')
 const labels=new Int16Array(n).fill(-2),border=new Map<number,number>();let unknown=0
 for(let i=0;i<n;i++){
  if(data[i*4+3]<128){labels[i]=-1;continue}
  const rgb=[data[i*4],data[i*4+1],data[i*4+2]],ds=colors.map(c=>distance(c,rgb)),label=ds.indexOf(Math.min(...ds));labels[i]=ds[label]<=38?label:-2
  if(labels[i]===-2)unknown++
  if(i<w||i>=n-w||i%w===0||i%w===w-1)border.set(label,(border.get(label)??0)+1)
 }
 if(unknown/n>.025)return reject('Есть градиенты или мелкие цветовые детали')
 const background=transparent/n>.015?-1:[...border].sort((a,b)=>b[1]-a[1])[0]?.[0]??-1
 const seen=new Uint8Array(n),regions:Region[]=[];let small=0,foreground=0
 for(let i=0;i<n;i++)if(labels[i]>=0&&labels[i]!==background)foreground++
 for(let start=0;start<n;start++){
  if(seen[start]||labels[start]<0||labels[start]===background)continue
  const pixels=[start],label=labels[start];seen[start]=1;let x=w,y=h,r=0,b=0
  for(let at=0;at<pixels.length;at++){
   const i=pixels[at],px=i%w,py=Math.floor(i/w);x=Math.min(x,px);y=Math.min(y,py);r=Math.max(r,px);b=Math.max(b,py)
   for(const next of [px>0?i-1:-1,px<w-1?i+1:-1,py>0?i-w:-1,py<h-1?i+w:-1])if(next>=0&&!seen[next]&&labels[next]===label){seen[next]=1;pixels.push(next)}
  }
  if(pixels.length<Math.max(12,n*.001)){small+=pixels.length;continue}
  regions.push({pixels,x,y,width:r-x+1,height:b-y+1,label})
  if(regions.length>128)return reject('Слишком много мелких деталей')
 }
 if(regions.length<3||small/Math.max(1,foreground)>.02)return reject('Не найдена целая композиция из простых деталей')
 const parts:PatternGeometry['parts']=[],instances:PatternGeometry['instances']=[]
 let difference=0,totalUnion=0,totalIntersection=0
 for(const region of regions){
  const fitted=fitRegion(region,labels,w)
  if(fitted.iou<.965)return reject('Есть фигура, которую нельзя точно восстановить примитивами')
  totalIntersection+=fitted.intersection;totalUnion+=fitted.union;difference+=fitted.union-fitted.intersection
  const canonical=canonicalPrimitive(fitted.primitive,region.width,region.height),rotation=((canonical.rotation+fitted.rotation)%360) as 0|90|180|270
  const signature=JSON.stringify(canonical.primitive)
  let part=parts.find(p=>JSON.stringify(p.primitive)===signature&&Math.abs(Math.log(p.aspect/(canonical.width/canonical.height)))<.035)
  if(!part){part={id:`part-${parts.length+1}`,primitive:canonical.primitive,aspect:canonical.width/canonical.height};parts.push(part)}
  const rw=canonical.width,rh=canonical.height
  instances.push({partId:part.id,x:region.x+(region.width-rw)/2,y:region.y+(region.height-rh)/2,width:rw,height:rh,color:hex(colors[region.label]),rotation})
 }
 if(parts.length>64||difference/Math.max(1,foreground)>.035)return reject('Восстановление теряет заметную часть рисунка')
 // Coordinates describe unrotated frames around their original centers.
 // Tall rotated pieces may extend beyond the image while their painted bounds fit.
 const geometry:PatternGeometry={width:w,height:h,background:background<0?null:hex(colors[background]),parts,instances,palette:[...new Set(instances.map(i=>i.color))],quality:{foregroundIou:totalIntersection/Math.max(1,totalUnion),pixelError:(difference+unknown+small)/n,paletteCoverage:1-unknown/n,smallFragmentRatio:small/Math.max(1,foreground)}}
 return {geometry,reason:''}
}

function fitRegion(region:Region,labels:Int16Array,imageWidth:number){
 const {width:w,height:h}=region,samples:Array<[number,number,boolean]>=[]
 for(let y=.5;y<40;y++)for(let x=.5;x<40;x++){const px=Math.min(w-1,Math.floor(x/40*w)),py=Math.min(h-1,Math.floor(y/40*h));samples.push([px+.5,py+.5,labels[(region.y+py)*imageWidth+region.x+px]===region.label])}
 const inside=(p:PatternPrimitive,rotation:number,x:number,y:number)=>{
  if(p.kind==='sector'){if(rotation===90)return primitiveContains(p,y,w-x,h,w);if(rotation===180)return primitiveContains(p,w-x,h-y,w,h);if(rotation===270)return primitiveContains(p,h-y,x,h,w)}
  return primitiveContains(p,x,y,w,h)
 }
 const score=(p:PatternPrimitive,rotation=0)=>{let intersection=0,union=0;for(const [x,y,actual] of samples){const predicted=inside(p,rotation,x,y);if(predicted||actual)union++;if(predicted&&actual)intersection++}return intersection/Math.max(1,union)}
 let best={primitive:{kind:'ellipse'} as PatternPrimitive,rotation:0 as 0|90|180|270,score:score({kind:'ellipse'})}
 const consider=(primitive:PatternPrimitive,rotation:0|90|180|270=0)=>{const s=score(primitive,rotation);if(s>best.score+1e-6)best={primitive,rotation,score:s}}
 for(const rotation of [0,90,180,270] as const)consider({kind:'sector',sweep:270},rotation)
 for(let mask=0;mask<16;mask++)for(let step=0;step<=20;step++){
  if(!mask&&step)break
  const corners=[0,1,2,3].map(i=>mask&(1<<i)?step/20:0) as [number,number,number,number]
  const r=corners.map(v=>v*Math.min(w,h));if(r[0]+r[1]>w||r[2]+r[3]>w||r[0]+r[3]>h||r[1]+r[2]>h)continue
  consider({kind:'rounded',corners})
 }
 if(best.primitive.kind==='rounded'){
  const corners=best.primitive.corners,base=Math.max(...corners)
  for(let s=-9;s<=9;s++){const radius=Math.round((base+s*.005)*1000)/1000;if(radius<0||radius>1)continue;const next=corners.map(v=>v?radius:0) as [number,number,number,number],r=next.map(v=>v*Math.min(w,h));if(r[0]+r[1]<=w&&r[2]+r[3]<=w&&r[0]+r[3]<=h&&r[1]+r[2]<=h)consider({kind:'rounded',corners:next})}
 }
 let intersection=0,union=0
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const actual=labels[(region.y+y)*imageWidth+region.x+x]===region.label,predicted=inside(best.primitive,best.rotation,x+.5,y+.5);if(actual||predicted)union++;if(actual&&predicted)intersection++}
 return {...best,intersection,union,iou:intersection/Math.max(1,union)}
}
