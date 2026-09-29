import { parseSceneElements } from '../../vendor/drag/src/core/page-ir'
import type { ElementIR, GroupElementIR, TextElementIR, BoundsIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot, SourceElement } from '../digital-designer/source-types'
import type { DesignAnalysis } from '../digital-designer/design-analysis'
import type { ComponentDefinition, ComponentLibrary, ComponentIssue, TextSlot } from './types'
import { readSourceScene, nativeListMarker } from './source-scene'
import { fillTextFields } from './text-fields'

export const COMPILER_VERSION = 'web-components-2'
export function flatten(elements: ElementIR[]): ElementIR[] {
  return elements.flatMap(e => [e, ...('children' in e ? flatten(e.children) : [])])
}
export function visibleElements(elements: ElementIR[]): ElementIR[] {
  return elements.filter(e=>e.visible&&e.opacity>0).flatMap(e=>[e,...('children' in e?visibleElements(e.children):[])])
}

// Text shape support is separate from content semantics. A number may be data;
// only a proven native marker is punctuation. Resource/rule checks follow below.
export function editableText(e: TextElementIR): boolean {
  if (!e.text.trim()) return false
  if (e.linkRuns?.length || e.text.includes('\t') || (e.paragraphs?.length ?? 0) > 1 || e.paragraphs?.some(p => p.markerLength || p.tabs?.length || p.indent !== 0)) return false
  const uniform = (runs: { start: number; end: number }[] | undefined) => !runs?.length || runs.length === 1 && runs[0].start === 0 && runs[0].end === e.text.length
  return uniform(e.styleRuns) && uniform(e.colorRuns) && (e.flow?.columns ?? 1) === 1
}

type Matrix = [number, number, number, number, number, number]
const identity: Matrix = [1, 0, 0, 1, 0, 0]
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
}
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
function transform(e: ElementIR): Matrix {
  const { x, y, width, height } = e.bounds, r = e.rotation * Math.PI/180
  const rotation: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
  const t = e.centeredTransform
  return t ? multiply(multiply(multiply(multiply(translate(x+width/2,y+height/2), rotation), [t.flipH?-1:1,0,0,t.flipV?-1:1,0,0]), translate(-width/2,-height/2)), identity) : multiply(translate(x,y),rotation)
}
function corners(b: BoundsIR, m: Matrix) {
  return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y]) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]])
}

function componentScene(root: ElementIR, ancestors: GroupElementIR[]) {
  let context = identity
  for (const e of ancestors) context = multiply(context,transform(e))
  const points: number[][] = []
  const visit = (e: ElementIR, parent: Matrix) => {
    if (!e.visible || e.opacity === 0) return
    const m = multiply(parent,transform(e)), pad = 'stroke' in e ? (e.stroke?.width ?? 0)/2 : 0
    points.push(...corners({x:-pad,y:-pad,width:e.bounds.width+2*pad,height:e.bounds.height+2*pad},m))
    if ('children' in e && !e.clipsContent) e.children.forEach(c => visit(c,m))
  }
  visit(root,context)
  const minX=Math.min(...points.map(p=>p[0])), minY=Math.min(...points.map(p=>p[1]))
  const width=Math.max(...points.map(p=>p[0]))-minX, height=Math.max(...points.map(p=>p[1]))-minY
  if (!Number.isFinite(width+height) || width<=0 || height<=0 || width>10000 || height>10000) throw new Error('Размер конструкции не поддерживается')
  let branch = structuredClone(root)
  // Context ancestors preserve their transforms, opacity and clipping, but no siblings.
  for (const a of [...ancestors].reverse()) branch = {...structuredClone(a),children:[branch]}
  const wrapper: GroupElementIR = {id:'component-viewport',name:'Viewport',kind:'group',bounds:{x:minX===0?0:-minX,y:minY===0?0:-minY,width,height},rotation:0,opacity:1,visible:true,zIndex:0,children:[branch]}
  return {width,height,elements:[wrapper]}
}

