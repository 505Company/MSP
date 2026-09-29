import {hydrateEditableHtml} from './editable-hydrate'
import {z} from 'zod'
import {renderEditableHtml} from './editable-render'
import type {EditableTemplate,EditableData,EditableCatalog} from './editable-contract'
export const HTML_QUALIFICATION_VERSION='editable-html-check-9'
export const htmlQualificationSchema=z.object({version:z.literal(HTML_QUALIFICATION_VERSION),catalogId:z.string().regex(/^[a-f0-9]{64}$/),checks:z.array(z.object({id:z.string().max(120),passed:z.boolean(),source:z.boolean(),changed:z.boolean(),visual:z.object({pixelError:z.number().min(0).max(1),foregroundRecall:z.number().min(0).max(1),textRecall:z.number().min(0).max(1)}).strict().optional(),warnings:z.array(z.string().max(300)).max(30).optional(),issues:z.array(z.string().max(300)).max(30)}).strict()).max(2000)}).strict()
export type HtmlQualification=z.infer<typeof htmlQualificationSchema>
function sample(t:EditableTemplate):EditableData {
 const data:EditableData=structuredClone(t.data)
 const text=(before:string,after:string)=>t.sourceLayout?after.slice(0,before.length):after
 if(data.title)data.title=text(data.title,'Новый заголовок')
 if(data.text)data.text=text(data.text,'Текст для новых данных с пояснением.')
 if(data.value)data.value=/^[+−\-]?\d/.test(data.value)?data.value.replace(/^[+−\-]?\d+(?:[.,]\d+)?/,'73'):text(data.value,'Новые данные')
 if(data.rows)data.rows=[...data.rows.map(r=>r.map(v=>/^[-+\d.,%]+$/.test(v)?'73':v)),data.columns!.map((_,i)=>i?'73':'Новая строка')]
 if(data.series)data.series=data.series.map(s=>({...s,values:s.values.map(v=>v===null?null:Math.abs(v)*.7+1)}))
 if(data.items)data.items=data.items.map(i=>({...i,...(i.value?{value:'73'}:{}),...(i.title?{title:text(i.title,'Новый этап')}:{}),...(i.text?{text:t.sourceLayout&&/^\d/.test(i.text)?i.text.replace(/^\d+(?:[.,]\d+)?/,'73'):text(i.text,'Новые данные')}:{})}))
 if(t.children)data.children=t.children.map(sample)
 return data
}
/** Executed automatically in the importing browser, using the same HTML as
 * previews/exports. Both source data and changed rows/values must render. */
