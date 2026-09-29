import type { ContentBlock, ContentSlide } from './contract'
import {splitSlideText} from './text-boundaries'

export function cleanMarkup(s: string) {
  return s.replace(/\\\s*$/gm, '').replace(/\*\*([^]*?)\*\*/g, '$1').replace(/__([^]*?)__/g, '$1')
    .replace(/^\*([^\n]*)\*$/gm, '$1').replace(/^#{1,6}\s+/gm, '').trim()
}
const metric=/^[+−–-]?\d[\d\s.,/]*(?:%|×|x|\+|млн|млрд|тыс\.?|п\.п\.|мин|дней|дня|день|источника|вариантов)?$/iu
const step=/^(\d{1,3})(?:\s*[—–.)-]\s*|\s+(?=[A-ZА-ЯЁ]))(.+)$/u
const listLine=(line:string)=>/^[-•]\s/.test(line)||/\s[—–]\s*[+−-]?\d/.test(line)
type Hint=Pick<ContentBlock,'placement'|'emphasis'> & {count?:number;footer?:boolean}
type Section={lines:string[];hint:Hint}
const counts:Record<string,number>={один:1,одна:1,одно:1,два:2,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10}
function instruction(line:string):Hint|null{
  const position=/^(слева|справа|вверху|сверху|внизу)(?:\s+(?:огромно|крупно|крупная цифра|короткий вывод|\d+|одна?|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|небольшие|небольших|коротких|большие|карточки|карточек|пункта|пунктов|показателя|показателей))*\s*:$/iu.exec(line)
  if(position){const number=line.match(/\b\d+\b/)?.[0]??line.toLowerCase().split(/\s+/).find(w=>counts[w]);return {
    placement:({слева:'left',справа:'right',вверху:'top',сверху:'top',внизу:'bottom'} as const)[position[1].toLowerCase() as 'слева'],
    .../огромно|крупно|крупная цифра/iu.test(line)?{emphasis:'primary' as const}:{},
    ...number?{count:counts[number]??Number(number)}:{},
  }}
  if(/^(?:мелкая подпись|источник данных)\s*:$/iu.test(line))return {footer:true}
  if(/^(?:отдельная карточка|небольшой вывод|небольшая фраза снизу)\s*:$/iu.test(line))return /вывод|снизу/iu.test(line)?{placement:'bottom'}:{}
  if(/^(?:(?:очень|более|визуально)\s+)?(?:(?:свободный|легкий|лёгкий|простой|финальный|тезисный|минималистичный|двухколоночный|трёхколоночный|трехколоночный)\s+)+слайд\.?$/iu.test(line))return {}
  if(/^(?:визуально|инфографика|оформление|композиция|дизайн|layout)\s*:/iu.test(line))return {}
  return null
}

/** Explicit brief markers form groups even after copying strips Markdown and
 * blank lines. Ordinary prose is not discarded on a vague semantic guess. */
function sections(lines:string[],directions:string[]):Section[]{
  const result:Section[]=[];let section:Section={lines:[],hint:{}}
  const flush=()=>{if(section.lines.some(l=>l.trim()))result.push(section)}
  for(const raw of lines){const line=cleanMarkup(raw),hint=instruction(line)
    if(hint){flush();directions.push(line);section={lines:[],hint};continue}
    if(/^(?:по данным|источник:|примечание:)/iu.test(line)){flush();section={lines:[],hint:{footer:true}}}
    section.lines.push(line)
  }
  flush();return result
}
function paragraphLines(section:Section):string[][]{
  const paragraphs=section.lines.join('\n').split(/\n\s*\n/).map(p=>p.split('\n').filter(Boolean)).filter(p=>p.length)
  const flat=paragraphs.flat(),n=section.hint.count
  if(n&&paragraphs.length===n)return paragraphs
  // Explicit point count is evidence for pairs; unmarked prose stays intact.
  if(n&&flat.length===n*2)return Array.from({length:n},(_,i)=>flat.slice(i*2,i*2+2))
  return paragraphs.flatMap(lines=>{
    const groups:string[][]=[];let current:string[]=[]
    for(const [i,line] of lines.entries()){
      const boundary=metric.test(line)||step.test(line)||!listLine(line)&&listLine(lines[i+1]??'')
      if(boundary&&current.length){groups.push(current);current=[]}
      current.push(line)
    }
    if(current.length)groups.push(current)
    return groups
  })
}

export function normalizeText(text:string):ContentSlide[]{
  const {chunks}=splitSlideText(text)
  const slides:ContentSlide[]=[]
  for(const rawChunk of chunks){
    const chunk=rawChunk.map(line=>line.replace(/^\s*(?:слайд|slide)\s+\d+\s*[—–:.-]?\s*/iu,''))
    const first=chunk.findIndex(l=>l.trim());if(first<0)continue
    const title=cleanMarkup(chunk[first]).replace(/^\d+\.\s+/,'')
    const blocks:ContentBlock[]=[{id:'b1',kind:'text',role:'title',fields:{text:title},source:title}],directions:string[]=[]
    const add=(kind:ContentBlock['kind'],fields:Record<string,string>,hint:Hint)=>blocks.push({id:`b${blocks.length+1}`,kind,role:hint.footer||hint.placement==='bottom'?'footer':'body',fields,source:Object.values(fields).join('\n'),...hint.placement?{placement:hint.placement}:{},...hint.emphasis?{emphasis:hint.emphasis}:{}})
    for(const section of sections(chunk.slice(first+1),directions)){
      const paragraphs=paragraphLines(section),hint=section.hint
      for(let i=0;i<paragraphs.length;i++){
        const lines=paragraphs[i],value=lines[0],body=lines.join('\n')
        if(hint.footer||hint.placement==='bottom'){add('text',{text:body},hint);continue}
        if(lines.every(listLine)){
          const previous=blocks.at(-1)
          if(previous?.kind==='text'&&previous.role==='body'&&previous.placement===hint.placement&&previous.fields.text.length<160){previous.kind='list';previous.fields={heading:previous.fields.text,body};previous.source+='\n'+body}
          else add('list',{body},hint)
          continue
        }
        if(metric.test(value)&&(lines.length>1||paragraphs[i+1]&&!metric.test(paragraphs[i+1][0]))){
          const caption=lines.length>1?lines.slice(1).join('\n'):paragraphs[++i].join('\n')
          add('metric',{value,caption},hint);continue
        }
        const numbered=step.exec(value)
        if(numbered&&lines.length>1){add('step',{marker:numbered[1],heading:numbered[2],body:lines.slice(1).join('\n')},hint);continue}
        if(/^[«“]/.test(body)&&lines.length>1){add('quote',{quote:lines.slice(0,-1).join('\n'),author:lines.at(-1)!},hint);continue}
        if(lines.length>1)add(lines.slice(1).every(listLine)?'list':'feature',{heading:value,body:lines.slice(1).join('\n')},hint)
        else add('text',{text:body},hint)
      }
    }
    // Input boundaries are authoritative. Layout capacity is checked later;
    // the interpreter must not silently add pages or repeat the title.
    slides.push({id:`slide-${slides.length+1}`,title,blocks,directions})
  }
  if(!slides.length||slides.length>100)throw Error('Поддерживается от 1 до 100 слайдов. Разделите большой материал.')
  return slides
}
