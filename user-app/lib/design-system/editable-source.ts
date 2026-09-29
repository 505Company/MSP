import {normalizedText,type NativeBinding} from './editable-native-layout'
import type { SourceSnapshot } from '../digital-designer/source-types'
import type { ElementIR } from '../../vendor/drag/src/core/model'
import { readSourceScene, type SourceScene } from './source-scene'
import type { EditableTemplate, EditableProposal, EditableStyle, TableCellStyle, EditableFamily } from './editable-contract'
import { contentHash } from './catalog'
import { nativeObjectSchema } from './native-contract'
import {completeSourceIds,editableStructure,isPanel,sourceMembers} from './editable-structure'
import {recoverMetricText} from './editable-metric-recovery'
import {sourceBarChart} from './editable-bar-chart'
import {coversText} from './editable-evidence'
import {createTextFields} from './text-fields'

export const escapeHtml = (v: unknown) => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const hex = (c?: {r:number;g:number;b:number;a:number}) => !c || c.a===0 ? undefined : '#'+[c.r,c.g,c.b].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('')
const paint = (e: ElementIR) => 'fill' in e ? hex(e.fill?.color) : undefined

/** Graphics retain their native paths/assets. Text/data are never rasterized by
 * the editable renderer. Only validated source geometry enters this markup. */
