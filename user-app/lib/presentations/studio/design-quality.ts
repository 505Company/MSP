import type {Candidate,ContentSlide,RenderReceipt} from './contract'
import {comparisonSections} from './compositions'
import {structuredPattern} from './structured-compositions'

/** Ranking is separate from technical validity: a fitting slide can still
 * have a tiny main message or a badly fragmented reading order. */
export function designQuality(content:ContentSlide,candidate:Candidate,receipt:Pick<RenderReceipt,'text'>){
  let score=100
  const reasons:string[]=[],deduct=(points:number,reason:string)=>{score-=points;if(!reasons.includes(reason))reasons.push(reason)}
  const title=receipt.text.filter(t=>content.blocks.find(b=>b.id===t.blockId)?.role==='title')
  const body=receipt.text.filter(t=>content.blocks.find(b=>b.id===t.blockId)?.role==='body')
  const titleSize=Math.max(0,...title.map(t=>t.size))
  for(const t of title){
    const lines=t.height/Math.max(1,t.size*1.18)
    if(lines>4.1&&t.value.length<170)deduct(24,'Заголовок раздроблен на узкие строки')
    if(t.size<72&&t.value.length<130)deduct((72-t.size)*.6,'Мелкий заголовок')
  }
  const longBody=body.filter(t=>t.value.trim().length>12&&!['marker','value','index'].includes(t.field))
  if(longBody.length){
    const small=longBody.filter(t=>t.size<44)
    deduct(Math.min(32,small.reduce((n,t)=>n+(44-t.size),0)/longBody.length*1.8),small.length?'Основной текст слишком мелкий':'')
    if(titleSize>128&&small.length===longBody.length)deduct(12,'Заголовок подавляет пояснение')
  }
  for(const t of body.filter(t=>t.field==='value'&&t.value.length<30&&!t.value.includes('\n'))){
    if(t.height>t.size*1.65)deduct(24,'Число и единица разорваны')
  }
  for(const b of content.blocks.filter(b=>b.role==='body')){
    const factLines=(b.fields.text??'').split('\n').filter(Boolean)
    if(factLines.length>=4&&factLines.every(line=>line.length<100&&/\d/.test(line))&&body.some(t=>t.blockId===b.id&&!t.sourceRange))deduct(18,'Перечень показателей остался сплошным текстом без иерархии')
  }
  const comparison=comparisonSections(content)
  if(comparison){
    const labelSlot=candidate.slots.find(s=>s.blocks.includes(comparison.label.id))
    if(!labelSlot||labelSlot.blocks.some(id=>comparison.before.some(b=>b.id===id)))deduct(18,'Заголовок второго состояния смешан с пунктами первого')
  }
  const numericFacts=content.blocks.filter(b=>b.role==='body'&&b.kind==='text'&&Object.keys(b.fields).length===1&&b.source.length<100&&/\d/.test(b.source))
  if(numericFacts.length>=4&&!candidate.recipeId.startsWith('composition/paired-')&&!candidate.slots.some(s=>s.presentation?.factLayout))deduct(12,'Показатели не выделены и не разделены на читаемые ячейки')
  const pattern=structuredPattern(content)
  if(pattern&&!candidate.recipeId.startsWith('composition/paired-')&&!candidate.slots.some(s=>s.presentation?.contentTreatment)){
    deduct(pattern.kind==='sections'?24:20,pattern.kind==='sections'?'Смысловые разделы распались на отдельные карточки':pattern.kind==='pairs'?'Связанные подписи и значения не образуют единую группу':'Список не получил собственной структуры')
  }
  const metrics=content.blocks.filter(b=>b.kind==='metric')
  const titleBlock=content.blocks.find(b=>b.role==='title'),firstBody=content.blocks.find(b=>b.role==='body')
  if(titleBlock&&/^[+−–-]?\d[\d\s.,]*\s*\S{1,20}$/.test(titleBlock.source)&&titleBlock.source.length<=32&&firstBody?.kind==='text'&&firstBody.source.length<=140){
    const value=title[0],caption=body.find(t=>t.blockId===firstBody.id)
    if(value&&caption){
      const sharedWidth=Math.min(value.x+value.width,caption.x+caption.width)-Math.max(value.x,caption.x)
      const sharedHeight=Math.min(value.y+value.height,caption.y+caption.height)-Math.max(value.y,caption.y)
      const below=sharedWidth>=Math.min(value.width,caption.width)*.6&&caption.y>=value.y&&caption.y-value.y-value.height<=180
      const beside=sharedHeight>=Math.min(value.height,caption.height)*.6&&caption.x>=value.x&&caption.x-value.x-value.width<=160
      if(!below&&!beside)deduct(24,'Основной показатель отделён от своего пояснения')
    }
  }
  if(metrics.length>=4&&metrics.length===content.blocks.filter(b=>b.role==='body').length&&body.filter(t=>t.field==='value').some(t=>t.size<96))deduct(22,'Показатели оформлены как мелкие подписи')
  // Penalise underfilled text regions using glyph-width estimates, not the
  // full-width CSS line box. Intentional whitespace on a cover stays valid.
  if(content.blocks.length>2){
    const ink=receipt.text.reduce((n,t)=>n+t.value.replace(/\s/g,'').length*t.size*t.size*.5,0)/(1920*1080)
    if(ink<.12)deduct((.12-ink)*240,'Содержание занимает слишком малую часть слайда')
    const bodySlots=candidate.slots.filter(s=>s.blocks.some(id=>content.blocks.find(b=>b.id===id)?.role==='body'))
    if(content.blocks.some(b=>b.kind==='step')&&bodySlots.some(s=>s.rect.w>1450&&s.blocks.length>=4&&s.direction==='column')&&longBody.every(t=>t.value.length<85))deduct(16,'Короткие пункты растянуты в одну узкую ленту')
  }
  return {score:Math.max(0,Math.round(score)),reasons:reasons.filter(Boolean)}
}

export function semanticCandidatePriority(content:ContentSlide,c:Candidate){
  if(c.recipeId.startsWith('composition/number-story'))return -5
  if(c.recipeId.startsWith('composition/paired-')||c.slots.some(s=>s.presentation?.contentTreatment))return -4
  const body=content.blocks.filter(b=>b.role==='body'),steps=body.filter(b=>b.kind==='step'||b.kind==='feature'&&/^\d{1,2}[.)]?$/.test(b.fields.heading?.trim()??''))
  if(steps.length>=3&&body.length-steps.length<=1)return /journey|process|steps|timeline/.test(c.recipeId)?-3:1
  if(body.filter(b=>b.kind==='metric').length===1&&body.length<=2)return /metric-focus/.test(c.recipeId)?-3:0
  if(body.filter(b=>b.kind==='metric').length>=2)return /metric|evidence|facts/.test(c.recipeId)?-2:0
  if(c.recipeId==='composition/fact-grid')return -3
  if(c.recipeId==='composition/comparison-sections')return -4
  return 0
}
