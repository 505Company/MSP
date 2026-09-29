import type { TextElementIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot } from '../digital-designer/source-types'
import type { DesignAnalysis } from '../digital-designer/design-analysis'
import knowledge from '../digital-designer/knowledge.json'
import { compileLibrary, flatten } from './compiler'
import type { ComponentLibrary } from './types'
import { readSourceScene, neutralContainer, nativeListMarker, type SourceScene } from './source-scene'
import type { SemanticMetadata } from './semantic-library'
import { typographyStyleValue } from './source-typography'

export const SOURCE_SYSTEM_VERSION='web-source-system-5'
type Occurrence={elementId:string;slide:number;start?:number;end?:number}
export type SourceStyle={id:string;kind:'fill'|'stroke'|'gradient'|'typography'|'text-color'|'geometry'|'effect';name:string;value:Record<string,unknown>;occurrences:Occurrence[];findingIds:string[]}
export type SourceLedgerEntry={elementId:string;slide:number;name:string;kind:string;status:'source-resource'|'hidden'|'outside-slide'|'invalid'|'table'|'table-part'|'container'|'represented'|'unresolved';componentIds:string[];styleIds:string[];findingIds:string[];reason?:string}
export type SourceConstruction={id:string;rootId:string;name:string;slide:number;kind:'atom'|'compound'|'table'|'table-part';elementIds:string[];ancestorIds:string[];memberIds:string[];assetIds:string[];slotIds:string[];fixedTextIds:string[];available:boolean;reason?:string}
export type SourceRule={id:string;name:string;interpretation:string;status:'candidate';basis:string;sourceTexts:{elementId:string;slide:number;text:string}[];elementIds:string[];allowed:string[];forbidden:string[]}
export type SourceText={id:string;text:string;occurrences:Occurrence[];status:'unassessed'|'rule-candidate'|'fixed-marker'|'too-large';findingIds:string[]}
type ScanNode={id:string;parentId?:string;slide:number;kind:string;properties:Record<string,unknown>;styleIds:string[]}
export type ScanBatch={id:string;bytes:number;nodes:ScanNode[];sourceGroups:{id:string;parts:string[]}[];context:ScanNode[]}
export type SourceSystem={
  schemaVersion:1;version:string;sourceId:string;name:string
  semantic?:SemanticMetadata
  summary:{records:number;drawable:number;visible:number;accounted:number;unresolved:number;styles:number;constructions:number;tables:number;resources:number;semanticLinked:number;incompleteSlides:number}
  incompleteSlideNumbers:number[]
  assemblyIssues:NonNullable<ComponentLibrary['assemblyIssues']>
  styles:SourceStyle[];constructions:SourceConstruction[];ledger:SourceLedgerEntry[];rules:SourceRule[];texts:SourceText[]
  resources:{id:string;mime:string;bytes:number;origins:string[];elementIds:string[];componentIds:string[];placements:{elementId:string;slide:number;properties:Record<string,unknown>}[]}[]
  scan:{batches:ScanBatch[];pending:{elementId:string;reason:string}[];suppliedIds:string[];retainedTableIds:string[];omittedContainerIds:string[]}
  coverage:{id:string;name:string;status:'candidate'|'not-assessed';findingIds:string[]}[]
  notes:string[]
}

function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
  return JSON.stringify(value)
}
const pick=(value:object,keys:string[])=>Object.fromEntries(Object.entries(value).filter(([k,v])=>keys.includes(k)&&v!==undefined))
const hex=(value:unknown)=>{
  const c=value as {r?:number;g?:number;b?:number}|undefined
  return c&&[c.r,c.g,c.b].every(n=>typeof n==='number')?'#'+[c.r!,c.g!,c.b!].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('').toUpperCase():''
}

/** Measured styles, including mixed runs and paragraphs, independently of
 * model coverage. Text-container layout is retained in the source and scan. */
