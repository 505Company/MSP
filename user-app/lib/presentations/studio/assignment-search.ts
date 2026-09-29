import type {Box, Candidate, ContentBlock, ContentSlide} from './contract'

export const ASSIGNMENT_POLICY='bounded-content-fit-1'
export const assignmentKey=(value:unknown)=>{
  let hash=2166136261
  for(const c of JSON.stringify(value))hash=Math.imul(hash^c.charCodeAt(0),16777619)
  return (hash>>>0).toString(36)
}

/** Ordering heuristic only. Browser glyph/table measurements decide admission. */
export function contentPressure(block:ContentBlock,box:Pick<Box,'w'|'h'>){
  const width=Math.max(1,box.w),height=Math.max(1,box.h)
  if(block.data?.template.kind==='table'){
    const {columns=[],rows=[]}=block.data.values,tracks=Math.max(1,columns.length),cellWidth=Math.max(1,width/tracks-32)
    const rowHeights=[columns,...rows].map(row=>Math.max(1,...row.map(cell=>Math.ceil(String(cell).length*16/cellWidth)))*40+38)
    return rowHeights.reduce((a,b)=>a+b,0)/height+Math.max(0,tracks*140/width-1)
  }
  if(block.data)return 520/width+320/height
  const size=block.role==='title'?64:block.kind==='metric'?48:32
  const lines=Object.values(block.fields).reduce((n,v)=>n+v.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length*size*.52/width)),0),0)
  return (lines*size*1.25+Math.max(0,Object.keys(block.fields).length-1)*20)/height
}

type Capacity={id:string;min:number;max:number;valid:(count:number)=>boolean}
export type AssignmentChoice<T>={region:string;value:T;cost:number}
/** Bounded backtracking retains several complete allocations. Invalid complete
 * assignments do not terminate the search. Required capacity is pruned early. */
export function searchAssignments<T>(entries:{block:ContentBlock;choices:AssignmentChoice<T>[]}[],regions:Capacity[],accept:(choices:Map<string,T>)=>boolean=()=>true){
  if(entries.some(e=>!e.choices.length))return []
  const ordered=[...entries].sort((a,b)=>a.choices.length-b.choices.length||b.block.source.length-a.block.source.length||a.block.id.localeCompare(b.block.id))
  const counts=new Map<string,number>(),assigned=new Map<string,T>(),regionsByBlock=new Map<string,string>(),found:{choices:Map<string,T>;cost:number;key:string}[]=[]
  const capacities=new Map(regions.map(r=>[r.id,r])),remaining=ordered.map((_,i)=>new Map(regions.map(r=>[r.id,ordered.slice(i).filter(e=>e.choices.some(c=>c.region===r.id)).length])))
  let visits=0
  function search(index:number,cost:number){
    if(++visits>8000||found.length>=96)return
    if(regions.some(r=>(counts.get(r.id)??0)+(remaining[index]?.get(r.id)??0)<r.min))return
    if(index===ordered.length){
      const key=JSON.stringify([...regionsByBlock])
      if(found.filter(f=>f.key===key).length<2&&regions.every(r=>r.valid(counts.get(r.id)??0))&&accept(assigned))found.push({choices:new Map(assigned),cost,key})
      return
    }
    const entry=ordered[index]
    for(const choice of [...entry.choices].sort((a,b)=>a.cost-b.cost)){
      const count=counts.get(choice.region)??0
      if(count>=capacities.get(choice.region)!.max)continue
      counts.set(choice.region,count+1);assigned.set(entry.block.id,choice.value);regionsByBlock.set(entry.block.id,choice.region)
      search(index+1,cost+choice.cost*(count+1))
      assigned.delete(entry.block.id);regionsByBlock.delete(entry.block.id);counts.set(choice.region,count)
    }
  }
  search(0,0)
  const groups=new Map<string,typeof found>()
  for(const f of found.sort((a,b)=>a.cost-b.cost))groups.set(f.key,[...groups.get(f.key)??[],f])
  return [0,1].flatMap(i=>[...groups.values()].flatMap(g=>g[i]?[g[i].choices]:[])).slice(0,8)
}

export function candidatePressure(candidate:Candidate,slide:ContentSlide){
  const loads=candidate.slots.flatMap(s=>{
    const columns=s.direction==='row'?s.blocks.length:s.direction==='wrap'?Math.min(s.columns,s.blocks.length):1,rows=Math.ceil(s.blocks.length/columns)
    return s.blocks.map(id=>contentPressure(slide.blocks.find(b=>b.id===id)!,{w:(s.rect.w-s.gap*(columns-1))/columns,h:(s.rect.h-s.gap*(rows-1))/rows}))
  })
  return Math.max(0,...loads)*12+loads.reduce((n,x)=>n+x,0)*2
}
