import type {CompactReply,SlidePacket} from './compact-content'
import type {ContentBlock} from './contract'

/** A KPI split out by the model still belongs to its numbered source section.
 * Infer only from referenced source positions, never model array order. */
export function sourceGroups(packet:SlidePacket,reply:CompactReply){
 const anchors=reply.blocks.filter(b=>b.kind==='step').flatMap(b=>{
  const markers=b.fields.find(f=>f.name==='marker')?.ids??[],headings=b.fields.find(f=>f.name==='heading')?.ids??[]
  const marker=packet.atoms.find(a=>a.id===markers[0]),heading=packet.atoms.find(a=>a.id===headings[0])
  return markers.length===1&&marker&&heading&&/^\d{1,3}$/.test(marker.text)&&marker.start===0&&marker.line===heading.line?[marker]:[]
 }).sort((a,b)=>a.line-b.line)
 const groups=new Map<CompactReply['blocks'][number],ContentBlock['sourceGroup']>()
 if(anchors.length<2||anchors.some((a,i)=>i>0&&Number(a.text)!==Number(anchors[i-1].text)+1))return groups
 for(const b of reply.blocks){
  if(b.role!=='body')continue
  const refs=b.fields.flatMap(f=>f.ids).map(id=>packet.atoms.find(a=>a.id===id)),table=b.data?packet.tables.find(t=>t.id===b.data):undefined
  if(refs.some(a=>!a)||b.data&&table?.line===undefined)continue
  const lines=[...refs.map(a=>a!.line),...table?[table.line!]:[]]
  if(!lines.length)continue
  const order=anchors.findLastIndex(a=>a.line<=Math.min(...lines)),anchor=anchors[order]
  if(!anchor||lines.some(line=>line>=(anchors[order+1]?.line??Infinity)))continue
  groups.set(b,{id:'section-'+anchor.id,order,position:Math.min(...refs.map(a=>a!.line*10000+a!.start),...table?[table.line!*10000]:[])})
 }
 return groups
}
