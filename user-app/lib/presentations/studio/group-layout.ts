import {flexCandidate,type FlexNode} from './component-flex'
import type {Candidate,ContentSlide} from './contract'

/** Keep source groups together while accepting any number of semantic children
 * per group. Browser measurements redistribute space before reducing type. */
export function sourceGroupCandidates(slide:ContentSlide):Candidate[]{
 const body=slide.blocks.filter(b=>b.role==='body')
 if(!body.length||body.some(b=>!b.sourceGroup))return []
 const groups=[...new Set(body.map(b=>b.sourceGroup!.id))].map(id=>body.filter(b=>b.sourceGroup!.id===id).sort((a,b)=>a.sourceGroup!.position-b.sourceGroup!.position)).sort((a,b)=>a[0].sourceGroup!.order-b[0].sourceGroup!.order)
 if(groups.length<2)return []
 const title=slide.blocks.filter(b=>b.role==='title'),footer=slide.blocks.filter(b=>b.role==='footer')
 return [...new Set([Math.min(4,groups.length),2,1])].flatMap(columns=>{
  const nodes:FlexNode[]=[]
  const add=(parent:string,direction:FlexNode['direction'],weight:number,gap:number,block='')=>{const id='n'+(nodes.length+1);nodes.push({id,parent,direction,weight,gap,block});return id}
  const root=add('','column',1,32)
  for(const b of title)add(root,'leaf',12.4,0,b.id)
  const main=add(root,'column',footer.length?69.6:82.8,32)
  const width=(1824-32*(columns-1))/columns
  for(let i=0;i<groups.length;i+=columns){
   const row=add(main,'row',1,32)
   for(const group of groups.slice(i,i+columns)){
    const column=add(row,'column',1,20)
    for(const b of group){
     const lines=Object.values(b.fields).reduce((n,text)=>n+text.split('\n').reduce((s,line)=>s+Math.ceil(Math.max(1,line.length)/(width/14)),0),0)
     add(column,'leaf',Math.min(100,Math.max(6,(lines*32+(b.kind==='metric'?64:40))/10)),0,b.id)
    }
   }
  }
  for(const b of footer)add(root,'leaf',10,0,b.id)
  try{
   const candidate=flexCandidate(nodes,slide.blocks)
   return [{...candidate,id:`composition/source-groups-${columns}`,recipeId:'composition/source-groups',label:`Связанные группы · ${columns} колонки`,score:345-columns/10,measuredFlow:nodes,slots:candidate.slots.map(s=>{
    const b=slide.blocks.find(b=>b.id===s.blocks[0])!
    return {...s,presentation:{...s.presentation,density:'compact' as const,typeScale:.75,...b.kind==='step'||b.role!=='body'?{requiresNestedFields:true}:{}}}
   })}]
  }catch{return []}
 })
}
