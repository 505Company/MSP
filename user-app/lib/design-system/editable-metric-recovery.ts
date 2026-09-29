import type {TextElementIR} from '../../vendor/drag/src/core/model'
import type {EditableData,EditableStyle} from './editable-contract'
import type {SceneRecord} from './source-scene'
import {area} from './editable-structure'

/** Recognised digits sometimes exist as a separate transparent image. Use
 * their real frame, never the whole card/photo, and require browser pixel
 * qualification before publishing the replacement. No OCR guesses are made. */
export function recoverMetricText(members:SceneRecord[],data:EditableData,style:EditableStyle,width:number,height:number,x:number,y:number,uploadId:string){
 const value=String(data.value??'')+String(data.unit??'')
 if(!/^[+−–\-]?\d[\d\s.,/%]*$/.test(value.trim())||value.length>24)return null
 const texts=members.filter(r=>r.element.kind==='text'),candidates=members.filter(r=>r.element.kind==='raster'&&r.bounds.height>20&&area(r.bounds)<width*height*.45&&texts.every(t=>!intersects(r,t)))
 if(candidates.length!==1)return null
 const r=candidates[0],e=r.element;if(e.kind!=='raster')return null
 const size=r.bounds.height*1.15,font=style.headingFont??style.font??'Arial',ink=style.accent??style.color??'#0077ff'
 const color={r:parseInt(ink.slice(1,3),16)/255,g:parseInt(ink.slice(3,5),16)/255,b:parseInt(ink.slice(5,7),16)/255,a:1}
 const element:TextElementIR={id:e.id,name:'Recognised numeric value',kind:'text',bounds:{...r.bounds,x:r.bounds.x-x,y:r.bounds.y-y},rotation:0,opacity:1,visible:true,zIndex:e.zIndex,text:value,fontFamily:font,fontStyle:'Bold',fontSize:size,
  styleRuns:[{start:0,end:value.length,fontFamily:font,fontStyle:'Bold',fontSize:size}],colorRuns:[{start:0,end:value.length,fill:{type:'solid',color}}],textBox:{align:'CENTER',vertical:'CENTER',wrap:false}}
 return {record:r,slot:{element,binding:{field:'metric' as const},recoveredAsset:`/api/uploads/${encodeURIComponent(uploadId)}/assets/${encodeURIComponent(e.assetId)}`}}
}
function intersects(a:SceneRecord,b:SceneRecord){return Math.min(a.bounds.x+a.bounds.width,b.bounds.x+b.bounds.width)>Math.max(a.bounds.x,b.bounds.x)+2&&Math.min(a.bounds.y+a.bounds.height,b.bounds.y+b.bounds.height)>Math.max(a.bounds.y,b.bounds.y)+2}
