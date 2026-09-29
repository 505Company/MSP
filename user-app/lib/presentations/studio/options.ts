import type {Candidate,ComponentBinding,DesignOption,SlideWork,Slot,StudioLibrary} from './contract'
import {compositionSignature} from './compositions'
import {componentAppearance,studioTheme} from './theme'
import {orderedCandidates,variationRank,recipeFamily} from './variation'

/** Match a library component to a region's visual job as well as its content.
 * A panel is not an admissible replacement for an explicitly open text row. */
export function slotBindings(work:SlideWork,library:StudioLibrary,slot:Slot,id:string):ComponentBinding[]{
  // Current prepared profiles bind at most three flat fields. They cannot
  // replace a compound contract by flattening its repeated items into body.
  if(slot.presentation?.requiresNestedFields||slot.presentation?.primitiveFirst)return []
  // A display recipe's flowing paragraph area owns its type scale. An
  // unrelated one-field source caption must not freeze one paragraph at 24px.
  if(['display','support'].includes(slot.presentation?.typographyRole??''))return []
  const treatment=slot.presentation?.components??'any',background=studioTheme(library).background.toLowerCase()
  const matches=(work.bindings[id]??[]).filter(binding=>{
    const p=library.prepared[binding.id]?.profile
    const heading=p?.fields.find(f=>f.role==='title'),body=p?.fields.find(f=>f.role==='body')
    if(slot.presentation?.maxHeadingRatio&&heading&&body&&heading.size/body.size>slot.presentation.maxHeadingRatio)return false
    if(treatment==='any')return true
    const native=library.editable.find(t=>t.id===binding.id)
    const color=p?.source.background??native?.style.background
    const panel=!!p?.source.graphic||!!p?.artwork||!!color&&color.toLowerCase()!==background
    const rgb=color?.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)?.slice(1).map(n=>parseInt(n,16))
    const accent=!!rgb&&Math.max(...rgb)-Math.min(...rgb)>70
    // An accent region requires the source's inverse type. A black-on-blue
    // sample is not a compatible substitute for this recipe's white text.
    if(treatment==='accent'&&accent){
      const inks=p?.fields.map(f=>f.color)??[native?.style.color]
      if(inks.some(c=>c&&/^#(?:0[0-9a-f]|1[0-9a-f]|2[0-9a-f]){3}$/i.test(c)))return false
    }
    return treatment==='bare'?!panel:treatment==='accent'?accent:panel&&!accent
  })
  const density=slot.presentation?.density??(work.content.blocks.find(b=>b.id===id)?.emphasis==='secondary'?'compact':undefined)
  if(!density)return matches
  const area=(binding:ComponentBinding)=>{const p=library.prepared[binding.id]?.profile.source,t=library.editable.find(t=>t.id===binding.id);return (p?.width??t?.width??slot.rect.w)*(p?.height??t?.height??slot.rect.h)}
  return matches.sort((a,b)=>density==='large'?area(b)-area(a):density==='compact'?area(a)-area(b):Math.abs(area(a)-slot.rect.w*slot.rect.h/slot.blocks.length)-Math.abs(area(b)-slot.rect.w*slot.rect.h/slot.blocks.length))
}
const hash=(value:string)=>{let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36)}
export function optionSignature(candidate:Candidate,library:StudioLibrary,components:Record<string,string>,states?:Record<string,string>){
  // A primitive alternative hidden behind the same DS component is not a new
  // design. After measurement use its actual state, not requested density.
  const visible:Candidate={...candidate,slots:candidate.slots.map(s=>({...s,presentation:states?{...s.presentation,density:undefined}:s.presentation})),...candidate.authored?{authored:{...candidate.authored,primitives:Object.fromEntries(Object.entries(candidate.authored.primitives).filter(([id])=>!components[id]))}}:{}}
  return hash(JSON.stringify([compositionSignature(visible),Object.entries(components).sort().map(([block,id])=>[block,componentAppearance(library,id),states?.[block]])]))
}
export function draftOptions(work:SlideWork,library:StudioLibrary):DesignOption[]{
  if(work.strictComponents){
    if(!work.plan||work.candidates.length!==1)throw Error('Нет проверенного решения Qwen для сетки компонентов.')
    const signature=optionSignature(work.candidates[0],library,work.plan.components),id=`option-${hash(signature)}`
    return [{id,label:'Компоненты · сетка Qwen',signature,plan:{...work.plan,optionId:id}}]
  }
  const seen=new Set<string>(),explicit=work.content.blocks.filter(b=>b.emphasis==='primary')
  return orderedCandidates(work).flatMap(c=>{
    const structure=compositionSignature(c);if(seen.has(structure))return [];seen.add(structure)
    const components=c.fixedComponents??Object.fromEntries(c.slots.flatMap(s=>s.blocks.flatMap(id=>{
      const matches=slotBindings(work,library,s,id)
      if(work.variation){
        const used=work.previousDesigns?.at(-1)?.components??[],seed=`${work.variation.seed}/${work.variation.mode}/${work.content.id}/${id}`
        matches.sort((a,b)=>Number(used.includes(a.id))-Number(used.includes(b.id))||variationRank(seed,a.id)-variationRank(seed,b.id))
      }
      return matches.length?[[id,matches[0].id]]:[]
    })))
    const signature=optionSignature(c,library,components),id=`option-${hash(c.id+signature)}`
    return [{id,label:c.label,signature,plan:{optionId:id,candidateId:c.id,components,primary:(explicit.length?explicit:work.content.blocks.filter(b=>b.kind==='metric').slice(0,1)).map(b=>b.id),rationale:'Композиция из блоков рецептов; компоненты выбраны по смыслу и типу области.'}}]
  })
}
/** Prefer least recently seen designs. Never repeat the preceding selection
 * while another measured, valid option exists. */
