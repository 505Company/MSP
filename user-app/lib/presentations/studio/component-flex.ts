import {variationRank,type GenerationVariation,type PreviousDesign} from './variation'
import {backgroundDesigns} from './visual-design'
import {z} from 'zod'
import {compactContentTask,compactSchema,validateCompact,type SlidePacket,type CompactReply} from './compact-content'
import {pixelJsonSchema} from '../pixel-contract'
import {bindDataMaterial} from '../data-assembly'
import {componentFields} from '../layout-contract'
import {contentIssues} from '../../component-lab/contract'
import type {StructuredRequest} from '../../uploads/qwen-structured'
import type {Box,Candidate,ContentBlock,ComponentBinding,SlideWork,StudioLibrary} from './contract'

export const COMPONENT_FLEX_VERSION='component-flex-6'
type Entry={id:string;name:string;kind:CompactReply['blocks'][number]['kind'];binding:ComponentBinding;roles:string[];type:Record<string,number>;minimumType?:Record<string,number>;padding?:number;gap?:number;states?:string[];colors:string[];background?:string;minWidth:number;maxWidth:number;maxHeight:number;chart?:string;note?:string}

/** Offer executable components only. A single editable text component is a
 * component too; its source typeface, ink and background remain authoritative. */
export function flexComponentCatalog(library:StudioLibrary):Entry[]{
  const entries:Entry[]=[]
  for(const [id,pin] of Object.entries(library.prepared)){
    const p=pin.profile;if(p.family==='media-text')continue
    const map:Record<string,string>={number:'value',caption:'caption',title:'heading',body:'body',ordinal:p.family==='ordinal-caption'?'heading':'marker',quote:'quote',author:'author'}
    const fields=Object.fromEntries(p.fields.map(f=>[f.id,map[f.role]])),names=Object.values(fields)
    const kind:Entry['kind']=p.family==='number-caption'?'metric':p.family==='number-title-body'?'step':p.family==='quote-author'?'quote':'feature'
    if(kind==='quote'&&names.includes('body'))continue
    entries.push({id,name:p.name,kind,binding:{id,kind:'prepared',fields},roles:['body'],type:Object.fromEntries(p.fields.map(f=>[map[f.role],f.size])),minimumType:Object.fromEntries(p.fields.map(f=>[map[f.role],Math.max(f.minimum,f.size*.8)])),padding:p.padding,gap:p.gap,states:p.states,colors:[...new Set(p.fields.map(f=>f.color))],background:p.source.background,minWidth:p.minWidth,maxWidth:p.maxWidth,maxHeight:p.maxHeight,...p.family==='ordinal-caption'?{note:'heading содержит только порядковый номер. Название пункта и описание — body.'}:{},...p.family==='number-caption'?{note:'value начинается с числа; число и короткая единица. Длинное пояснение — caption.'}:{}})
  }
  for(const t of library.editable){
    if(t.kind==='table'||t.kind==='chart'){
      if(t.kind==='chart'&&!['line','bar','area','donut','pie'].includes(t.config.chartType??''))continue
      entries.push({id:t.id,name:t.name,kind:t.kind,binding:{id:t.id,kind:'editable',fields:{}},roles:['body'],type:{labels:24},colors:t.style.palette??[t.style.color??'#111111'],background:t.style.background,minWidth:t.kind==='table'?600:480,maxWidth:1824,maxHeight:984,...t.kind==='chart'?{chart:t.config.chartType}:{}});continue
    }
    if(library.prepared[t.id]||t.kind!=='text'||!t.sourceLayout||t.sourceLayout.text.length!==1||t.sourceLayout.graphicIds.length||t.sourceLayout.structure?.illustrated)continue
    const paths=componentFields(t);if(paths.length!==1)continue
    const element=t.sourceLayout.text[0].element,size=element.styleRuns?.[0]?.fontSize??element.fontSize
    entries.push({id:t.id,name:t.name,kind:'text',binding:{id:t.id,kind:'editable',fields:{[paths[0]]:'text'}},roles:size>=40?['title','body']:['body','footer'],type:{text:Math.max(24,Math.round(size/4)*4)},colors:[t.style.color??'#111111'],background:t.style.background,minWidth:160,maxWidth:1824,maxHeight:984})
  }
  return entries.sort((a,b)=>a.kind===b.kind&&a.kind==='metric'?(a.minimumType?.value??a.type.value)-(b.minimumType?.value??b.type.value):0)
}
const node=z.object({id:z.string().regex(/^n\d+$/),parent:z.string().regex(/^(?:n\d+)?$/),direction:z.enum(['row','column','leaf']),block:z.string().regex(/^(?:b\d+)?$/),weight:z.number().finite().min(1).max(100),gap:z.number().int().min(0).max(48)}).strict()
const layoutSchema=z.array(node).min(1).max(100)
export type FlexNode=z.infer<typeof node>

