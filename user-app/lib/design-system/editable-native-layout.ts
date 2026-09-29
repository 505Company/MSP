import type {TextElementIR} from '../../vendor/drag/src/core/model'
import type {EditableData} from './editable-contract'
import {createTextFields,fillTextFields} from './text-fields'
export type NativeBinding={field:'title'|'text'|'value'|'unit'|'metric'|'item';index?:number;id?:string;part?:'text'|'title'|'value';richParts?:{slotId:string;field:'metric'|'item';index?:number}[]}
export type NativeLayout={graphic:string;text:Array<{element:TextElementIR;binding:NativeBinding;recoveredAsset?:string}>;graphicIds:string[];structure?:{panels:number;orientation:string;inline:boolean;illustrated?:boolean};bar?:{id:string;width:number}}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export const normalizedText=(v:unknown)=>String(v??'').replace(/\s+/g,' ').trim()
export function nativeBoundText(slot:NativeLayout['text'][number],data:EditableData,fit=false):TextElementIR{
 const e=structuredClone(slot.element),b=slot.binding
 const item=b.id?data.items?.find(i=>i.id===b.id):data.items?.[b.index??0]
 const next=b.field==='metric'?String(data.value??'')+String(data.unit??''):b.field==='item'?item?.[b.part??'text']??'':data[b.field]??''
 if(normalizedText(next)===normalizedText(e.text))return e
 if(fit){
  e.paragraphs??=[{start:0,end:e.text.length,fontSize:e.fontSize,align:e.textBox?.align??'LEFT',left:0,right:0,indent:0,before:0,after:0,lineHeight:{unit:'PERCENT',value:100}}]
  e.flow={columns:e.flow?.columns??1,gap:e.flow?.gap??0,autoFit:'SHRINK'}
 }
 const fitted=()=>{if(fit)e.flow!.autoFit='SHRINK';return e}
 const fields=createTextFields(e,'Текст')
 if(b.richParts){
  if(b.richParts.length!==fields.length||new Set(b.richParts.map(p=>p.slotId)).size!==fields.length||fields.some(f=>!b.richParts!.some(p=>p.slotId===f.id)))throw Error('Не подтверждены поля составного текста')
  fillTextFields(e,fields,Object.fromEntries(b.richParts.map(p=>[p.slotId,p.field==='metric'?String(data.value??'')+String(data.unit??''):data.items?.[p.index??0]?.text??''])));return fitted()
 }
 if(b.field==='metric'&&fields.length===2){
  fillTextFields(e,fields,{[fields[0].id]:data.value??'',[fields[1].id]:data.unit??''});return fitted()
 }
 if(fields.length===1&&!fields[0].range){fillTextFields(e,fields,{[fields[0].id]:next});return fitted()}
 // Preserve rich parts when only their values change (e.g. "10\nмлн").
 const oldParts=e.text.split('\n'),newParts=next.split('\n')
 if(fields.length===newParts.length&&oldParts.length===newParts.length&&fields.every((f,i)=>f.defaultText===oldParts[i].trim())){
  fillTextFields(e,fields,Object.fromEntries(fields.map((f,i)=>[f.id,newParts[i]])));return fitted()
 }
 // A different text structure gets the source's main text style. Content is
 // never truncated or redistributed into differently coloured fragments.
 const first=e.styleRuns?.[0],ink=e.colorRuns?.[0]
 e.text=next;e.styleRuns=first?[{...first,start:0,end:next.length}]:[];e.colorRuns=ink?[{...ink,start:0,end:next.length}]:[]
 e.fontFamily=first?.fontFamily??e.fontFamily;e.fontSize=first?.fontSize??e.fontSize;e.fontStyle=first?.fontStyle??e.fontStyle
 if(e.paragraphs?.length)e.paragraphs=[{...e.paragraphs[0],start:0,end:next.length}]
 return e
}
/** Native text is visible in server HTML, then laid out as editable SVG text by
 * the same measured typesetter that builds the source preview. */
export function renderNativeLayout(layout:NativeLayout,data:EditableData,width:number,height:number,barScale=1):string{
 let graphic=layout.bar&&barScale!==1?layout.graphic.replace(`data-source-object="${esc(layout.bar.id)}" transform="`,`data-source-object="${esc(layout.bar.id)}" transform="scale(${barScale} 1) `):layout.graphic
 graphic=graphic.replace(/viewBox="[^"]+"/,`viewBox="0 0 ${width} ${height}"`)
 return `<div data-native-layout style="position:relative;width:100%;aspect-ratio:${width}/${height}">${graphic}<svg viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${layout.text.map(slot=>{
  const e=nativeBoundText(slot,data,true),b=e.bounds,style=e.styleRuns?.[0]
  return `<svg x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" overflow="visible" role="img" aria-label="${esc(e.text)}" ${slot.recoveredAsset?`data-recovered-metric="${esc(slot.recoveredAsset)}"`:''} data-native-text="${esc(JSON.stringify(e))}" data-native-source="${esc(JSON.stringify(slot.element))}" data-source-text="${esc(e.id)}"><text x="0" y="${e.fontSize}" font-family="${esc(e.fontFamily)}" font-size="${style?.fontSize??e.fontSize}" fill="#000000">${esc(e.text)}</text></svg>`
 }).join('')}</svg></div>`
}
