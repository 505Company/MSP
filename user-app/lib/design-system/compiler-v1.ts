import { parseSceneElements } from '../../vendor/drag/src/core/page-ir'
import type { ElementIR, GroupElementIR, TextElementIR, BoundsIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot, SourceElement } from '../digital-designer/source-types'
import type { DesignAnalysis } from '../digital-designer/design-analysis'
import type { ComponentDefinition, ComponentLibrary, ComponentIssue, TextSlot } from './types'

export const COMPILER_VERSION = 'web-components-1'
export function flatten(elements: ElementIR[]): ElementIR[] {
  return elements.flatMap(e => [e, ...('children' in e ? flatten(e.children) : [])])
}
export function visibleElements(elements: ElementIR[]): ElementIR[] {
  return elements.filter(e=>e.visible&&e.opacity>0).flatMap(e=>[e,...('children' in e?visibleElements(e.children):[])])
}

// A slot can preserve a uniform style exactly. Rich text and list markers stay source text.
export function editableText(e: TextElementIR): boolean {
  if (!e.text.trim() || /^[\s\d.,:;()\[\]–—\-•·●▪○]+$/u.test(e.text)) return false
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

function unsupported(nodes: ElementIR[], snapshot: SourceSnapshot, slide: number): ComponentIssue[] {
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
  const library:ComponentLibrary={schemaVersion:1,compilerVersion:COMPILER_VERSION,sourceId:snapshot.sourceId,name:snapshot.name,tokens:{colors:snapshot.colors,fonts:snapshot.fonts},components:[],excluded:[],notes:[
    'Группы сохраняют наблюдаемую структуру PPTX. Повторяемость и универсальность не утверждаются.',
    'Поля сохраняют размеры и стиль исходника. Автоматическое сокращение и уменьшение нового текста отключены.',
    'Сложный текст и постоянные маркеры сохраняются без редактирования. Превью — реконструкция, её нужно сверить с исходником.'
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
          if(library.components.length>=(options.maxComponents??150) || nodes.length>250){library.excluded.push({elementId:root.id,reason:nodes.length>250?'В конструкции больше 250 объектов; выберите вложенную группу.':'Лимит прежнего формата библиотеки: 150 компонентов. Полный список доступен в каталоге.'})}
          else try {
            const slots:TextSlot[]=leaves.filter((e):e is TextElementIR=>e.kind==='text'&&editableText(e)).map((e,i)=>({id:e.id,elementId:e.id,label:e.name||`Текст ${i+1}`,defaultText:e.text,policy:'fixed-box',maxLength:5000}))
            const assetIds=[...new Set(nodes.filter(e=>e.kind==='raster').map(e=>e.assetId))]
            if(assetIds.some(id=>!snapshot.assets.some(a=>a.id===id)))throw new Error('Не найден исходный ресурс')
            const ids=nodes.map(e=>e.id), leafIds=new Set(leaves.map(e=>e.id))
            const semantics=analysis?.sourceId===snapshot.sourceId?analysis.findings.filter(f=>f.kind===(compound?'molecule':'asset') && f.evidence.elementIds.length>0 && f.evidence.elementIds.every(id=>ids.includes(id)) && (f.evidence.elementIds.includes(root.id)||leafIds.size===f.evidence.elementIds.length && f.evidence.elementIds.every(id=>leafIds.has(id)))).map(f=>({findingId:f.id,name:f.name,role:f.role,basis:f.evidence.basis})):[]
            const component:ComponentDefinition={id:`cmp-${root.id}`,name:root.name|| (compound?'Исходная группа':'Исходный объект'),kind:compound?'compound':'atom',source:{slide:top.slide,rootId:root.id,elementIds:ids,ancestorIds:ancestors.map(a=>a.id),assetIds},scene:componentScene(root,ancestors),slots,fixedTextIds:leaves.filter(e=>e.kind==='text'&&!slots.some(s=>s.elementId===e.id)).map(e=>e.id),issues:unsupported([...ancestors,...visibleElements([root])],snapshot,top.slide),semantics}
            library.components.push(component)
          }catch(error){library.excluded.push({elementId:root.id,reason:error instanceof Error?error.message:'Не удалось собрать компонент'})}
        }
        if(group)for(const child of root.children)walk(child,[...ancestors,root])
      }
      walk(parsed,[])
    }catch(error){library.excluded.push({elementId:top.id,reason:error instanceof Error?error.message:'Некорректная сцена'})}
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
    const slot=component.slots.find(s=>s.elementId===e.id)
    if(!slot||e.kind!=='text')continue
    const text=values[slot.id]??slot.defaultText
    if(e.flow)e.flow.autoFit='NONE'
    if(text===e.text)continue
    e.text=text
    e.styleRuns=e.styleRuns?.map(r=>({...r,start:0,end:text.length})).filter(r=>r.end>0)
    e.colorRuns=e.colorRuns?.map(r=>({...r,start:0,end:text.length})).filter(r=>r.end>0)
    if(e.paragraphs){const p=e.paragraphs[0];let offset=0;e.paragraphs=text.split('\n').map(line=>{const next={...p,start:offset,end:offset+line.length};offset+=line.length+1;return next})}
  }
  return scene
}