export function unsupported(nodes: ElementIR[], snapshot: SourceSnapshot, slide: number): ComponentIssue[] {
  const issues: ComponentIssue[]=[]
  for (const e of nodes) {
    const add=(code:string,message:string)=>issues.push({code,message,elementId:e.id})
    if (e.effects?.length || e.blur) add('effects','Тени и размытие ещё не воспроизводятся исполнителем.')
    if ('tableGrid' in e && e.tableGrid) add('table-layout','Динамическое заполнение таблиц ещё не проверено.')
    if (e.kind==='chart') add('chart','Диаграмма сохранена как исходная группа; её данные пока не редактируются.')
    if (e.kind==='text' && (e.textBox?.align==='JUSTIFIED' || e.paragraphs?.some(p=>p.align==='JUSTIFIED'))) add('justified','Выравнивание текста по ширине пока не воспроизводится.')
    if (e.kind==='raster' && !['image/png','image/jpeg'].includes(snapshot.assets.find(a=>a.id===e.assetId)?.mime ?? '')) add('asset-format','Формат ресурса ещё не поддерживается исполнителем.')
  }
  if (snapshot.slides.find(s=>s.number===slide)?.warnings.length) issues.push({code:'source-warning',severity:'warning',message:'Читатель сообщил об ограничениях на исходном слайде. Сверьте компонент с PPTX.'})
  return issues
}