export function sourceGraphic(scene: SourceScene, id: string, uploadId: string,omitIds=new Set<string>()): string {
  const r=scene.records.get(id)
  if (!r || r.disposition!=='visible') return ''
  const draw=(e:ElementIR,outer=false):string=>{
    if (!e.visible||!e.opacity||omitIds.has(e.id)) return ''
    const b=e.bounds, x=outer?0:b.x,y=outer?0:b.y, stroke='stroke' in e&&e.stroke?`stroke="${hex(e.stroke.paint.color)??'none'}" stroke-width="${e.stroke.width}"`:''
    const transform=e.centeredTransform?`translate(${x+b.width/2} ${y+b.height/2}) rotate(${e.rotation}) scale(${e.centeredTransform.flipH?-1:1} ${e.centeredTransform.flipV?-1:1}) translate(${-b.width/2} ${-b.height/2})`:`translate(${x} ${y}) rotate(${e.rotation})`
    let fill=paint(e)??'none',defs=''
    if('gradient' in e&&e.gradient){
      const g=e.gradient,gid=`gradient-${Array.from(`${uploadId}:${e.id}`).map(c=>c.codePointAt(0)!.toString(16)).join('-')}`
      const stops=g.stops.map(s=>`<stop offset="${s.position}" stop-color="${hex({...s.color,a:1})}" stop-opacity="${s.color.a}"/>`).join('')
      // Match the native preview in shape coordinates, including non-square
      // bounds, elliptical radial gradients and transparent gradient stops.
      defs=g.type==='linear'?`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${g.start.x*b.width}" y1="${g.start.y*b.height}" x2="${g.end.x*b.width}" y2="${g.end.y*b.height}">${stops}</linearGradient>`:`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5" gradientTransform="translate(${g.start.x*b.width} ${g.start.y*b.height}) scale(${(g.end.x-g.start.x)*b.width} ${(g.end.y-g.start.y)*b.height})">${stops}</radialGradient>`
      fill=`url(#${gid})`
    }
    let body=''
    if ('children' in e) body=e.children.map(child=>draw(child)).join('')
    else if (e.kind==='raster') body=`<image href="/api/uploads/${encodeURIComponent(uploadId)}/assets/${encodeURIComponent(e.assetId)}" width="${b.width}" height="${b.height}" preserveAspectRatio="none"/>`
    else if (e.kind==='text') return ''
    else if (e.kind==='path') body=`<path d="${escapeHtml(e.pathData)}" fill="${fill}" fill-rule="${e.windingRule==='EVENODD'?'evenodd':'nonzero'}" ${stroke}/>`
    else if (e.kind==='ellipse') body=`<ellipse cx="${b.width/2}" cy="${b.height/2}" rx="${b.width/2}" ry="${b.height/2}" fill="${fill}" ${stroke}/>`
    else if (e.kind==='line') body=`<path d="M0 0 L${b.width} ${b.height}" ${stroke}/>`
    else body=`<rect width="${b.width}" height="${b.height}" fill="${fill}" ${stroke}/>`
    return `<g data-source-object="${escapeHtml(e.id)}" transform="${transform}" opacity="${e.opacity}">${defs?`<defs>${defs}</defs>`:''}${body}</g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1,r.element.bounds.width)} ${Math.max(1,r.element.bounds.height)}" width="100%" height="100%" overflow="visible" aria-hidden="true">${draw(r.element,true)}</svg>`
}

/** Read native cells, including old snapshots predating tableGrid. Coordinates
 * define the grid; importer row/cell names only identify source containers. */
export function nativeTables(snapshot: SourceSnapshot): EditableTemplate[] {
  const scene=readSourceScene(snapshot), result:EditableTemplate[]=[]
  for (const r of scene.records.values()) {
    if (r.element.kind!=='table'||r.disposition!=='visible') continue
    const descendants=[...scene.records.values()].filter(c=>c.ancestors.includes(r.element.id))
    const cells=descendants.filter(c=>c.element.kind==='group'&&/^Cell \d+:\d+$/.test(c.element.name))
    if (!cells.length) continue
    const xs=[...new Set(cells.flatMap(c=>[c.bounds.x,c.bounds.x+c.bounds.width]).map(x=>Math.round(x*10)/10))].sort((a,b)=>a-b)
    const ys=[...new Set(cells.flatMap(c=>[c.bounds.y,c.bounds.y+c.bounds.height]).map(y=>Math.round(y*10)/10))].sort((a,b)=>a-b)
    const rows=Array.from({length:ys.length-1},()=>Array(xs.length-1).fill('') as string[]), styles:TableCellStyle[][]=rows.map(row=>row.map(()=>({hidden:true})))
    for (const cell of cells) {
      const nodes=descendants.filter(c=>c.ancestors.includes(cell.element.id)), texts=nodes.filter(c=>c.element.kind==='text').sort((a,b)=>a.bounds.y-b.bounds.y||a.bounds.x-b.bounds.x)
      const row=ys.indexOf(Math.round(cell.bounds.y*10)/10),col=xs.indexOf(Math.round(cell.bounds.x*10)/10)
      if (row<0||col<0||row>=rows.length||col>=xs.length-1) continue
      rows[row][col]=texts.map(t=>t.element.kind==='text'?t.element.text:'').join('\n')
      const first=texts[0]?.element, fill=nodes.find(n=>n.element.kind==='rectangle'), border=nodes.find(n=>'stroke' in n.element&&n.element.stroke)
      styles[row][col]={ background:fill?paint(fill.element):undefined,color:first?.kind==='text'?hex(first.colorRuns?.[0]?.fill.color):undefined,
        align:first?.kind==='text'?(first.textBox?.align==='RIGHT'?'right':first.textBox?.align==='CENTER'?'center':'left'):'left', bold:first?.kind==='text'&&first.fontStyle?.includes('Bold'),
        colSpan:Math.max(1,xs.indexOf(Math.round((cell.bounds.x+cell.bounds.width)*10)/10)-col),rowSpan:Math.max(1,ys.indexOf(Math.round((cell.bounds.y+cell.bounds.height)*10)/10)-row),
        borderBottom:border&&'stroke' in border.element?hex(border.element.stroke?.paint.color):undefined }
    }
    const textNode=descendants.find(n=>n.element.kind==='text')?.element
    result.push({id:`editable-${r.element.id}`,kind:'table',name:'Таблица',description:'Для сравнения данных по строкам и столбцам',tags:['Таблица','Данные','Текст'],slide:r.source.slide,
      sourceIds:[r.element.id],memberIds:[],style:{font:textNode?.kind==='text'?textNode.fontFamily:'Arial',fontSize:textNode?.kind==='text'?textNode.fontSize:18,padding:0,gap:0},config:{},data:{columns:rows[0],rows:rows.slice(1)},dataStatus:'native',
      tableStyles:styles,columnWidths:xs.slice(0,-1).map((x,i)=>(xs[i+1]-x)/(xs.at(-1)!-xs[0])*100),width:r.bounds.width,height:r.bounds.height,graphicHtml:{}})
  }
  return result
}

/** Native numbers/topology bypass the visual model entirely. Missing cached
 * values remain null; unsupported data is retained with its original object. */
export function nativeDataTemplates(snapshot:SourceSnapshot,uploadId=''):EditableTemplate[] {
  const result=nativeTables(snapshot),scene=readSourceScene(snapshot)
  for(const source of snapshot.elements) {
    if(!source.properties.native)continue
    const parsed=nativeObjectSchema.safeParse(source.properties.native)
    if(!parsed.success)continue
    const native=parsed.data,r=scene.records.get(source.id)
    if(!r||r.disposition!=='visible')continue
    if(native.kind==='table'){
      const table=result.find(t=>scene.records.get(t.sourceIds[0])?.ancestors.includes(source.id));if(table){table.nativeObject=native;table.sourceIds.push(source.id)}
      else if(native.rows.length>1)result.push({id:`editable-${source.id}`,kind:'table',name:'Таблица',description:'Исходные ячейки таблицы',tags:['Таблица','Данные'],sourceIds:[source.id],memberIds:[],slide:source.slide,width:r.bounds.width,height:r.bounds.height,graphicHtml:{},dataStatus:'native',nativeObject:native,style:{font:'Arial',fontSize:18},config:{},data:{columns:native.rows[0].cells.map(c=>c.text),rows:native.rows.slice(1).map(row=>row.cells.map(c=>c.text))},tableStyles:native.rows.map(row=>row.cells.map(c=>({colSpan:c.colSpan,rowSpan:c.rowSpan,hidden:c.merged}))),columnWidths:native.columns.map(w=>w/native.columns.reduce((n,w)=>n+w,0)*100)})
      continue
    }
    const nodes=[...scene.records.values()].filter(c=>c.ancestors.includes(source.id)),text=nodes.find(c=>c.element.kind==='text')?.element
    const common={id:`editable-${source.id}`,sourceIds:[source.id],memberIds:[],slide:source.slide,width:r.bounds.width,height:r.bounds.height,graphicHtml:{},dataStatus:'native' as const,nativeObject:native,
      style:{font:text?.kind==='text'?text.fontFamily:'Arial',fontSize:20,padding:10,color:text?.kind==='text'?hex(text.colorRuns?.[0]?.fill.color)??'#111111':'#111111',accent:nodes.map(n=>paint(n.element)).find(c=>c&&c.toLowerCase()!=='#ffffff')??'#0077ff'}}
    if(native.kind==='smartart'){
      const algorithms=native.algorithms,parents=new Map(native.edges.map(e=>[e.to,e.from]))
      const layout=algorithms.includes('hierRoot')?'tree':algorithms.includes('cycle')?'cycle':algorithms.includes('pyra')?'pyramid':algorithms.includes('lin')?'linear':'grid'
      const template:EditableTemplate={...common,kind:'smartart',name:'SmartArt',description:'Связанная схема с редактируемыми узлами',tags:['Схема','SmartArt','Текст'],config:{diagramLayout:layout},data:{items:native.nodes.map(n=>({id:n.id,text:n.text,...(parents.has(n.id)?{parentId:parents.get(n.id)}:{})}))}}
      const textNodes=nodes.filter(n=>n.element.kind==='text'),matching=native.nodes.map(node=>({node,matches:textNodes.filter(t=>t.element.kind==='text'&&t.element.text.trim()===node.text.trim())}))
      if(matching.length&&matching.every(m=>m.matches.length===1)&&new Set(matching.map(m=>m.matches[0].element.id)).size===matching.length&&r.element.name!=='Unavailable graphic'){
        template.sourceDiagram={graphic:sourceGraphic(scene,source.id,uploadId),text:matching.map(({node,matches})=>{const m=matches[0],e=m.element as Extract<ElementIR,{kind:'text'}>;return {id:node.id,x:m.bounds.x-r.bounds.x,y:m.bounds.y-r.bounds.y,width:m.bounds.width,height:m.bounds.height,font:e.fontFamily,fontSize:e.fontSize,color:hex(e.colorRuns?.[0]?.fill.color)??'#111111',align:e.textBox?.align==='CENTER'?'center':e.textBox?.align==='RIGHT'?'right':'left'}})}
      }
      result.push(template)
    } else {
      const types:Record<string,NonNullable<EditableTemplate['config']['chartType']>>={barChart:'bar',bar3DChart:'bar',lineChart:'line',line3DChart:'line',areaChart:'area',area3DChart:'area',doughnutChart:'donut',pieChart:'pie',pie3DChart:'pie',scatterChart:'scatter',bubbleChart:'bubble',radarChart:'radar'}
      const groups=native.groups,first=groups[0],series=groups.flatMap(g=>g.series),count=Math.max(0,...series.map(s=>s.values.length)),categories=series.find(s=>s.categories.length===count)?.categories??Array.from({length:count},(_,i)=>String(i+1))
      if(!first||!count||groups.some(g=>!types[g.type]))continue
      result.push({...common,kind:'chart',name:'Диаграмма',description:'Визуализирует числовые данные',tags:['Диаграмма','Данные'],
        style:{...common.style,...(native.style?{font:native.style.font,palette:native.style.palette,color:native.style.color,background:native.style.background}:{})},
        config:{chartType:groups.length>1?'combo':types[first.type],grid:native.style?.grid,axis:native.style?.axis,labels:native.style?.labels,legend:native.legend,horizontal:first.horizontal,hole:first.hole,stacked:first.grouping==='stacked',smooth:series.some(s=>s.smooth)},
        data:{...(native.title?{title:native.title}:{}),categories,series:groups.flatMap(g=>g.series.map(s=>({name:s.name,values:Array.from({length:count},(_,i)=>s.values[i]??null),...(s.color?{color:s.color}:{}),...(s.colors.some(c=>c!==null)?{colors:s.colors.map((c,i)=>c??s.color??native.style?.palette[i%native.style.palette.length]??'#0077ff')}:{}),axis:s.axis,...(s.x.length?{x:s.x}:{}),...(s.sizes.length?{sizes:s.sizes}:{}),...(['bar','line','area'].includes(types[g.type])?{type:types[g.type] as 'bar'|'line'|'area'}:{})})))}})
    }
  }
  return result
}

export function compileEditableProposal(proposal: EditableProposal, slide: number, snapshot:SourceSnapshot, uploadId:string, tables:EditableTemplate[], scene=readSourceScene(snapshot)): EditableTemplate {
  if (proposal.kind==='table') {
    const native=tables.find(t=>t.kind==='table'&&proposal.sourceIds.includes(t.sourceIds[0]))
    if(native)return {...native,id:proposal.id,name:proposal.name,description:proposal.description,tags:proposal.tags}
  }
  if(['feature','metric','diagram','radial','chart'].includes(proposal.kind)||proposal.kind==='text'&&proposal.adaptation)proposal={...proposal,sourceIds:completeSourceIds(proposal.sourceIds,scene)}
  const records=proposal.sourceIds.flatMap(id=>scene.records.get(id)??[]), bounds=records.map(r=>r.bounds)
  const width=bounds.length?Math.max(...bounds.map(b=>b.x+b.width))-Math.min(...bounds.map(b=>b.x)):600
  const height=bounds.length?Math.max(...bounds.map(b=>b.y+b.height))-Math.min(...bounds.map(b=>b.y)):320
  const texts=records.flatMap(r=>r.element.kind==='text'?[r.element]:[])
  const style:EditableStyle={font:texts[0]?.fontFamily??snapshot.fonts[0]?.family??'Arial',color:hex(texts[0]?.colorRuns?.[0]?.fill.color)??'#111111',...proposal.style}
  // Fonts must come from the source, never an imagined brand font in its copy.
  if (!snapshot.fonts.some(f=>f.family===style.font)) style.font=snapshot.fonts[0]?.family??'Arial'
  if (style.headingFont&&!snapshot.fonts.some(f=>f.family===style.headingFont)) style.headingFont=style.font
  const graphics=[proposal.data.graphicId,...(proposal.data.items??[]).map(i=>i.graphicId)].filter(Boolean) as string[]
  const template:EditableTemplate={...proposal,slide,width:Math.max(1,width),height:Math.max(1,height),style,graphicHtml:Object.fromEntries(graphics.map(id=>[id,sourceGraphic(scene,id,uploadId)]))}
  template.sourceChart=sourceBarChart(proposal,scene,b=>compileEditableProposal(b,slide,snapshot,uploadId,tables,scene))
  if(template.sourceChart){template.style={...style,padding:0};if(template.sourceChart.labels.some(l=>/[–—-]|[А-Яа-я]/.test(l)))template.dataStatus='estimated'}
  if(['diagram','radial','metric','feature'].includes(proposal.kind)||proposal.kind==='text'&&proposal.adaptation){
    const selected=new Set(proposal.sourceIds),roots=records.filter(r=>!r.ancestors.some(id=>selected.has(id)))
    const members=[...scene.records.values()].filter(r=>(selected.has(r.element.id)||r.ancestors.some(id=>selected.has(id)))&&r.disposition==='visible')
    const nodes=members.filter(r=>r.element.kind==='text')
    if(nodes.length){
      const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y))
      const data:EditableTemplate['data']=proposal.kind==='diagram'?{items:nodes.map(r=>({id:r.element.id,text:r.element.kind==='text'?r.element.text:''}))}:structuredClone(proposal.data)
      // A broad semantic feature is compiled from all of its observed fields.
      // Avoid keeping a second paraphrase or hiding its body in unused `value`.
      if(['feature','metric'].includes(proposal.kind)||proposal.kind==='text'&&proposal.adaptation){
        for(const key of Object.keys(data))if(proposal.kind!=='metric'||!['value','unit'].includes(key))delete data[key as keyof typeof data]
      }
      const used=new Set<string>()
      const text:NonNullable<EditableTemplate['sourceLayout']>['text']=nodes.map(r=>{
        const e=structuredClone(r.element as Extract<ElementIR,{kind:'text'}>);e.bounds={...r.bounds,x:r.bounds.x-x,y:r.bounds.y-y}
        let binding:NativeBinding|undefined
        if(proposal.kind==='diagram')binding={field:'item',id:e.id,part:'text'}
        else if(proposal.kind==='metric'&&normalizedText(e.text)===normalizedText(String(data.value??'')+String(data.unit??'')))binding={field:'metric'}
        else if(proposal.kind==='metric'&&data.value?.trim()){
          const fields=createTextFields(e,'Показатель'),value=normalizedText(data.value+String(data.unit??''))
          // A rich first run can be a placeholder as well as a numeric value.
          // Require exact source evidence; retain all caption runs separately.
          if(fields.length>1&&fields.every(f=>f.range)&&normalizedText(fields[0].defaultText)===value){
            data.items??=[]
            binding={field:'metric',richParts:fields.map((f,i)=>{if(!i)return {slotId:f.id,field:'metric'};const index=data.items!.length;data.items!.push({text:f.defaultText});return {slotId:f.id,field:'item',index}})}
          }
        }
        if(!binding)for(const field of ['title','text','value','unit'] as const)if(!used.has(field)&&proposal.data[field]&&normalizedText(proposal.data[field])===normalizedText(e.text)){binding={field};data[field]=e.text;used.add(field);break}
        if(!binding)for(const [index,item] of (data.items??[]).entries())for(const part of ['text','title'] as const){const key=`item:${index}:${part}`;if(!binding&&!used.has(key)&&item[part]&&normalizedText(item[part])===normalizedText(e.text)){binding={field:'item',index,part};item[part]=e.text;used.add(key)}}
        if(!binding){data.items??=[];binding={field:'item',index:data.items.length,part:'text'};data.items.push({text:e.text})}
        return {element:e,binding}
      })
      const recovered=proposal.kind==='metric'&&!text.some(s=>['metric','value'].includes(s.binding.field))?recoverMetricText(members.filter(r=>!('children'in r.element)),data,style,width,height,x,y,uploadId):null
      const omitted=new Set(recovered?[recovered.record.element.id]:[])
      if(recovered)text.push(recovered.slot)
      // Model labels such as "отелей" sometimes repeat a word in the caption,
      // not an independent unit field. Keep the full native caption; do not
      // invent a second invisible field that fails every changed-data check.
      if(data.unit&&!text.some(s=>['unit','metric'].includes(s.binding.field))&&text.some(s=>!['metric','value'].includes(s.binding.field)&&(' '+normalizedText(s.element.text).toLocaleLowerCase().split(/[^\p{L}\p{N}%]+/u).join(' ')+' ').includes(' '+normalizedText(data.unit).toLocaleLowerCase()+' ')))delete data.unit
      template.data=data;template.dataStatus=proposal.kind==='metric'?proposal.dataStatus:'native'
      template.sourceLayout={graphic:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" overflow="visible">${roots.map(r=>`<g transform="translate(${r.bounds.x-x} ${r.bounds.y-y})">${sourceGraphic(scene,r.element.id,uploadId,omitted).replace('width="100%" height="100%"',`width="${Math.max(1,r.bounds.width)}" height="${Math.max(1,r.bounds.height)}"`)}</g>`).join('')}</svg>`,text,graphicIds:members.filter(r=>r.element.kind!=='text'&&!('children' in r.element)&&!omitted.has(r.element.id)).map(r=>r.element.id)}
      const leaves=sourceMembers(proposal.sourceIds,scene).filter(r=>!('children'in r.element)),panels=leaves.filter(r=>isPanel(r)||r.element.kind==='raster'&&nodes.some(t=>coversText(r,t)))
      const illustrations=leaves.filter(r=>r.element.kind==='raster'&&!panels.includes(r)&&r.bounds.width*r.bounds.height>width*height*.1)
      template.sourceLayout.structure={panels:panels.length,orientation:width>height*2.7?'horizontal':height>width*1.15?'vertical':'mixed',inline:false,illustrated:illustrations.length>0}
      // Detached native fields still need their source canvas (notably white
      // text on dark slides). This is a style, not an extra source object.
      const background=[...scene.records.values()].find(r=>r.source.slide===slide&&r.element.name==='Slide background'&&r.disposition==='visible')
      const covered=background&&[...scene.records.values()].some(r=>r.source.slide===slide&&r.element.kind==='raster'&&r.disposition==='visible'&&coversText(r,background))
      template.style={...style,background:covered?style.background:background?paint(background.element)??style.background:style.background,padding:0,border:undefined,radius:0}
      const picture=leaves.filter(r=>r.element.kind==='raster'),caption=nodes[0]?.element
      if(proposal.kind==='feature'&&!panels.length&&nodes.length===1&&caption?.kind==='text'&&picture.length===1&&picture[0].bounds.width<width*.45&&picture[0].bounds.height<height*.65&&/^\s{3,}/.test(caption.text)){
        const p=picture[0]
        template.sourceInline={graphic:sourceGraphic(scene,p.element.id,uploadId),width:p.bounds.width,height:p.bounds.height,font:caption.fontFamily,fontSize:caption.fontSize,bold:/bold|[6789]00/i.test(caption.fontStyle??caption.fontFamily),color:hex(caption.colorRuns?.[0]?.fill.color)??'#111111'}
        template.sourceLayout.structure.inline=true
      }
    }
  }
  return template
}

