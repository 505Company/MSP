import {buildGraphicSystem,composeDiagram,type GraphicSystem} from '../design-system/graphic-components'
import {readReconstructionCatalog} from '../design-system/reconstruction'
import {graphElements} from '../design-system/diagram-graph'
import {flatten} from '../design-system/compiler'
import type {EditableTemplate,EditableData} from '../design-system/editable-contract'
import {readEditableCatalog} from '../design-system/editable-analysis'
import {nativeDataTemplates} from '../design-system/editable-source'
import type {VisualManifest} from '../digital-designer/visual-package'
import {contentHash} from '../design-system/catalog'
import {getProject} from '../workspace/storage'
import {dataMaterial,type DataMaterial} from './data-material'
export type DataAssembly={id:string;title:string;template:EditableTemplate;data:EditableData}
export type DataAssemblyView={projectRevision:string;uploadId:string;id:string;slides:DataAssembly[];waiting?:boolean;error?:string}

export function bindDataMaterial(material:DataMaterial,templates:EditableTemplate[],graphics?:GraphicSystem,uploadId=''):Omit<DataAssembly,'id'>[]{
 if(material.graph){
  if(!graphics)throw Error('В шаблоне пока нет проверенных блоков и связей')
  const graph=composeDiagram(graphics,material.graph),data={items:flatten(graphElements(graph)).filter(e=>e.kind==='text').map(e=>({id:e.id,text:e.kind==='text'?e.text:''}))}
  const template:EditableTemplate={id:'automatic-diagram',kind:'diagram',name:'Схема из данных',description:'Сочетание блоков и связей шаблона',tags:['Схема','Композиция'],slide:graphics.components.find(p=>p.role==='block')?.source.slide??1,sourceIds:graph.sourceIds,memberIds:[],width:graph.width,height:graph.height,data,style:{},config:{},graphicHtml:{},dataStatus:'native',diagramGraph:graph,diagramUploadId:uploadId}
  return [{title:material.title,template,data}]
 }
 const compatible=templates.filter(t=>t.kind===material.kind&&(t.kind!=='chart'||t.config.chartType===material.config.chartType))
 if(!compatible.length)throw Error(`В выбранном шаблоне пока нет проверенного оформления для ${material.kind==='table'?'таблицы':'этих данных'}`)
 const score=(t:EditableTemplate)=>material.kind==='table'?Math.abs((t.data.columns?.length??0)-material.data.columns!.length):0
 const template=structuredClone(compatible.sort((a,b)=>score(a)-score(b)||a.slide-b.slide)[0]),data=structuredClone(material.data)
 if(material.kind==='chart'&&data.series){
  delete template.config.yMin;delete template.config.yMax
  // Source series define appearance; uploaded categories, names and values are
  // the only content. Never carry sample values into a bound chart.
  const sample=template.data.series??[]
  data.series=data.series.map((series,i)=>{const source=sample[i%sample.length];return {...series,color:source?.color,colors:source?.colors,type:source?.type,axis:source?.axis}})
 }
 if(material.kind!=='table')return [{title:material.title,template,data}]
 // Derive a page capacity from the selected typography and column widths. Long
 // cell text lowers the row count rather than being truncated or rewritten.
 const columns=data.columns!,rows=data.rows!,font=template.style.fontSize??20,width=1000/columns.length
 const lines=Math.max(1,...rows.flatMap(row=>row.map(cell=>cell.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length*Math.max(8,font*.5)/width)),0))))
 const perPage=Math.max(1,Math.min(18,Math.floor(450/(font*(1.25*lines+1.2)))))
 const pages:Omit<DataAssembly,'id'>[]=[]
 for(let start=0;start<rows.length;start+=perPage)pages.push({title:material.title+(start?' · продолжение':''),template,data:{...data,rows:rows.slice(start,start+perPage),rowKeys:rows.slice(start,start+perPage).map((_,i)=>start+i< (template.data.rows?.length??0)?start+i:-1)}})
 return pages
}
export async function assembleProjectData(bucket:R2Bucket,projectId:string):Promise<DataAssemblyView>{
 const project=await getProject(bucket,projectId);if(!project||project.archivedAt)throw Error('Проект не найден')
 const material=dataMaterial(project.text);if(!material)throw Error('В проекте нет табличных или структурированных данных')
 const catalog=await readEditableCatalog(bucket,project.uploadId),passed=new Set(catalog?.qualification?.checks.filter(c=>c.passed).map(c=>c.id)??[])
 let templates=catalog?.families.flatMap(f=>f.variants.filter(t=>passed.has(t.id)))??[]
 if(!templates.length){const file=await bucket.get(`visual/${project.uploadId}/manifest.json`);if(file)templates=nativeDataTemplates((await file.json<VisualManifest>()).snapshot,project.uploadId)}
 const reconstruction=await readReconstructionCatalog(bucket,project.uploadId),graphics=reconstruction?buildGraphicSystem(reconstruction):undefined
 const id=await contentHash({version:'data-assembly-2',graphicSystem:graphics,revision:project.revision,catalog:catalog?.id,templates:templates.map(t=>t.id),material})
 const slides:DataAssembly[]=[]
 for(const entry of material)for(const page of bindDataMaterial(entry,templates,graphics,project.uploadId))slides.push({...page,id:`data-slide-${slides.length+1}`})
 return {projectRevision:project.revision,uploadId:project.uploadId,id,slides}
}