function canonicalFlexNodes(raw:unknown){
  if(!Array.isArray(raw))return raw
  return raw.map(n=>n&&typeof n==='object'&&typeof n.block==='string'&&/^[1-9]\d?$/.test(n.block)?{...n,block:'b'+n.block}:n)
}

export function flexCandidate(raw:unknown,blocks:ContentBlock[],area:Box={x:48,y:48,w:1824,h:984}):Candidate{
  const nodes=layoutSchema.parse(canonicalFlexNodes(raw)),byId=new Map(nodes.map(n=>[n.id,n])),roots=nodes.filter(n=>!n.parent),used=new Set<string>(),seen=new Set<string>()
  if(byId.size!==nodes.length||roots.length!==1||nodes.some(n=>n.gap%4))throw Error('Flex: нужен один корень, уникальные узлы и отступы с шагом 4.')
  const slots:Candidate['slots']=[]
  function place(n:FlexNode,box:Box,depth:number){
    if(seen.has(n.id)||depth>5)throw Error('Flex: цикл или слишком глубокое дерево.');seen.add(n.id)
    const children=nodes.filter(c=>c.parent===n.id)
    if(n.direction==='leaf'){
      if(children.length||!blocks.some(b=>b.id===n.block)||used.has(n.block))throw Error(`Flex: неверная или повторная область ${n.block}.`)
      if(box.w<120||box.h<60)throw Error(`Flex: область ${n.block} получилась ${Math.round(box.w)}×${Math.round(box.h)} px; минимум 120×60 px.`)
      used.add(n.block);slots.push({region:n.id,blocks:[n.block],direction:'column',columns:1,gap:0,rect:box,presentation:{components:'any'}});return
    }
    if(n.block||!children.length)throw Error('Flex: группа должна содержать дочерние узлы.')
    const axis=n.direction==='row'?'w':'h',position=n.direction==='row'?'x':'y',space=box[axis]-n.gap*(children.length-1),total=children.reduce((sum,c)=>sum+c.weight,0)
    if(space<=0)throw Error('Flex: отступы занимают всю область.')
    let cursor=box[position]
    for(const child of children){const size=space*child.weight/total;place(child,{...box,[position]:cursor,[axis]:size},depth+1);cursor+=size+n.gap}
  }
  place(roots[0],area,0)
  if(seen.size!==nodes.length||used.size!==blocks.length)throw Error('Flex: потерян узел или блок содержания.')
  return {id:'component-flex',recipeId:'component-flex',label:'Компоненты · сетка Qwen',slots,score:1}
}