function collectStyles(scene:SourceScene,findings:DesignAnalysis['findings']) {
  const styles:SourceStyle[]=[],keys=new Map<string,SourceStyle>()
  const add=(kind:SourceStyle['kind'],value:Record<string,unknown>,name:string,occurrence:Occurrence)=>{
    const key=canonical([kind,value]);let style=keys.get(key)
    if(!style){style={id:`style-${styles.length+1}`,kind,name,value,occurrences:[],findingIds:[]};keys.set(key,style);styles.push(style)}
    if(!style.occurrences.some(o=>canonical(o)===canonical(occurrence)))style.occurrences.push(occurrence)
  }
  for(const r of scene.records.values()){
    if(r.disposition!=='visible')continue
    const e=r.element,occurrence={elementId:e.id,slide:r.source.slide}
    if('fill' in e&&e.fill&&e.fill.color.a>0)add('fill',e.fill as unknown as Record<string,unknown>,hex(e.fill.color),occurrence)
    if('gradient' in e&&e.gradient)add('gradient',e.gradient as unknown as Record<string,unknown>,e.gradient.type==='linear'?'Линейный градиент':'Радиальный градиент',occurrence)
    if('stroke' in e&&e.stroke&&e.stroke.width>0&&e.stroke.paint.color.a>0)add('stroke',e.stroke as unknown as Record<string,unknown>,`${hex(e.stroke.paint.color)} · ${e.stroke.width} px`,occurrence)
    if(e.effects?.length||e.blur)add('effect',{effects:e.effects??[],blur:e.blur??0},'Эффект источника',occurrence)
    if(['rectangle','ellipse','path','line'].includes(e.kind)){
      const value=pick(e,['kind','pathData','windingRule','pattern'])
      // Only intrinsic shape geometry: slide placement is not a design token.
      if(e.kind==='path')Object.assign(value,{width:e.bounds.width,height:e.bounds.height})
      add('geometry',value,e.kind==='path'?'Контур источника':e.kind==='ellipse'?'Эллипс':e.kind==='line'?'Линия':'Прямоугольник',occurrence)
    }
    if(e.kind!=='text'||!e.text.trim())continue
    for(const run of e.colorRuns??[]){if(run.fill.color.a>0)add('text-color',run.fill as unknown as Record<string,unknown>,hex(run.fill.color),{...occurrence,start:run.start,end:run.end})}
    const cuts=new Set([0,e.text.length,...(e.styleRuns??[]).flatMap(r=>[r.start,r.end]),...(e.paragraphs??[]).flatMap(p=>[p.start,p.end])])
    const ranges=[...cuts].sort((a,b)=>a-b)
    for(let i=0;i<ranges.length-1;i++){
      const start=ranges[i],end=ranges[i+1];if(!e.text.slice(start,end).trim())continue
      const run=e.styleRuns?.find(r=>r.start<=start&&r.end>=end)
      const paragraph=e.paragraphs?.find(p=>p.start<=start&&p.end>=end)
      const value=typographyStyleValue(e,run,paragraph)
      add('typography',value,`${value.fontFamily} ${value.fontStyle} · ${Math.round(Number(value.fontSize)*.75*100)/100} pt`,{...occurrence,start,end})
    }
  }
  for(const style of styles){const ids=new Set(style.occurrences.map(o=>o.elementId));style.findingIds=findings.filter(f=>f.kind==='token'&&f.evidence.elementIds.some(id=>ids.has(id))).map(f=>f.id)}
  return styles
}

/** Borrow v13's bounded complete map: never truncate a long text into apparent
 * completeness. Oversized nodes stay explicitly pending, and neutral wrappers
 * leave only the model payload, not the scene or ledger. No request is sent. */
