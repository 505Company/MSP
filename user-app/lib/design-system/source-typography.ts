import type { ParagraphIR, TextElementIR, TextStyleRunIR } from '../../vendor/drag/src/core/model'

// Remove only arithmetic noise. Source geometry and exact run/paragraph values
// stay in the snapshot and scan nodes used to reproduce the original layout.
function measured(value:unknown):unknown {
  if(typeof value==='number')return Math.round(value*1e6)/1e6
  if(Array.isArray(value))return value.map(measured)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,measured(v)]))
  return value
}

/** Typography describes the text, not the wrapping, vertical position, columns
 * or auto-fit policy of its container. Those remain on each source object. */
export function typographyStyleValue(text:TextElementIR,run?:TextStyleRunIR,paragraph?:ParagraphIR):Record<string,unknown> {
  return measured({
    fontFamily:run?.fontFamily??text.fontFamily,
    fontStyle:run?.fontStyle??text.fontStyle??'Regular',
    fontSize:run?.fontSize??text.fontSize,
    ...(run?.letterSpacing?{letterSpacing:run.letterSpacing}:{}),
    ...(run?.baselineShift?{baselineShift:run.baselineShift}:{}),
    ...(run?.decoration&&run.decoration!=='NONE'?{decoration:run.decoration}:{}),
    paragraph:{
      align:paragraph?.align??text.textBox?.align??'LEFT',
      left:paragraph?.left??0,right:paragraph?.right??0,indent:paragraph?.indent??0,
      before:paragraph?.before??0,after:paragraph?.after??0,
      ...(paragraph?.lineHeight?{lineHeight:paragraph.lineHeight}:{}),
      ...(paragraph?.tabs?.length?{tabs:paragraph.tabs}:{}),
      ...(paragraph?.defaultTab!==undefined?{defaultTab:paragraph.defaultTab}:{}),
    },
  }) as Record<string,unknown>
}

const number=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:4})
const points=(pixels:number)=>`${number(pixels*.75)} pt`
const alignment:Record<string,string>={LEFT:'По левому краю',CENTER:'По центру',RIGHT:'По правому краю',JUSTIFIED:'По ширине'}
export function typographyStyleHint(value:Record<string,unknown>,peers:Record<string,unknown>[]=[]){
  const p=value.paragraph as Partial<ParagraphIR>|undefined,spacing=Number(value.letterSpacing??0),shift=Number(value.baselineShift??0)
  const height=p?.lineHeight,parts=[height?`Интерлиньяж ${height.unit==='PERCENT'?number(height.value)+'%':points(height.value)}`:'',spacing?`Трекинг ${points(spacing)}`:'',p?.align&&p.align!=='LEFT'?alignment[p.align]:'',
    value.decoration==='UNDERLINE'?'Подчёркивание':value.decoration==='STRIKETHROUGH'?'Зачёркивание':'',shift?`Смещение базовой линии ${number(shift*100)}%`:'']
  for(const [key,label] of [['left','Отступ слева'],['right','Отступ справа'],['indent','Первая строка'],['before','Перед абзацем'],['after','После абзаца']] as const){
    if(p?.[key])parts.push(`${label} ${points(p[key])}`)
  }
  if(p?.tabs?.length)parts.push(`Табуляция: ${p.tabs.map(t=>`${points(t.position)} (${alignment[t.align].toLocaleLowerCase('ru')})`).join(', ')}`)
  // A default tab step is useful only when it distinguishes otherwise similar
  // typography; do not add an irrelevant ruler setting to every list row.
  if(new Set([value,...peers].map(v=>(v.paragraph as Partial<ParagraphIR>|undefined)?.defaultTab)).size>1)parts.push(p?.defaultTab===undefined?'Табуляция по умолчанию':`Шаг табуляции ${points(p.defaultTab)}`)
  return parts.filter(Boolean).join(' · ')
}