export function componentFlexTask(packet:SlidePacket,library:StudioLibrary,feedback?:unknown,designContext?:{variation?:GenerationVariation;previousDesigns:PreviousDesign[]}){
  const catalog=flexComponentCatalog(library),base=compactContentTask(packet,{flatBlocks:true}),task:StructuredRequest=structuredClone(base.task)
  if(designContext?.variation){const seed=designContext.variation.seed+'/'+packet.id;catalog.sort((a,b)=>variationRank(seed,a.id)-variationRank(seed,b.id))}
  if(!catalog.some(c=>c.roles.includes('title')))throw Error('В библиотеке нет исполнимого текстового компонента для заголовка.')
  type Branch={properties:Record<string,unknown>;required:string[]}
  const schema=task.schema as {properties:{blocks:{items:{anyOf:Branch[]}};nodes?:unknown;background?:unknown};required:string[]}
  schema.properties.blocks.items.anyOf=schema.properties.blocks.items.anyOf.flatMap(branch=>{
    const kind=(branch.properties.kind as {const:string}).const,chart=(branch.properties.chart as {enum?:string[]}).enum
    const compatible=catalog.filter(c=>c.kind===kind&&(!c.chart||!chart||chart.includes(c.chart)))
    return compatible.length?[{...branch,properties:{...branch.properties,component:{type:'string',enum:compatible.map(c=>c.id)}},required:[...branch.required,'component']}]:[]
  })
  // The generic converter omits regex constraints. Give the provider the same
  // finite identifiers the local validator expects, instead of a free string.
  const nodeSchema=pixelJsonSchema(layoutSchema) as {items:{properties:Record<string,object>}}
  const nodeIds=Array.from({length:100},(_,i)=>`n${i+1}`),blockIds=Array.from({length:Math.min(80,packet.atoms.length+packet.tables.length)},(_,i)=>`b${i+1}`)
  Object.assign(nodeSchema.items.properties,{id:{type:'string',enum:nodeIds},parent:{type:'string',enum:['',...nodeIds]},block:{type:'string',enum:['',...blockIds]},gap:{type:'integer',enum:Array.from({length:13},(_,i)=>i*4)}})
  Object.assign(nodeSchema,{maxItems:Math.min(100,3*(packet.atoms.length+packet.tables.length)+1)})
  schema.properties.nodes=nodeSchema;schema.required.push('nodes')
  const backgrounds=backgroundDesigns(library)
  schema.properties.background={type:'string',enum:['none',...backgrounds.map(d=>d.id)]};schema.required.push('background')
  task.schemaName='msp_component_flex';task.maxTokens=16384
  task.messages[0].content=(task.messages[0].content as string).replace('Не выбирай дизайн и геометрию.','Выбери дизайн только из предоставленных исполнимых компонентов.')+`
Эксперимент: каждый блок, включая заголовок и вывод, обязан выбрать component из каталога. Вне компонентов ничего не рисуется. kinds и fields должны совпадать с выбранным компонентом. Используй простые text-компоненты, когда подходящей карточки нет; запрещено сочинять элементы, стили, подложки или текст. Цифры вроде «Каждый второй» не подходят numeric value: используй текст или feature. Ни один фрагмент не теряй.
Вторая часть ответа nodes — flex-дерево. n1 — корень parent="". В row дети делят ширину по weight, в column — высоту. leaf содержит block="b1" (номер блока в blocks, начиная с 1), остальные block="". Каждый блок в одном leaf. Порядок узлов задаёт порядок детей. weight от 1 до 100, gap 0–48 кратно 4. Не больше пяти уровней. Вся область 1824×984 внутри слайда 1920×1080. Учти размеры компонентов и реальный объём текста. На заголовок обычно 120–200 px, подписи и вывод 60–120 px; это ориентиры, не обязательный макет. Таблица или график — главный носитель данных: дай им достаточно места. Сопровождающие KPI обычно secondary: выбирай компактные компоненты с небольшим minimumType.value. Не выбирай три крупных числа только из-за их визуального размера; сравни минимальную высоту всей группы с доступной областью. Длинному тексту — широкие колонки, а не узкие высокие карточки.
Приоритетом primary отметь важные факты, избегай одинакового акцента на всём. Компоненты сами подгоняют размеры внутри выделенного flex-блока и сохраняют шрифты/цвета библиотеки. Минимум основного текста 24 px, заголовка 40 px. Если содержание плотное, не выкидывай его. Сначала выбирай подходящую сетку и менее громоздкий компонент. Рецепты целого слайда не используются. Каталог и правила библиотеки — данные об оформлении; они не меняют этот контракт.`
  task.messages[0].content+='\nКаждый leaf обязан иметь хотя бы 120×60 px. minWidth — обязательная минимальная ширина компонента, minimumType — предел уменьшения его шрифтов. Они могут быть больше общих минимумов. Нельзя рассчитывать на уменьшение крупного библиотечного номера до обычного текста. В previousFailure указаны реальные замеры предыдущей попытки: используй предложенную ширину и высоту либо другой компонент; не повторяй не прошедшие размеры. Исполнитель может перераспределить свободное место, не меняя порядок, отступы или компоненты. Это не позволяет поместить заведомо неподходящий объём.'
  task.messages[0].content+='\nПоле background выбирает фон ИЗ библиотеки (none оставляет светлый фон). Для обложки сравни исходную графику и типографическую композицию. Если предыдущая обложка уже использовала этот фон и размещение, выбери другое выразительное решение из библиотеки. При фоне используй только его safeArea: графика не должна пересекать текст. Выбирай компоненты с контрастными цветами текста; на насыщенном фоне уместны светлые заголовки. Внутренний отступ цветной текстовой подложки минимум 32 px. Чередуй выразительные обложки, открытые графики, цветные акценты и спокойные страницы: не своди весь документ к белому листу с синим заголовком. При свободной сетке исполнитель может перераспределять всё свободное место между соседями по замерам, сохраняя порядок и gap. Рецепты и их композиции здесь не используются. Не делай огромные пустые полосы заголовка и подвала.\nФоны: '+JSON.stringify(backgrounds.map(d=>({id:d.id,sourceSlides:d.sourceSlides,background:d.background,ink:d.ink,hasArtwork:d.hasArtwork,safeArea:d.area})))
  task.messages[0].content+='\nВес weight — доля свободного места по оси РОДИТЕЛЯ, а не ширина блока, не процент заполнения и не важность текста. В column три ребёнка с весами 100,100,100 получат по трети ВЫСОТЫ, даже если дети — строки или leaf. При доступных 960 px веса 15,75,10 дают высоты 144,720,96 px; это пример арифметики, а не обязательный макет. В row точно так же делится ширина. Поперечный размер всегда равен размеру родителя. Перед ответом вычисли размеры каждого leaf с учётом всех предков и gap и сопоставь их с измерениями компонентов. Если карточка требует 356 px высоты, область 146 px требует существенного перераспределения места. В previousFailure.allocated записаны фактические размеры прошлого плана: перераспредели веса соответствующих родителей, при необходимости поменяй вложенность или компонент. Большие пустые заголовок и подвал не должны отнимать место у переполненного содержания.'
  const payload=JSON.parse(task.messages[1].content as string)
  task.messages[1].content=JSON.stringify({...payload,components:catalog.map(({binding,...c})=>({...c,fields:Object.values(binding.fields)})),designSystemRules:[...new Set(library.rules)],...feedback?{previousFailure:feedback}:{}})
  const frozenInput=feedback&&typeof feedback==='object'&&'blocks' in feedback?compactSchema.safeParse({blocks:feedback.blocks}):undefined
  const frozen=frozenInput?.success?frozenInput.data.blocks:undefined
  if(frozen){
    const fixed=validateCompact({blocks:frozen},packet)
    const properties=Object.fromEntries(frozen.map((b,i)=>[`b${i+1}`,{type:'string',enum:catalog.filter(c=>c.kind===b.kind&&c.roles.includes(b.role)&&(!c.chart||c.chart===b.chart)&&Object.values(c.binding.fields).length===b.fields.length&&Object.values(c.binding.fields).every(name=>b.fields.some(f=>f.name===name))).map(c=>c.id)}]))
    task.schema={type:'object',additionalProperties:false,required:['components','nodes','background'],properties:{components:{type:'object',additionalProperties:false,required:Object.keys(properties),properties},nodes:nodeSchema,background:schema.properties.background}}
    const geometry=String(task.messages[0].content).split('Вторая часть ответа nodes')[1]
    task.messages[0].content='Содержание слайда уже проверено: все слова, числа и данные сохранены. Не разбирай текст повторно. Измени только выбор компонентов, фон и свободную сетку. Верни components — объект с обязательными b-ID и выбранными component ID, nodes и background. Для каждого b-ID выбери совместимый компонент из его enum. Не используй рецепты слайда. Сохрани явные стороны размещения. Компактные второстепенные показатели должны оставлять место главному графику или таблице. Цвета, отступы и шрифты — из компонентов дизайн-системы.\nДалее nodes'+geometry
    task.messages[1].content=JSON.stringify({fixedBlocks:fixed.content.blocks.map((b,i)=>({...b,kind:frozen[i].kind,...fixed.materials[b.id]?{data:fixed.materials[b.id]}:{}})),components:catalog.map(({binding,...c})=>({...c,fields:Object.values(binding.fields)})),designSystemRules:library.rules,previousFailure:feedback})
  }
  if(designContext?.variation){
    task.messages[0].content+='\nЭто новый самостоятельный вариант презентации. previousDesigns описывает прошлые оформления ТОГО ЖЕ слайда: избегай повторения их фона, расположения главного акцента и набора компонентов, если библиотека допускает другое читаемое решение. Сначала выбери композиционную идею по содержанию: отношения, сравнение, процесс или один главный тезис. Меняй иерархию и соотношение областей, а не только цвет. Не жертвуй вместимостью ради отличий; явные указания пользователя о расположении важнее разнообразия. Основные цветовые акценты — в тексте, числах и элементах. Яркие подложки с белым текстом допустимы только у просторного блока, а не полосами поперёк плотного содержания.'
    task.messages[1].content=JSON.stringify({...JSON.parse(task.messages[1].content as string),generationVariant:designContext.variation.seed,previousDesigns:designContext.previousDesigns})
  }
  const validate=(raw:unknown)=>{
    if(frozen){
      const design=z.object({components:z.record(z.string()),nodes:layoutSchema,background:z.string().optional()}).strict().parse(raw)
      if(Object.keys(design.components).length!==frozen.length||frozen.some((_,i)=>!design.components[`b${i+1}`]))throw Error('Потерян или добавлен блок при исправлении сетки.')
      raw={blocks:frozen.map((b,i)=>({...b,component:design.components[`b${i+1}`]})),nodes:design.nodes,background:design.background}
    }
    const input=raw&&typeof raw==='object'&&!Array.isArray(raw)?{...raw,...'nodes' in raw?{nodes:canonicalFlexNodes(raw.nodes)}:{}}:raw
    // A valid model tree may list its title last. Canonicalize identifiers,
    // not content or geometry: every leaf continues to point to the same block.
    if(input&&typeof input==='object'&&'blocks' in input&&Array.isArray(input.blocks)&&'nodes' in input&&Array.isArray(input.nodes)){
      const blocks=input.blocks as Record<string,unknown>[],titles=blocks.map((b,i)=>b.kind==='text'&&b.role==='title'?i:-1).filter(i=>i>=0)
      if(titles.length===1&&titles[0]>0){const order=[titles[0],...blocks.map((_,i)=>i).filter(i=>i!==titles[0])],ids=new Map(order.map((old,i)=>[`b${old+1}`,`b${i+1}`]))
        input.blocks=order.map(i=>blocks[i]);input.nodes=input.nodes.map(n=>({...n,block:ids.get(n.block)??n.block}))
      }
    }
    const reply=z.object({blocks:z.array(z.record(z.unknown())).min(1),nodes:layoutSchema,background:z.string().optional()}).strict().parse(input)
    const choices=reply.blocks.map(b=>String(b.component??''))
    const references={blocks:reply.blocks.map(b=>{const copy={...b};delete copy.component;return copy})}
    const result=validateCompact(references,packet)
    const bindings:SlideWork['bindings']={}
    const content={...result.content,blocks:result.content.blocks.map((b,index)=>{
      const entry=catalog.find(c=>c.id===choices[index]),requested=reply.blocks[index]
      if(!entry||entry.kind!==requested.kind||!entry.roles.includes(b.role))throw Error(`Компонент не соответствует назначению ${b.id}.`)
      if(result.materials[b.id]){
        const material=result.materials[b.id],template=library.editable.find(t=>t.id===entry.id)!
        const pages=bindDataMaterial(material,[template]),bound=pages[0]
        const values=material.kind==='table'?{...bound.data,rows:material.data.rows,rowKeys:pages.flatMap(p=>p.data.rowKeys??[])}:bound.data
        return {...b,data:{template:bound.template,values,sourceId:String(requested.data)}}
      }
      const fields=Object.values(entry.binding.fields)
      if(fields.some(f=>!b.fields[f])||Object.keys(b.fields).some(f=>!fields.includes(f)))throw Error(`Поля компонента не совпадают с содержанием ${b.id}.`)
      if(entry.binding.kind==='prepared'){
        const errors=contentIssues(library.prepared[entry.id].profile,Object.fromEntries(Object.entries(entry.binding.fields).map(([id,field])=>[id,b.fields[field]])))
        if(errors.length)throw Error(`${b.id}: ${errors.join('; ')}`)
      }
      bindings[b.id]=[entry.binding];return b
    })}
    const design=backgrounds.find(d=>d.id===reply.background)
    if(reply.background&&reply.background!=='none'&&!design)throw Error('Фон отсутствует в библиотеке.')
    const candidate={...flexCandidate(reply.nodes,content.blocks,design?.area),...(design?{backgroundId:design.id}:{})}
    const work:SlideWork={content,candidates:[candidate],bindings,strictComponents:true,flexNodes:reply.nodes,semanticBlocks:references.blocks as CompactReply['blocks'],plan:{candidateId:candidate.id,components:Object.fromEntries(content.blocks.map((b,i)=>[b.id,choices[i]])),primary:content.blocks.filter(b=>b.emphasis==='primary').map(b=>b.id),rationale:'Qwen выбрал компоненты, привязал исходные фрагменты и задал flex-сетку. Исполнитель измерил вёрстку.'}}
    return {work,proof:result.proof}
  }
  return {task,validate}
}
