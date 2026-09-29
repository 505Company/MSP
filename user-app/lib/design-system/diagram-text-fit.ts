import type {DiagramGraph} from './diagram-graph'
import type {TextElementIR} from '../../vendor/drag/src/core/model'
import {renderTextSvg} from '../../vendor/drag/src/formats/pptx/preview'
import {ensureSceneFonts} from '../../browser/fonts'
/** Optical calibration is restricted to the recognised letters (case and line
 * breaks) and fonts supplied by this design system. It cannot invent wording. */
export async function fitDiagramText(graph:DiagramGraph,image:ImageData,fonts:string[]){
 if(graph.origin!=='reconstructed'||image.width!==graph.width||image.height!==graph.height)return []
 const changes:{nodeId:string;sourceTextId:string;elements:TextElementIR[]}[]=[]
 for(const node of graph.nodes){
  const text=node.elements.find((e):e is TextElementIR=>e.kind==='text');if(!text?.text)continue
  const lines=text.text.replaceAll('\\n','\n').split('\n'),b=node.bounds,c=text.colorRuns?.[0]?.fill.color;if(!c)continue
  const ink=[c.r*255,c.g*255,c.b*255],rows:number[]=[],points:{x:number;y:number}[]=[]
  const left=Math.ceil(b.x+3),top=Math.ceil(b.y+2),right=Math.floor(b.x+b.width-3),bottom=Math.floor(b.y+b.height-2)
  for(let y=top;y<bottom;y++){let count=0;for(let x=left;x<right;x++){const i=(y*image.width+x)*4;if(image.data[i+3]>220&&Math.hypot(...ink.map((v,j)=>v-image.data[i+j]))<95){points.push({x,y});count++}}if(count)rows.push(y)}
  const bands:{top:number;bottom:number}[]=[];for(const y of rows){const last=bands.at(-1);if(last&&y-last.bottom<=2)last.bottom=y;else bands.push({top:y,bottom:y})}
  if(bands.length!==lines.length)continue
  const elements:TextElementIR[]=[]
  for(const [index,line] of lines.entries()){
   const band=bands[index],pixels=points.filter(p=>p.y>=band.top&&p.y<=band.bottom),x1=Math.min(...pixels.map(p=>p.x)),x2=Math.max(...pixels.map(p=>p.x)),targetW=x2-x1+1,targetH=band.bottom-band.top+1
   const candidates=[...new Set([line,line.toLowerCase(),line.charAt(0).toUpperCase()+line.slice(1).toLowerCase(),line.toUpperCase()])],families=[...new Set([text.fontFamily,...fonts])].slice(0,8)
   let best:{score:number;text:string;font:string;size:number;bold:boolean}|undefined
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(b.width);canvas.height=Math.ceil(b.height);const ctx=canvas.getContext('2d',{willReadFrequently:true})!
   for(const font of families)for(const bold of [false,true]){
    const probe:TextElementIR={...text,fontFamily:font,fontStyle:bold?'Bold':'Regular',styleRuns:[]};if((await ensureSceneFonts([probe])).length)continue
    for(const value of candidates){ctx.font=`${bold?'bold ':''}20px "${font}"`;const m=ctx.measureText(value),factor=targetH/(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent),estimate=20*factor
     for(const delta of [-.6,-.3,0,.3,.6]){const size=estimate+delta;if(size<5||size>200)continue;ctx.font=`${bold?'bold ':''}${size}px "${font}"`;const measure=ctx.measureText(value);if(Math.abs(measure.actualBoundingBoxLeft+measure.actualBoundingBoxRight-targetW)>Math.max(3,targetW*.1))continue
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';const ox=x1-b.x+measure.actualBoundingBoxLeft,oy=band.top-b.y+measure.actualBoundingBoxAscent;ctx.fillText(value,ox,oy);const actual=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let error=0,union=0;for(let py=Math.max(0,Math.floor(band.top-b.y-1));py<Math.min(canvas.height,Math.ceil(band.bottom-b.y+2));py++)for(let px=0;px<canvas.width;px++){
       const sx=Math.round(b.x)+px,sy=Math.round(b.y)+py,si=(sy*image.width+sx)*4,expected=image.data[si+3]>220&&Math.hypot(...ink.map((v,j)=>v-image.data[si+j]))<95?1:0,predicted=actual[(py*canvas.width+px)*4+3]/255;error+=Math.abs(expected-predicted);union+=Math.max(expected,predicted)
      }
      const score=error/Math.max(1,union);if(!best||score<best.score)best={score,text:value,font,size,bold}
     }
    }
   }
   if(!best||best.score>.5){elements.length=0;break}
   const e:TextElementIR={...text,id:`${text.id}-line-${index}`,text:best.text,fontFamily:best.font,fontStyle:best.bold?'Bold':'Regular',fontSize:best.size,bounds:{x:0,y:0,width:Math.max(1,b.width-4),height:Math.max(best.size*1.5,targetH+3)},styleRuns:[],paragraphs:undefined,colorRuns:[{start:0,end:best.text.length,fill:{type:'solid',color:c}}],textBox:{align:'LEFT',vertical:'TOP',wrap:false}}
   const rendered=await renderTextSvg(e);e.bounds.x=x1-b.x-rendered.ink.left;e.bounds.y=band.top-b.y-rendered.ink.top;elements.push(e)
  }
  if(elements.length===lines.length)changes.push({nodeId:node.id,sourceTextId:text.id,elements})
 }
 return changes
}