export async function qualifyEditableCatalog(catalog:EditableCatalog,onProgress?:(completed:number,total:number)=>void,signal?:AbortSignal):Promise<HtmlQualification>{
 signal?.throwIfAborted()
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:1000px;pointer-events:none;visibility:hidden;contain:layout style;';host.setAttribute('aria-hidden','true');document.body.appendChild(host)
 const checks:HtmlQualification['checks']=[]
 const seen=new Map<string,EditableTemplate>()
 const visit=(t:EditableTemplate)=>{if(seen.has(t.id))return;seen.set(t.id,t);for(const child of [...t.children??[],...t.sourceChart?.rows??[]])visit(child)}
 catalog.families.flatMap(f=>f.variants).forEach(visit)
 const templates=[...seen.values()]
 onProgress?.(0,templates.length)
 try{
  for(const t of templates){
   signal?.throwIfAborted()
   const issues:string[]=[],warnings=new Set<string>()
   const check=async(data:EditableData,stage:string)=>{
    signal?.throwIfAborted()
    host.innerHTML=renderEditableHtml(t,data)
    const normalize=(v:string)=>v.replace(/\s+/g,' ').trim(),content=normalize(host.textContent??'')
    const required=[data.title,data.text,...(['metric','feature'].includes(t.kind)?[data.value,data.unit]:[]),...(data.items??[]).flatMap(i=>[i.title,i.text,i.value])].filter((v):v is string=>!!v?.trim())
    if(required.some(value=>!content.includes(normalize(value)))){issues.push(`${stage}: потеряно текстовое содержание`);return false}
    if(t.kind==='metric'&&t.sourceLayout&&!t.sourceLayout.text.some(s=>['metric','value'].includes(s.binding.field))){issues.push(`${stage}: числовое значение не связано с редактируемым полем`);return false}
    if(t.sourceLayout&&!t.sourceInline){
      const ids=new Set([...host.querySelectorAll('[data-source-object]')].map(e=>e.getAttribute('data-source-object')))
      if(t.sourceLayout.graphicIds.some(id=>!ids.has(id))){issues.push(`${stage}: потеряна исходная графика`);return false}
      if(host.querySelectorAll('[data-native-text]').length!==t.sourceLayout.text.length){issues.push(`${stage}: потеряны текстовые области`);return false}
    }
    const fonts=await hydrateEditableHtml(host);await document.fonts.ready
    signal?.throwIfAborted()
    for(const warning of JSON.parse(host.dataset.fontWarnings??'[]') as string[])warnings.add(warning)
    if(fonts.length){issues.push(`${stage}: ${fonts[0]}`);return false}
    if(host.querySelector('[data-native-overflow="true"]')){issues.push(`${stage}: текст выходит за исходную область`);return false}
    const images=[...host.querySelectorAll('img')]
    for(const node of host.querySelectorAll('image')){const image=new Image();image.src=node.getAttribute('href')??'';images.push(image)}
    try{await Promise.all(images.map(i=>i.decode()))}catch{issues.push(`${stage}: исходная графика не загрузилась`);return false}
    if(!host.firstElementChild||host.getBoundingClientRect().height<1){issues.push(`${stage}: пустая разметка`);return false}
    const clipped=[...host.querySelectorAll<HTMLElement>('foreignObject > div')].filter(e=>e.scrollHeight>Number(e.parentElement!.getAttribute("height"))+3||e.scrollWidth>e.clientWidth+3)
    if(clipped.length){issues.push(`${stage}: текст не помещается в ${clipped.length} областях`);return false}
    const svg=[...host.querySelectorAll('svg')].some(e=>/NaN|Infinity/.test(e.outerHTML))
    if(svg){issues.push(`${stage}: недопустимая геометрия`);return false}
    return true
   }
   let source=false,changed=false
   try{source=await check(t.data,'Исходник');changed=await check(sample(t),'Новые данные')}catch(e){issues.push(`Ошибка HTML-рендера: ${e instanceof Error?e.message.slice(0,180):'неизвестная ошибка'}`)}
   signal?.throwIfAborted()
   checks.push({id:t.id,passed:source&&changed,source,changed,issues,warnings:[...warnings]})
   onProgress?.(checks.length,templates.length)
  }
 }finally{host.remove()}
 // An empty grid wrapper cannot certify broken components inside it.
 const byId=new Map(checks.map(c=>[c.id,c]))
 for(const t of templates.filter(t=>t.kind==='composition'||t.sourceChart).reverse()){
  const check=byId.get(t.id)!,children=[...t.children??[],...t.sourceChart?.rows??[]].map(c=>byId.get(c.id))
  if(children.some(c=>!c?.passed)){check.passed=false;check.source&&=children.every(c=>c?.source);check.changed&&=children.every(c=>c?.changed);check.issues.push('Один из вложенных компонентов не прошёл проверку')}
 }
 // The persisted API contract has one result per catalog variant. Nested-only
 // rows are checked above and gate their parents, but are not catalog entries.
 const published=new Set(catalog.families.flatMap(f=>f.variants.map(t=>t.id)))
 return {version:HTML_QUALIFICATION_VERSION,catalogId:catalog.id,checks:checks.filter(c=>published.has(c.id))}
}
