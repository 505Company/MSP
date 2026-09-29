import {compactPackets} from '../../lib/presentations/studio/compact-content'
import {fastContentReply} from '../../lib/presentations/studio/fast-content'
export const groupedSource='# Четыре этапа\n'+[1,2,3,4].map(i=>`${i}. Этап ${i}\nПояснение к этапу ${i}.\n${i*12}% участников выбирают этот этап.`).join('\n')+'\nНиже короткий вывод:\nВсе этапы относятся к одной поездке.'
export function groupedReplies(){
 const packet=compactPackets(groupedSource)[0],base=fastContentReply(packet)
 return {packet,replies:Array.from({length:16},(_,mask)=>{
  const reply=structuredClone(base);let step=0
  reply.blocks=reply.blocks.flatMap(b=>{
   if(b.kind!=='step'||!(mask&(1<<step++)))return [b]
   const body=b.fields.find(f=>f.name==='body')!,tail=body.ids.splice(-2)
   return [b,{kind:'metric',role:'body',placement:'auto',priority:'secondary',fields:[{name:'value',ids:tail.slice(0,1)},{name:'caption',ids:tail.slice(1)}],data:'',chart:'none'}]
  });return reply
 })}
}