/** Observed groups are candidates, never automatically accepted semantic components. */
export function compileLibrary(snapshot: SourceSnapshot, analysis?: DesignAnalysis | null, options: { maxComponents?: number; componentId?: string } = {}): ComponentLibrary {
  const sourceScene=readSourceScene(snapshot)
  const findings=analysis?.sourceId===snapshot.sourceId?analysis.findings.filter(f=>f.evidence.elementIds.length&&f.evidence.elementIds.every(id=>sourceScene.records.has(id))):[]
  const rules=new Set(findings.filter(f=>f.kind==='rule'&&f.evidence.basis==='measured').flatMap(f=>f.evidence.elementIds.filter(id=>sourceScene.records.get(id)?.element.kind==='text')))
  const graphics=new Set(findings.filter(f=>f.kind==='asset'&&f.evidence.basis==='visual_observation').flatMap(f=>f.evidence.elementIds))
  const fixedReason=(e:TextElementIR)=>{
    const r=sourceScene.records.get(e.id)!
    if(r.tableId)return 'Текст входит в нативную таблицу; отдельный контракт заполнения ещё не поддерживается.'
    if(nativeListMarker(r,sourceScene))return 'Нативный маркер списка сохраняется вместе с абзацем.'
    if(rules.has(e.id))return 'Текст указан источником измеренного кандидата правила оформления.'
    if([e.id,...r.ancestors].some(id=>graphics.has(id)))return 'Текст находится внутри графического ресурса, указанного моделью; это не поле содержания.'
    if(!editableText(e))return 'Сложный текст требует отдельного поведения при заполнении; исходник сохранён.'
    return null
  }
  const library:ComponentLibrary={schemaVersion:1,compilerVersion:COMPILER_VERSION,sourceId:snapshot.sourceId,name:snapshot.name,tokens:{colors:snapshot.colors,fonts:snapshot.fonts},components:[],excluded:[],notes:[
    'Группы сохраняют наблюдаемую структуру PPTX. Повторяемость и универсальность не утверждаются.',
    'Поля сохраняют размеры и стиль исходника. Автоматическое сокращение и уменьшение нового текста отключены.',
    'Сложный текст, нативные маркеры, текстовые правила и надписи внутри обозначенной графики сохраняются без редактирования. Число само по себе не считается маркером.',
    'Нативные таблицы предлагаются целиком. Внутренние ячейки не становятся отдельными конструкциями. Превью — реконструкция, её нужно сверить с исходником.'
  ]}
  const all=new Map(snapshot.elements.map(e=>[e.id,e])), children=new Map<string,SourceElement[]>()
  if (all.size!==snapshot.elements.length) throw new Error('Повторяющиеся ID объектов')
  for (const e of snapshot.elements) {
    if(e.parentId){const p=all.get(e.parentId);if(!p||p.slide!==e.slide)throw new Error('Некорректная связь исходных объектов')}
    const list=children.get(e.parentId??'')??[];list.push(e);children.set(e.parentId??'',list)
    const seen=new Set([e.id]);let parent=e.parentId
    while(parent){if(seen.has(parent)||seen.size>64)throw new Error('Цикл или слишком глубокая вложенность');seen.add(parent);parent=all.get(parent)?.parentId}
  }
  const rawTree=(e:SourceElement):unknown=>({...e.properties,id:e.id,name:e.name,kind:e.kind,...(['group','table','chart'].includes(e.kind)?{children:(children.get(e.id)??[]).filter(c=>c.kind!=='source-picture').map(rawTree)}:{})})
  for (const top of children.get('')??[]) {
    if(top.kind==='source-picture') continue
    try {
      const parsed=parseSceneElements([rawTree(top)])[0]
      const walk=(root:ElementIR,ancestors:GroupElementIR[])=>{
        if(!root.visible||root.opacity===0)return
        const nodes=flatten([root]), leaves=visibleElements([root]).filter(e=>!('children' in e))
        const group='children' in root
        const meaningful=group?leaves.length>0&&(ancestors.length===0||root.children.length>=2&&leaves.length>=2):ancestors.length===0
        const compound=leaves.length>=2
        if(meaningful && (!options.componentId || options.componentId === `cmp-${root.id}`)){
          if(library.components.length>=(options.maxComponents??150) || nodes.length>250){library.excluded.push({elementId:root.id,reason:nodes.length>250?group&&root.tableGrid?'В таблице больше 250 объектов. Весь состав сохранён; исполнение такой таблицы пока недоступно.':'В конструкции больше 250 объектов; выберите вложенную группу.':'Лимит прежнего формата библиотеки: 150 компонентов. Полный список доступен в каталоге.'})}
          else try {
            const slots:TextSlot[]=leaves.filter((e):e is TextElementIR=>e.kind==='text'&&!fixedReason(e)).map((e,i)=>({id:e.id,elementId:e.id,label:e.name||`Текст ${i+1}`,defaultText:e.text,policy:'fixed-box',maxLength:5000}))
            const assetIds=[...new Set(nodes.filter(e=>e.kind==='raster').map(e=>e.assetId))]
            if(assetIds.some(id=>!snapshot.assets.some(a=>a.id===id)))throw new Error('Не найден исходный ресурс')
            const ids=nodes.map(e=>e.id), leafIds=new Set(leaves.map(e=>e.id))
            const semantics=findings.filter(f=>(f.kind==='asset'||compound&&f.kind==='molecule') && f.evidence.elementIds.length>0 && f.evidence.elementIds.every(id=>ids.includes(id)) && (f.evidence.elementIds.includes(root.id)||leafIds.size===f.evidence.elementIds.length && f.evidence.elementIds.every(id=>leafIds.has(id)))).map(f=>({findingId:f.id,name:f.name,role:f.role,basis:f.evidence.basis}))
            const fixed=leaves.filter((e):e is TextElementIR=>e.kind==='text'&&!slots.some(s=>s.elementId===e.id))
            const graphicAtom=!slots.length&&semantics.some(s=>findings.some(f=>f.id===s.findingId&&f.kind==='asset'))
            const component:ComponentDefinition={id:`cmp-${root.id}`,name:root.name|| (compound?'Исходная группа':'Исходный объект'),kind:compound&&!graphicAtom?'compound':'atom',source:{slide:top.slide,rootId:root.id,elementIds:ids,ancestorIds:ancestors.map(a=>a.id),assetIds},scene:componentScene(root,ancestors),slots,fixedTextIds:fixed.map(e=>e.id),...(fixed.length?{fixedTextReasons:Object.fromEntries(fixed.map(e=>[e.id,fixedReason(e)!]))}:{}),issues:unsupported([...ancestors,...visibleElements([root])],snapshot,top.slide),semantics}
            library.components.push(component)
          }catch(error){library.excluded.push({elementId:root.id,reason:error instanceof Error?error.message:'Не удалось собрать компонент'})}
        }
        if(group&&!root.tableGrid)for(const child of root.children)walk(child,[...ancestors,root])
      }
      walk(parsed,[])
    }catch(error){library.excluded.push({elementId:top.id,reason:error instanceof Error?error.message:'Некорректная сцена'})}
  }
  // Source constructions need not have been grouped by their author. Assemble
  // explicit, same-parent, non-overlapping parts only; never guess neighbours.
  library.assemblyIssues=[]
  for(const f of findings.filter(f=>f.kind==='molecule'||f.kind==='asset'&&f.evidence.elementIds.length>=2)){
    // Finding labels may contain Unicode or punctuation; storage/route IDs do not.
    const assemblyId=findings.indexOf(f)+1,id=`asm-${assemblyId}`
    if(options.componentId&&options.componentId!==id||library.components.some(c=>c.semantics.some(s=>s.findingId===f.id)))continue
    const pending=(reason:string)=>library.assemblyIssues!.push({findingId:f.id,elementIds:f.evidence.elementIds,reason})
    const members=f.evidence.elementIds.map(id=>sourceScene.records.get(id)!)
    if(members.length<2||members.length>12||new Set(members.map(m=>m.element.id)).size!==members.length||new Set(members.map(m=>m.source.slide)).size!==1||new Set(members.map(m=>m.source.parentId??'')).size!==1||members.some(m=>m.disposition!=='visible'||m.tableId)){pending('Состав не поддержан: нужны 2–12 разных видимых частей одного родителя и слайда вне нативных таблиц.');continue}
    try{
    const parts=members.map(m=>m.element),nodes=parts.flatMap(p=>flatten([p])),leaves=parts.flatMap(p=>visibleElements([p])).filter(e=>!('children' in e))
    if(f.kind==='asset'&&leaves.some(e=>e.kind==='text')){pending('Составной графический атом содержит текст; его роль требует отдельной проверки.');continue}
    if(nodes.length>250||library.components.length>=(options.maxComponents??150)){pending('Конструкция превышает лимит текущего исполнителя; исходные части сохранены.');continue}
    const x=Math.min(...parts.map(p=>p.bounds.x)),y=Math.min(...parts.map(p=>p.bounds.y)),width=Math.max(...parts.map(p=>p.bounds.x+p.bounds.width))-x,height=Math.max(...parts.map(p=>p.bounds.y+p.bounds.height))-y
    const root:GroupElementIR={id:`source-assembly-${assemblyId}`,name:f.name,kind:'group',bounds:{x,y,width,height},rotation:0,opacity:1,visible:true,zIndex:0,children:parts.map(p=>({...structuredClone(p),bounds:{...p.bounds,x:p.bounds.x-x,y:p.bounds.y-y}}))}
    const ancestors=members[0].ancestors.map(id=>sourceScene.records.get(id)!.element as GroupElementIR)
    const slots:TextSlot[]=leaves.filter((e):e is TextElementIR=>e.kind==='text'&&!fixedReason(e)).map((e,i)=>({id:e.id,elementId:e.id,label:e.name||`Текст ${i+1}`,defaultText:e.text,policy:'fixed-box',maxLength:5000}))
    const fixed=leaves.filter((e):e is TextElementIR=>e.kind==='text'&&!slots.some(s=>s.elementId===e.id)),assetIds=[...new Set(nodes.filter(e=>e.kind==='raster').map(e=>e.assetId))]
    if(assetIds.some(id=>!snapshot.assets.some(a=>a.id===id))){pending('Не найден исходный графический ресурс.');continue}
    library.components.push({id,name:f.name,kind:f.kind==='asset'?'atom':'compound',source:{slide:members[0].source.slide,rootId:root.id,elementIds:nodes.map(e=>e.id),ancestorIds:members[0].ancestors,assetIds},scene:componentScene(root,ancestors),slots,fixedTextIds:fixed.map(e=>e.id),...(fixed.length?{fixedTextReasons:Object.fromEntries(fixed.map(e=>[e.id,fixedReason(e)!]))}:{}),issues:unsupported([...ancestors,...visibleElements([root])],snapshot,members[0].source.slide),semantics:[{findingId:f.id,name:f.name,role:f.role,basis:f.evidence.basis}]})
    }catch(error){pending(error instanceof Error?error.message:'Не удалось собрать конструкцию; исходные части сохранены.')}
  }
  library.components.sort((a,b)=>Number(b.kind==='compound')-Number(a.kind==='compound')||b.slots.length-a.slots.length)
  return library
}

/** Replace text in a clone. Never mutate the definition or infer a new style from new content. */
export function instantiateComponent(component: ComponentDefinition, values: Record<string,string>) {
  for(const [id,value] of Object.entries(values)) {
    const slot=component.slots.find(s=>s.id===id)
    if(!slot)throw new Error('Неизвестное текстовое поле')
    if(typeof value!=='string'||value.length>slot.maxLength)throw new Error('Слишком длинный текст')
    if(/[\r\t\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new Error('Табуляция и управляющие символы в этом поле не поддерживаются')
  }
  const scene=structuredClone(component.scene)
  for(const e of flatten(scene.elements)) {
    const slots=component.slots.filter(s=>s.elementId===e.id)
    if(slots.length&&e.kind==='text')fillTextFields(e,slots,values)
  }
  return scene
}