export function planSourceScan(scene:SourceScene,styles:SourceStyle[],maxBytes=32000,maxNodes=160):SourceSystem['scan'] {
  const stylesByNode=new Map<string,string[]>()
  for(const s of styles)for(const o of s.occurrences){const ids=stylesByNode.get(o.elementId)??[];if(!ids.includes(s.id))ids.push(s.id);stylesByNode.set(o.elementId,ids)}
  const pending:SourceSystem['scan']['pending']=[],omitted=new Set<string>(),tables=new Set<string>(),supplied:string[]=[],batches:ScanBatch[]=[]
  for(const r of scene.records.values())if(r.disposition==='visible'){
    if(r.tableId){tables.add(r.tableId);continue}
    if(neutralContainer(r.element))omitted.add(r.element.id)
  }
  const candidates=[...scene.records.values()].filter(r=>r.disposition==='visible'&&!omitted.has(r.element.id)&&!r.tableId)
  const groups=[...omitted].map(id=>({id,parts:(scene.children.get(id)??[]).flatMap(function expand(s):string[]{return omitted.has(s.id)?(scene.children.get(s.id)??[]).flatMap(expand):scene.records.get(s.id)?.disposition==='visible'&&!scene.records.get(s.id)?.tableId?[s.id]:[]})}))
  const nodeFor=(id:string):ScanNode=>{const r=scene.records.get(id)!;return {id,...(r.source.parentId?{parentId:r.source.parentId}:{}),slide:r.source.slide,kind:r.element.kind,properties:r.source.properties,styleIds:stylesByNode.get(id)??[]}}
  const make=(nodes:ScanBatch['nodes']):ScanBatch=>{
    const ids=new Set(nodes.map(n=>n.id)),contextIds=[...new Set(nodes.flatMap(n=>scene.records.get(n.id)!.ancestors.filter(id=>!ids.has(id))))]
    const known=new Set([...ids,...contextIds])
    const batch={id:`batch-${batches.length+1}`,nodes,sourceGroups:groups.filter(g=>g.parts.length>1&&g.parts.every(id=>known.has(id))),context:contextIds.map(nodeFor),bytes:0}
    batch.bytes=new TextEncoder().encode(JSON.stringify({...batch,bytes:undefined})).byteLength
    return batch
  }
  let current:ScanBatch['nodes']=[]
  const flush=()=>{if(current.length)batches.push(make(current));current=[]}
  for(const r of candidates){
    const e=r.element,node=nodeFor(e.id)
    if(make([node]).bytes>maxBytes){pending.push({elementId:e.id,reason:'Объект превышает размер пакета; полный текст и свойства сохранены, требуется отдельный разбор.'});continue}
    if(current.length&&(current.length>=maxNodes||make([...current,node]).bytes>maxBytes))flush()
    current.push(node);supplied.push(e.id)
  }
  flush()
  return {batches,pending,suppliedIds:supplied,retainedTableIds:[...tables],omittedContainerIds:[...omitted]}
}

/** An additive, platform-independent system. It references current web nodes
 * and keeps old component definitions, source files and decisions untouched. */
