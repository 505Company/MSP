import type {BlockContract,FieldBinding,NormalizedValue,StructuredItemBinding} from './authored/incoming/section-39-514.recipe'
import type {ContentBlock,RenderReceipt} from './contract'
import type {PrimitiveNode} from './recipes'

export type SourceField={field:string;sourceRange?:{start:number;end:number}}
const aliases:Record<string,string[]>={text:['text'],title:['text','heading'],heading:['heading','value'],body:['body','text','caption'],value:['value'],caption:['caption'],index:['marker'],marker:['marker'],quote:['quote'],author:['author'],lead:['text','body'],note:['note','text'],label:['label','heading'],question:['heading','value'],answer:['body','caption']}
const bullet=/^[\t ]*(?:[-•*]|\d+[.)])\s+/
const ref=(b:ContentBlock,f:SourceField)=>`${b.id}.${f.field}${f.sourceRange?`@${f.sourceRange.start}:${f.sourceRange.end}`:''}`
const value=(b:ContentBlock,f:SourceField)=>f.sourceRange?b.fields[f.field].slice(f.sourceRange.start,f.sourceRange.end):b.fields[f.field]

/** Boundaries include original separators: concatenating slices reproduces the
 * whole field byte-for-byte, including markers, numbers and whitespace. */
function lines(text:string,start=0){
  const result:{start:number;end:number}[]=[]
  let cursor=start
  for(const line of text.slice(start).matchAll(/[^\n]*(?:\n|$)/g)){
    if(!line[0])continue
    const end=cursor+line[0].length
    if(!line[0].trim()&&result.length)result[result.length-1].end=end
    else result.push({start:cursor,end})
    cursor=end
  }
  return result
}

export function bindTextContract(b:ContentBlock,contract:BlockContract){
  const fields:Record<string,NormalizedValue>={},paths:Record<string,SourceField>={},used:SourceField[]=[]
  const claim=(path:string,f:SourceField):FieldBinding=>{paths[path]=f;used.push(f);return {sourceRefs:[ref(b,f)]}}
  const available=(key:string)=>Object.hasOwn(b.fields,key)&&!used.some(f=>f.field===key)
  const listNames=Object.entries(contract.fields).filter(([,s])=>s.kind==='list')
  let suffix:SourceField|undefined
  for(const [name,spec] of Object.entries(contract.fields).filter(([,s])=>s.kind!=='list').sort(([,a],[,c])=>Number(c.required)-Number(a.required))){
    if(spec.kind==='visual-type')return null
    const key=(aliases[name]??[name]).find(available)
    if(!key){if(spec.required)return null;continue}
    // A body followed by explicit bullets supplies body + nested items. A
    // required explanation is never fabricated out of the first bullet.
    if(name==='body'&&listNames.length&&key==='body'){
      const start=lines(b.fields[key]).find(r=>bullet.test(b.fields[key].slice(r.start,r.end)))?.start
      if(start!==undefined){
        if(start===0){if(spec.required)return null;continue}
        fields[name]=claim(name,{field:key,sourceRange:{start:0,end:start}});suffix={field:key,sourceRange:{start,end:b.fields[key].length}};continue
      }
    }
    fields[name]=claim(name,{field:key})
  }
  for(const [name,spec] of listNames){
    if(spec.kind!=='list')continue
    const direct=Object.keys(b.fields).flatMap(field=>{const m=/^(.+)\.(\d+)\.([^.]+)$/.exec(field);return m&&m[1]===name?[{field,index:Number(m[2]),name:m[3]}]:[]})
    const items:StructuredItemBinding[]=[]
    if(direct.length){
      const count=Math.max(...direct.map(f=>f.index))+1
      if(count>spec.maxItems||count<spec.minItems)return null
      for(let i=0;i<count;i++){
        const mapped:Record<string,FieldBinding>={}
        for(const [child,rule] of Object.entries(spec.itemFields)){
          const f=direct.find(f=>f.index===i&&f.name===child&&available(f.field))
          if(f)mapped[child]=claim(`${name}.${i}.${child}`,{field:f.field});else if(rule.required)return null
        }
        items.push({fields:mapped,sourceRefs:Object.values(mapped).flatMap(f=>f.sourceRefs)})
      }
    }else{
      const source=suffix??(['body','text'].find(available)?{field:['body','text'].find(available)!}:undefined)
      if(!source){if(spec.required)return null;continue}
      const ranges=lines(b.fields[source.field],source.sourceRange?.start??0)
      if(ranges.length<spec.minItems||ranges.length>spec.maxItems)return null
      for(const [i,range] of ranges.entries()){
        const text=b.fields[source.field].slice(range.start,range.end),marker=bullet.exec(text)?.[0]
        const mapped:Record<string,FieldBinding>={},textField=Object.keys(spec.itemFields).find(k=>['text','body'].includes(k))
        if(!textField)return null
        if(marker&&spec.itemFields.marker)mapped.marker=claim(`${name}.${i}.marker`,{field:source.field,sourceRange:{start:range.start,end:range.start+marker.length}})
        mapped[textField]=claim(`${name}.${i}.${textField}`,{field:source.field,sourceRange:{start:range.start+(mapped.marker?marker!.length:0),end:range.end}})
        if(Object.entries(spec.itemFields).some(([key,s])=>s.required&&!mapped[key]))return null
        items.push({fields:mapped,sourceRefs:Object.values(mapped).flatMap(f=>f.sourceRefs)})
      }
      suffix=undefined
    }
    fields[name]=items
  }
  if(!fieldsPreserved(b,used.map(f=>({...f,value:value(b,f)}))))return null
  return {fields,paths}
}

