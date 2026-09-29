import {compactPackets,validateCompact,bindCompactData,type CompactReply,type SlidePacket,type SourceAtom} from './compact-content'
import type {StudioLibrary} from './contract'

const metric=/^[+−–-]?\d[\d\s.,/]*(?:(?:%|×|x|млн|млрд|тыс\.?|п\.\s?п\.|минут(?:а|ы)?|мин|дней|дня|день)|\s+из\s+\d+\s+\p{L}+)?$/iu
const numbered=(row:SourceAtom[])=>row.length>1&&/^\d{1,3}$/.test(row[0].text)

/** Deterministic grouping over the same lossless source spans as smart mode.
 * Native tables, explicit chart requests and slide boundaries never depend on
 * a model. validateCompact checks every word and cell before binding the DS. */
export function fastContentReply(packet:SlidePacket):CompactReply{
  const rows=[...new Set(packet.atoms.map(a=>a.line))].map(line=>packet.atoms.filter(a=>a.line===line))
  const blocks:CompactReply['blocks']=[]
  const add=(kind:CompactReply['blocks'][number]['kind'],fields:Record<string,SourceAtom[]>,role:'title'|'body'|'footer'='body',line=0)=>{
    const hint=[...(packet.directionLines??[])].reverse().find(d=>d.line<line)?.text??''
    blocks.push({kind,role,priority:'normal',placement:role==='body'&&/^слева/iu.test(hint)?'left':role==='body'&&/^справа/iu.test(hint)?'right':'auto',fields:Object.entries(fields).map(([name,atoms])=>({name:name as 'text',ids:atoms.map(a=>a.id)})),data:'',chart:'none'})
  }
  let titleIndex=0
  if(metric.test(rows[0][0].text)){
    // A page can open with a rail of facts and place its verbal thesis later.
    // Skip complete value/caption pairs, without inventing another heading.
    while(titleIndex<rows.length&&metric.test(rows[titleIndex][0].text))titleIndex+=rows[titleIndex].length>1?1:2
    if(titleIndex>=rows.length)titleIndex=0
  }
  const title=[...rows.splice(titleIndex,1)[0]]
  while(rows.length&&/[,—–-]$/.test(title.at(-1)!.text)&&/^\p{Ll}/u.test(rows[0][0].text))title.push(...rows.shift()!)
  add('text',{text:title},'title')
  const contrasts:Record<string,string[]>={'раньше':['сейчас','теперь'],'было':['стало'],'до':['после'],'before':['after']}
  const opposite=contrasts[title.map(a=>a.text).join(' ').toLowerCase().replace(/:$/,'')]
  const divider=opposite?rows.findIndex(r=>opposite.includes(r.map(a=>a.text).join(' ').toLowerCase().replace(/:$/,''))):-1
  if(!packet.tables.length&&divider>0&&divider<rows.length-1){
    add('text',{text:rows.slice(0,divider).flat()},'body',rows[0][0].line)
    add('feature',{heading:rows[divider],body:rows.slice(divider+1).flat()},'body',rows[divider][0].line)
    blocks[blocks.length-2].placement='left';blocks[blocks.length-1].placement='right'
    return {blocks}
  }
  const ordinalRows=rows.map((r,i)=>r.length===1&&/^\d{1,2}$/.test(r[0].text)&&rows[i+1]&&!metric.test(rows[i+1][0].text)?i:-1).filter(i=>i>=0)
  const shortSteps=new Set<number>()
  for(let i=0;i<ordinalRows.length;){
    let end=i+1
    while(end<ordinalRows.length&&ordinalRows[end]===ordinalRows[end-1]+2&&Number(rows[ordinalRows[end]][0].text)===Number(rows[ordinalRows[end-1]][0].text)+1)end++
    if(end-i>=3)ordinalRows.slice(i,end).forEach(n=>shortSteps.add(n))
    i=end
  }
  for(let i=0;i<rows.length;i++){
    const row=rows[i],line=row[0].line,value=row[0].text,hint=[...(packet.directionLines??[])].reverse().find(d=>d.line<line)?.text??''
    const footer=/вывод|мелкая подпись|источник данных/iu.test(hint)||/^(?:источник:|по данным|примечание:)/iu.test(value)||i===rows.length-1&&(shortSteps.has(i-2)||value.length<100&&/\d{4}/.test(value)&&value===value.toUpperCase())
    if(footer&&!blocks.some(b=>b.role==='footer')){add('text',{text:rows.slice(i).flat()},'footer');break}
    if(shortSteps.has(i)){
      add('step',{marker:row,heading:rows[++i]},'body',line)
    }else if(numbered(row)){
      const body:SourceAtom[]=[]
      while(rows[i+1]&&!numbered(rows[i+1]))body.push(...rows[++i])
      if(body.length)add('step',{marker:row.slice(0,1),heading:row.slice(1),body},'body',line)
      else add('text',{text:row},'body',line)
    }else if(metric.test(value)&&(row.length>1||rows[i+1]&&!metric.test(rows[i+1][0].text))){
      add('metric',{value:row.slice(0,1),caption:row.length>1?row.slice(1):rows[++i]},'body',line)
    }else if(value.length<100&&rows[i+1]&&/^\p{Ll}/u.test(rows[i+1][0].text)&&rows[i+1][0].line===line+1){
      add('feature',{heading:row,body:rows[++i]},'body',line)
    }else{
      const list:SourceAtom[]=[]
      while(rows[i+1]&&/^[-—•]\s/u.test(rows[i+1][0].text))list.push(...rows[++i])
      if(list.length)add('list',{heading:row,body:list},'body',line)
      else add('text',{text:row},'body',line)
    }
  }
  for(const table of packet.tables){
    const hint=[...(packet.directionLines??[])].reverse().find(d=>d.line<(table.line??Infinity))?.text??''
    blocks.push({kind:table.requestedChart?'chart':'table',role:'body',priority:'normal',placement:/^слева/iu.test(hint)?'left':/^справа/iu.test(hint)?'right':'auto',fields:[],data:table.id,chart:table.requestedChart??'none'})
  }
  return {blocks}
}
export function fastContent(text:string,library:StudioLibrary){return compactPackets(text).map(packet=>bindCompactData(validateCompact(fastContentReply(packet),packet),library))}
