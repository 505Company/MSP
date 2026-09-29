import { contentIssues } from '../../component-lab/contract'
import { componentFields } from '../layout-contract'
import type { EditableData, EditableTemplate } from '../../design-system/editable-contract'
import type { ContentBlock, StudioLibrary, ComponentBinding, SlideWork, SlidePlan } from './contract'

export function componentBindings(block:ContentBlock, library:StudioLibrary):ComponentBinding[] {
  if(block.role!=='body'||block.data)return []
  // In an ordinal-caption component the explanatory line is commonly called
  // body; a semantic step calls the same line heading. Keep the number/label
  // pairing instead of rejecting every otherwise compatible library step.
  const bodyFields=['body','text',...(block.kind==='step'?['heading']:[])]
  const roles:Record<string,string[]>={number:['value'],caption:['caption'],ordinal:['marker'],title:['heading'],body:bodyFields,quote:['quote'],author:['author']}
  const prepared = Object.entries(library.prepared).flatMap(([id,pin])=>{
    const fields:Record<string,string>={}, used=new Set<string>()
    // Imported photo cards retain source media. They are not decorations for
    // unrelated prose; only explicitly supplied media may bind a media field.
    if(pin.profile.family==='media-text')return []
    for(const f of pin.profile.fields){const source=roles[f.role]?.find(k=>block.fields[k]!==undefined&&!used.has(k));if(source){fields[f.id]=source;used.add(source)}else if(f.required)return []}
    if(Object.keys(block.fields).some(k=>!used.has(k)))return []
    const values=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,block.fields[field]]))
    return contentIssues(pin.profile,values).length?[]:[{id,fields,kind:'prepared' as const}]
  })
  const native = library.editable.flatMap(t=>{
    if(library.prepared[t.id]||t.children||t.sourceChart||t.sourceInline)return []
    // The generic data key "title" can actually hold an ordinal inside a
    // badge. Respect the importer's semantic fields before matching data keys.
    if(t.adaptation&&t.adaptation.family!=='fixed'&&(t.adaptation.family==='media-text'||t.adaptation.fields.some(f=>!roles[f.role]?.some(k=>block.fields[k]!==undefined))))return []
    const paths=componentFields(t),fields:Record<string,string>={}
    if(block.kind==='metric'&&t.kind==='metric'&&paths.includes('value')){
      const captions=paths.filter(p=>!['value','unit'].includes(p))
      if(captions.length===1){fields.value='value';fields[captions[0]]='caption'}
    }else if(['feature','list'].includes(block.kind)&&t.kind==='feature'&&paths.length===2){
      const heading=paths.find(p=>p==='title'||p.endsWith('.title')),body=paths.find(p=>p==='text'||p.endsWith('.text'))
      if(heading&&body){fields[heading]='heading';fields[body]='body'}
    }
    if(!Object.keys(fields).length||Object.values(fields).some(k=>block.fields[k]===undefined)||Object.keys(block.fields).some(k=>!Object.values(fields).includes(k)))return []
    return [{id:t.id,fields,kind:'editable' as const}]
  })
  return [...prepared,...native]
}
/** Clear all sample data, preserving only source item identities for bindings. */
export function editableValues(binding:ComponentBinding,template:EditableTemplate,block:ContentBlock):EditableData{
  const data:EditableData={...(template.data.items?{items:template.data.items.map(i=>({id:i.id}))}:{})}
  for(const [path,field] of Object.entries(binding.fields)){
    const match=/^items\.(\d+)\.(text|title|value)$/.exec(path)
    if(match){data.items??=[];data.items[Number(match[1])]??={};Object.assign(data.items[Number(match[1])],{[match[2]]:block.fields[field]})}
    else Object.assign(data,{[path]:block.fields[field]})
  }
  return data
}
export function fastPlan(work:SlideWork,index:number):SlidePlan {
  const explicit=work.content.blocks.filter(b=>b.emphasis==='primary')
  return {candidateId:work.candidates[0].id,primary:(explicit.length?explicit:work.content.blocks.filter(b=>b.kind==='metric').slice(0,1)).map(b=>b.id),
    components:Object.fromEntries(Object.entries(work.bindings).filter(([,v])=>v.length).map(([id,v])=>[id,v[index%v.length].id])),rationale:'Подбор совместимого рецепта и компонентов по содержанию.'}
}
export function validatePlan(raw:SlidePlan,work:SlideWork):SlidePlan {
  if(!work.candidates.some(c=>c.id===raw.candidateId))throw Error('Модель выбрала недоступный рецепт.')
  if(new Set(raw.primary).size!==raw.primary.length||raw.primary.length>3||raw.primary.some(id=>!work.content.blocks.some(b=>b.id===id)))throw Error('Некорректное распределение акцентов.')
  if(Object.entries(raw.components).some(([id,variant])=>!work.bindings[id]?.some(b=>b.id===variant)))throw Error('Компонент не соответствует полям содержания.')
  if(Object.entries(work.bindings).some(([id,variants])=>variants.length&&!raw.components[id]))throw Error('Подходящий библиотечный компонент не выбран.')
  return raw
}