/** Both the browser and the server check exact, non-overlapping coverage. */
export function fieldsPreserved(block:ContentBlock,parts:{field:string;value:string;sourceRange?:{start:number;end:number}}[]){
  if(parts.some(p=>!Object.hasOwn(block.fields,p.field)))return false
  return Object.entries(block.fields).every(([field,text])=>{
    const fragments=parts.filter(p=>p.field===field).map(p=>({...p,start:p.sourceRange?.start??0,end:p.sourceRange?.end??text.length})).sort((a,b)=>a.start-b.start)
    let cursor=0
    for(const p of fragments){if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start!==cursor||p.end<=p.start||p.end>text.length||p.value!==text.slice(p.start,p.end))return false;cursor=p.end}
    return !!fragments.length&&cursor===text.length
  })
}
export const receiptPreservesFields=(block:ContentBlock,text:RenderReceipt['text'])=>fieldsPreserved(block,text.filter(t=>t.blockId===block.id))

/** A list may arrive as separate fields or multiline text. Both keep exact
 * source spans and receive the same visual hierarchy. */
export function structuredPrimitive(block:ContentBlock,kind:'list'|'section'|'pair'|'metric',columns:number):PrimitiveNode{
 if(kind==='metric')return {direction:'column',gap:16,justify:'start',insets:{top:0,right:0,bottom:16,left:0},edges:[{edge:'bottom',width:2}],children:Object.keys(block.fields).map(field=>({field,role:['value','heading'].includes(field)?'grid-value':'grid-label'}))}
 if(kind==='pair')return {direction:'column',gap:28,justify:'center',children:Object.keys(block.fields).map(field=>({field,role:field==='heading'?'column-heading':'support'}))}
 const cells=Object.entries(block.fields).flatMap(([field,text])=>lines(text).map(sourceRange=>({field,sourceRange,role:kind==='section'&&/:\s*$/.test(text.slice(sourceRange.start,sourceRange.end))?'column-heading':'support'})))
 return {direction:'column',columns,gap:12,children:cells.map(cell=>({direction:'column',justify:'center',gap:0,...kind==='list'?{insets:{top:0,right:0,bottom:8,left:0},edges:[{edge:'bottom' as const,width:2}]}:{},children:[cell]}))}
}

/** The legacy and generic recipes use the same exact fragment representation. */
export function repeatedTextPrimitive(block:ContentBlock,columns:number):PrimitiveNode|undefined{
  const field=Object.keys(block.fields)[0]
  if(Object.keys(block.fields).length!==1)return
  const ranges=lines(block.fields[field])
  if(ranges.length<2)return
  return {direction:'column',columns,gap:36,children:ranges.map(sourceRange=>({direction:'column',gap:0,justify:'center',children:[{field,sourceRange,role:'support'}]}))}
}

/** Numeric suffixes keep exact source ranges, including the dash and newline.
 * A recipe can give a fact hierarchy without rewriting it into a new metric. */
export function factPrimitive(block:ContentBlock,columns:number,layout:'inline'|'stacked'):PrimitiveNode|undefined{
  const [field]=Object.keys(block.fields)
  if(Object.keys(block.fields).length!==1)return
  const text=block.fields[field],ranges=lines(text)
  const children=ranges.map(sourceRange=>{
    const value=text.slice(sourceRange.start,sourceRange.end)
    const number=/[+−–-]?\d[\d\s.,]*\s*%\s*$/.exec(value)
    const fields:PrimitiveNode[]=number&&number.index>0?[
      {field,sourceRange:{start:sourceRange.start,end:sourceRange.start+number.index},role:'grid-label',...(layout==='inline'?{flex:{grow:1,shrink:1,basis:0}}:{})},
      {field,sourceRange:{start:sourceRange.start+number.index,end:sourceRange.end},role:'grid-value',flex:{grow:0,shrink:0,basis:'auto'}},
    ]:[{field,sourceRange,role:'support'}]
    return {direction:layout==='inline'?'row' as const:'column' as const,gap:20,justify:layout==='inline'?'center':'space-between',align:layout==='inline'?'center':'stretch',insets:{top:8,right:0,bottom:24,left:0},edges:[{edge:'bottom' as const,width:2}],children:fields}
  })
  return children.length===1?children[0]:{direction:'column',columns,gap:40,children}
}
export function listPrimitive(block:ContentBlock):PrimitiveNode|undefined{
  if(block.kind!=='list'||!block.fields.body)return
  const binding=bindTextContract(block,{type:'list',fields:{...block.fields.heading?{heading:{kind:'single' as const,required:true}}:{},items:{kind:'list',required:true,minItems:1,maxItems:100,itemFields:{marker:{required:false},text:{required:true}}}},primitiveLayouts:[],queryRole:null,componentLayouts:[]})
  if(!binding)return
  const items=binding.fields.items as StructuredItemBinding[]
  return {direction:'column',gap:20,children:[...binding.paths.heading?[{...binding.paths.heading,role:'column-heading'}]:[],{direction:'column',gap:0,children:items.map((_,i):PrimitiveNode=>({direction:'row',gap:18,children:[...binding.paths[`items.${i}.marker`]?[{...binding.paths[`items.${i}.marker`],role:'list-marker'}]:[],{...binding.paths[`items.${i}.text`],role:'body',flex:{grow:1,shrink:1,basis:0}}]}))}]}
}