const names:Record<string,string>={text:'Текстовый блок',feature:'Тезис с графикой',metric:'Показатель',table:'Таблица',timeline:'Таймлайн',gantt:'Диаграмма Ганта',radial:'Радиальная схема',smartart:'SmartArt',diagram:'Схема',progress:'Индикатор этапов',bar:'Столбчатая диаграмма',line:'Линейный график',area:'Диаграмма с областями',donut:'Кольцевая диаграмма',pie:'Круговая диаграмма',combo:'Комбинированная диаграмма',scatter:'Точечная диаграмма',bubble:'Пузырьковая диаграмма',radar:'Лепестковая диаграмма'}
export async function groupEditableTemplates(templates: EditableTemplate[]):Promise<EditableFamily[]> {
  const groups=new Map<string,EditableTemplate[]>()
  for (const t of templates) {
    const key=t.sourceRegion?`${t.kind}:${t.sourceRegion.sourceId}:${JSON.stringify(t.sourceRegion.region)}`:editableStructure(t).key
    const list=groups.get(key)??[];list.push(t);groups.set(key,list)
  }
  const result:EditableFamily[]=[]
  for (const [key,all] of groups) {
    // Qualify every observed instance. Equal model styles do not prove that
    // different source fields, icons or children are interchangeable.
    const variants=all
    const t=all[0], mixedColumns=t.kind==='composition'&&new Set(all.map(t=>t.config.columns)).size>1
    const name=t.sourceRegion?t.name:mixedColumns?(all.every(t=>t.children?.length===t.config.columns)?'Горизонтальный ряд':'Сетка компонентов'):t.sourceLayout||t.kind==='composition'?editableStructure(t).name:t.kind==='chart'&&t.config.horizontal?'Горизонтальная диаграмма':names[t.kind==='chart'?t.config.chartType!:t.kind]
    result.push({id:'html-family-'+(await contentHash(key)).slice(0,16),name,description:t.description,tags:[...new Set(all.flatMap(t=>t.tags))].slice(0,8),kind:t.kind,variants,sourceIds:[...new Set(all.flatMap(t=>t.sourceIds))],slides:[...new Set(all.map(t=>t.slide))].sort((a,b)=>a-b)})
  }
  return result.sort((a,b)=>Number(a.kind==='composition')-Number(b.kind==='composition')||a.slides[0]-b.slides[0])
}