export function offeredOptions(work:SlideWork){
  const history=work.history??[],valid=(work.options??[]).filter(o=>o.receipt?.passed)
  if(valid.length<2)return valid
  const best=Math.max(...valid.map(o=>o.receipt?.quality?.score??100))
  const direction=work.variation?.mode==='fast'?undefined:work.variation?.mode
  const directed=work.variation?valid.filter(o=>work.candidates.find(c=>c.id===o.plan.candidateId)?.artDirection===direction&&(o.receipt?.quality?.score??100)>=Math.max(86,best-12)):[]
  const pool=directed.length?directed:valid,ceiling=Math.max(...pool.map(o=>o.receipt?.quality?.score??100))
  const comparable=pool.filter(o=>(o.receipt?.quality?.score??100)>=ceiling-4)
  if(comparable.length<2)return comparable
  const last=history.at(-1)
  return comparable.filter(o=>o.signature!==last).sort((a,b)=>history.lastIndexOf(a.signature)-history.lastIndexOf(b.signature))
}

export function fastOption(work:SlideWork,usedRecipes:string[]=[]){
  const history=work.history??[],count=(id:string)=>usedRecipes.filter(r=>recipeFamily(r)===recipeFamily(id)).length
  const quality=(o:DesignOption)=>o.receipt?.quality?.score??100
  const previous=(o:DesignOption)=>{const c=work.candidates.find(c=>c.id===o.plan.candidateId);return (work.previousDesigns??[]).slice(-6).filter(d=>d.recipe===c?.recipeId&&(!c?.backgroundId||d.background===c.backgroundId)).length}
  const tie=(o:DesignOption)=>work.variation?variationRank(`${work.variation.seed}/${work.variation.mode}/${work.content.id}`,o.plan.candidateId):0
  const offered=offeredOptions(work)
  // Once a source cover fits and meets the same readability bar, retain its
  // visual identity. Seeded variety chooses among source covers; it must not
  // replace them with a plain text composition just to change the recipe.
  const covers=offered.filter(o=>work.candidates.find(c=>c.id===o.plan.candidateId)?.backgroundId)
  return (covers.length?covers:offered).sort((a,b)=>history.lastIndexOf(a.signature)-history.lastIndexOf(b.signature)||previous(a)-previous(b)||count(a.plan.candidateId)-count(b.plan.candidateId)||quality(b)-quality(a)||tie(a)-tie(b))[0]
}