export function buildSourceSystem(snapshot:SourceSnapshot,analysis?:DesignAnalysis|null,currentLibrary?:ComponentLibrary):SourceSystem {
  const scene=readSourceScene(snapshot),findings=analysis?.sourceId===snapshot.sourceId?analysis.findings.filter(f=>f.evidence.elementIds.every(id=>scene.sources.has(id))&&f.evidence.assetIds.every(id=>snapshot.assets.some(a=>a.id===id))):[]
  const styles=collectStyles(scene,findings),library=currentLibrary??compileLibrary(snapshot,analysis,{maxComponents:Infinity})
  const constructions:SourceConstruction[]=library.components.map(c=>{
    const r=scene.records.get(c.source.rootId)
    const kind=r?.tableId?r.tableId===r.element.id?'table':'table-part':c.kind
    return {id:c.id,rootId:c.source.rootId,name:c.name,slide:c.source.slide,kind,elementIds:c.source.elementIds,ancestorIds:c.source.ancestorIds,memberIds:[],assetIds:c.source.assetIds,slotIds:c.slots.map(s=>s.id),fixedTextIds:c.fixedTextIds,available:true}
  })
  for(const c of constructions){
    const set=new Set(c.elementIds)
    c.memberIds=constructions.filter(m=>m.id!==c.id&&set.has(m.rootId)&&!constructions.some(between=>between.id!==c.id&&between.id!==m.id&&set.has(between.rootId)&&between.elementIds.includes(m.rootId))).map(m=>m.id)
  }
  for(const x of library.excluded){
    const s=scene.sources.get(x.elementId),r=scene.records.get(x.elementId),nodes=r?flatten([r.element]):[]
    constructions.push({id:`cmp-${x.elementId}`,rootId:x.elementId,name:s?.name??x.elementId,slide:s?.slide??1,kind:r?.tableId?r.tableId===r.element.id?'table':'table-part':'compound',elementIds:nodes.length?nodes.map(n=>n.id):[x.elementId],ancestorIds:r?.ancestors??[],memberIds:[],assetIds:[...new Set(nodes.filter(n=>n.kind==='raster').map(n=>n.assetId))],slotIds:[],fixedTextIds:[],available:false,reason:x.reason})
  }
  const byElement=new Map<string,string[]>(),byStyle=new Map<string,string[]>(),byFinding=new Map<string,string[]>()
  for(const c of constructions)if(c.available||c.kind==='table')for(const id of c.elementIds){const ids=byElement.get(id)??[];ids.push(c.id);byElement.set(id,ids)}
  for(const s of styles)for(const o of s.occurrences){const ids=byStyle.get(o.elementId)??[];if(!ids.includes(s.id))ids.push(s.id);byStyle.set(o.elementId,ids)}
  for(const f of findings)for(const id of f.evidence.elementIds){const ids=byFinding.get(id)??[];ids.push(f.id);byFinding.set(id,ids)}
  const rules:SourceRule[]=findings.filter(f=>f.kind==='rule').map(f=>({id:f.id,name:f.name,interpretation:f.value,status:'candidate',basis:f.evidence.basis,sourceTexts:f.evidence.elementIds.flatMap(id=>{const r=scene.records.get(id);return r?.element.kind==='text'?[{elementId:id,slide:r.source.slide,text:r.element.text}]:[]}),elementIds:f.evidence.elementIds,allowed:f.transforms.allowed,forbidden:f.transforms.forbidden}))
  const textMap=new Map<string,SourceText>()
  for(const r of scene.records.values())if(r.element.kind==='text'&&r.disposition==='visible'&&r.element.text.trim()){
    const e:TextElementIR=r.element,ruleIds=rules.filter(rule=>rule.sourceTexts.some(t=>t.elementId===e.id)).map(rule=>rule.id),marker=nativeListMarker(r,scene)
    const key=canonical([e.text,marker]),text=textMap.get(key)??{id:`text-${textMap.size+1}`,text:e.text,occurrences:[],status:marker?'fixed-marker':e.text.length>6000?'too-large':'unassessed',findingIds:[]}
    text.occurrences.push({elementId:e.id,slide:r.source.slide});text.findingIds=[...new Set([...text.findingIds,...ruleIds])]
    if(ruleIds.length)text.status='rule-candidate'
    textMap.set(key,text)
  }
  const ledger:SourceLedgerEntry[]=snapshot.elements.map(e=>{
    const r=scene.records.get(e.id),componentIds=byElement.get(e.id)??[],styleIds=byStyle.get(e.id)??[],findingIds=byFinding.get(e.id)??[]
    let status:SourceLedgerEntry['status']='unresolved',reason:string|undefined
    if(e.kind==='source-picture')status='source-resource'
    else if(scene.invalid.has(e.id)){status='invalid';reason=scene.invalid.get(e.id)}
    else if(r?.disposition==='hidden'||r?.disposition==='outside-slide')status=r.disposition
    else if(r?.tableId)status=r.tableId===e.id?'table':'table-part'
    else if(componentIds.length)status='represented'
    else if(r&&neutralContainer(r.element))status='container'
    else reason='Исходный объект сохранён; отдельного рабочего определения пока нет.'
    return {elementId:e.id,slide:e.slide,name:e.name,kind:e.kind,status,componentIds,styleIds,findingIds,...(reason?{reason}:{})}
  })
  const resources=snapshot.assets.map(a=>{
    const occurrences=snapshot.elements.filter(e=>e.properties.assetId===a.id)
    return {id:a.id,mime:a.mime,bytes:a.byteLength,origins:a.origins,elementIds:occurrences.map(e=>e.id),componentIds:constructions.filter(c=>c.assetIds.includes(a.id)).map(c=>c.id),placements:occurrences.map(e=>({elementId:e.id,slide:e.slide,properties:pick(e.properties,['bounds','crop','clipBounds','maskPreset','opacity','rotation','centeredTransform','sourcePart','sourceShapeId','sourceRef'])}))}
  })
  const scan=planSourceScan(scene,styles)
  const incompleteSlideNumbers=snapshot.slides.filter(s=>s.warnings.some(w=>w.startsWith('normalized-page-unavailable'))).map(s=>s.number)
  return {schemaVersion:1,version:SOURCE_SYSTEM_VERSION,sourceId:snapshot.sourceId,name:snapshot.name,styles,constructions,ledger,rules,texts:[...textMap.values()],resources,scan,incompleteSlideNumbers,assemblyIssues:library.assemblyIssues??[],
    summary:{records:ledger.length,drawable:ledger.filter(e=>e.kind!=='source-picture').length,visible:[...scene.records.values()].filter(r=>r.disposition==='visible').length,accounted:ledger.filter(e=>!['invalid','unresolved'].includes(e.status)).length,unresolved:ledger.filter(e=>['invalid','unresolved'].includes(e.status)).length,styles:styles.length,constructions:constructions.length,tables:scan.retainedTableIds.length,resources:resources.length,semanticLinked:ledger.filter(e=>e.findingIds.length).length,incompleteSlides:incompleteSlideNumbers.length},
    coverage:knowledge.catalogue.map(c=>{const ids=findings.filter(f=>f.categoryId===c.id).map(f=>f.id);return {id:c.id,name:c.name,status:ids.length?'candidate':'not-assessed',findingIds:ids}}),
    notes:[
      `Рабочие определения используют ${library.compilerVersion}. Уже сохранённые каталоги сохраняют свою версию; новые правила полей и таблиц действуют при новой сборке.`,
      'Каждая запись нормализованного снимка учтена отдельно. Неполностью прочитанные слайды указаны отдельно: отсутствие их объектов в снимке не считается успешным учётом. Структурная связь, измеренный стиль, гипотеза модели и принятие пользователем — разные состояния.',
      'Стили прочитаны из нормализованной сцены вместе с полными ссылками и диапазонами текста. Частота значения не устанавливает фирменную роль или правило.',
      'Видимость оценивается по свойствам, родителям и границам. Перекрытие другими фигурами и точная маска ещё требуют визуальной проверки.',
      'Таблица сохраняется целиком с сеткой и границами. Части таблицы доступны в учёте; автоматическое заполнение таблиц пока не поддерживается.',
      'Одинаковые тексты и ресурсы сохраняют все появления. Кадрирование и преобразования каждого появления не объединяются и не удаляются.',
      'Подготовлены полные ограниченные пакеты для дальнейшего анализа. Это не выполненный полный семантический разбор; модель автоматически не вызывается.',
      'Текстовые правила остаются кандидатами с точным исходным текстом. Пример текста, отдельное число и повторение сами по себе не доказывают запрет или правило.',
      ...snapshot.limitations,...snapshot.slides.flatMap(s=>s.warnings.map(w=>`Слайд ${s.number}: ${w}`))
    ]}
}
