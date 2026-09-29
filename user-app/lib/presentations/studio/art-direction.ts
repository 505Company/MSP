import type {Box,Candidate,ContentSlide,Slot,StudioLibrary} from './contract'
import {sourceBackground} from './theme'

const box=(slots:Slot[]):Box=>({x:Math.min(...slots.map(s=>s.rect.x)),y:Math.min(...slots.map(s=>s.rect.y)),w:Math.max(...slots.map(s=>s.rect.x+s.rect.w))-Math.min(...slots.map(s=>s.rect.x)),h:Math.max(...slots.map(s=>s.rect.y+s.rect.h))-Math.min(...slots.map(s=>s.rect.y))})
const mapBox=(r:Box,from:Box,to:Box):Box=>({x:to.x+(r.x-from.x)*to.w/from.w,y:to.y+(r.y-from.y)*to.h/from.h,w:r.w*to.w/from.w,h:r.h*to.h/from.h})
const ink=(s:Slot):Slot=>({...s,presentation:{...s.presentation,primitiveFirst:true,ink:s.presentation?.ink==='inverse'?'ink':s.presentation?.ink,components:'bare'}})

/** Deck-level directions change reading composition, not recipe IDs or hues.
 * Source fields and semantic groups remain intact. Every alternative still
 * passes the normal browser fitting and exact-content checks. */
export function artDirectedCandidates(content:ContentSlide,candidates:Candidate[],library:StudioLibrary):Candidate[]{
 if(candidates.some(c=>c.artDirection)||content.blocks.some(b=>b.data||b.placement))return candidates
 const title=content.blocks.filter(b=>b.role==='title');if(title.length!==1)return candidates
 const canvas=sourceBackground(library),fills=library.backgrounds?.fills??[]
 const color=(f:typeof fills[number])=>f.element.fill?.color
 const alternate=fills.filter(f=>color(f)).sort((a,b)=>{
  const c=color(a)!,d=color(b)!,distance=(v:typeof c)=>Math.abs((v.r+v.g+v.b)/3-(canvas&&parseInt(canvas.slice(1,3),16)/255||0))
  return distance(d)-distance(c)
 })[0]
 const alternateId=alternate&&color(alternate)&&'#'+[color(alternate)!.r,color(alternate)!.g,color(alternate)!.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase()!==canvas?.toUpperCase()?alternate?.id:undefined
 const added:Candidate[]=[]
 for(const base of candidates.filter(c=>!c.mirrored&&!c.backgroundId&&!c.authored&&!c.fixedComponents&&c.id===c.recipeId&&c.recipeId.startsWith('composition/'))){
  const headline=base.slots.find(s=>s.blocks.length===1&&s.blocks[0]===title[0].id)
  if(!headline)continue
  const footer=base.slots.filter(s=>s!==headline&&s.blocks.every(id=>content.blocks.find(b=>b.id===id)?.role==='footer'))
  const body=base.slots.filter(s=>s!==headline&&!footer.includes(s));if(!body.length)continue
  const end=footer.length?884:1008
  const add=(name:string,direction:'balanced'|'creative',slots:Slot[],decorations:Candidate['decorations']=[])=>added.push({...base,id:`${base.id}/${name}`,label:`${base.label} · ${direction==='balanced'?'редакционная композиция':'плакатная композиция'}`,artDirection:direction,slots,decorations,...direction==='creative'&&alternateId?{canvasFillId:alternateId}:{},preserveReadingOrder:true})
  if(base.recipeId==='composition/number-story'){
   // A statistical title is the primary value, not page furniture.
   add('editorial','balanced',base.slots,base.decorations)
   const caption=body.find(s=>s.region==='main-caption'),facts=body.find(s=>s.region==='other-facts')
   if(caption&&facts)add('poster','creative',[
    {...headline,rect:{x:80,y:96,w:1760,h:224},presentation:{...headline.presentation,ink:'accent',maxTypeSize:208}},
    {...ink(caption),rect:{x:80,y:360,w:1560,h:168},presentation:{...ink(caption).presentation,maxTypeSize:68}},
    {...ink(facts),direction:'wrap',columns:facts.blocks.length,rect:{x:80,y:624,w:1760,h:end-624},gap:64},...footer,
   ])
   continue
  }
  // Only header recipes can be reframed. Numeric cards, source covers and
  // arbitrary model grids keep their own visual contracts.
  if(headline.rect.y>160||headline.rect.w<1400)continue
  if(base.recipeId==='composition/section-columns'){
   const slots=body.map(s=>({...s,rect:{x:s.rect.x+28,y:s.rect.y+28,w:s.rect.w-56,h:s.rect.h-56},presentation:{...s.presentation,primitiveFirst:true,ink:'panel' as const}}))
   add('editorial-panels','balanced',[headline,...slots,...footer],body.map((s,i)=>({id:'section-surface-'+i,rect:s.rect,surface:'panel' as const})))
  }else{
   const context=body.filter(s=>['context','lead','takeaway'].includes(s.region)),main=body.filter(s=>!context.includes(s))
   if(main.length){
    const from=box(main),to={x:848,y:112,w:992,h:end-112},titleHeight=context.length?Math.min(456,title[0].source.length>70?456:360):Math.min(760,end-112)
    const slots=main.map(s=>{const next=ink(s);return {...next,rect:mapBox(s.rect,from,to),direction:s.blocks.length>1?'wrap' as const:s.direction,columns:Math.min(s.columns,2),gap:40,presentation:{...next.presentation,maxTypeSize:s.presentation?.contentTreatment==='metric'?128:60,repeatColumns:s.presentation?.repeatColumns?1:undefined}}})
    const room=end-(112+titleHeight+48)
    if(!context.length||room>=200)add('editorial-side','balanced',[
     {...headline,rect:{x:80,y:112,w:672,h:titleHeight},presentation:{...headline.presentation,primitiveFirst:true,ink:'ink',typographyRole:'display',maxTypeSize:104}},
     ...context.map((s,i)=>({...ink(s),rect:{x:80,y:112+titleHeight+48+i*room/context.length,w:672,h:room/context.length-24},presentation:{...ink(s).presentation,maxTypeSize:52}})),...slots,...footer,
    ],[{id:'column-rule',rect:{x:800,y:112,w:3,h:end-112},surface:'rule'}])
   }
  }
  const from=box(body),titleHeight=title[0].source.length>95?280:232,titleY=end-titleHeight,area={x:80,y:96,w:1760,h:titleY-160}
  if(area.h>=440){
   const slots=body.map(s=>({...ink(s),rect:mapBox(s.rect,from,area),presentation:{...ink(s).presentation,maxTypeSize:s.presentation?.contentTreatment==='metric'?152:s.presentation?.maxTypeSize??64}}))
   add('poster-low','creative',[
    ...slots,{...headline,rect:{x:80,y:titleY,w:1760,h:titleHeight},presentation:{...headline.presentation,primitiveFirst:true,ink:'ink',typographyRole:'display',maxTypeSize:128}},...footer,
   ],[{id:'headline-rule',rect:{x:80,y:titleY-32,w:1760,h:4},surface:'rule'}])
  }
 }
 return [...candidates,...added]
}
