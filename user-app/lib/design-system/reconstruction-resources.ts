import {flatten} from './compiler'
import {graphElements} from './diagram-graph'
import type {ComponentLibrary} from './types'
import type {ReconstructionCatalog} from './reconstruction-contract'
import {assemblePattern} from './pattern-geometry'
import type {ElementIR} from '../../vendor/drag/src/core/model'
/** Stable source IDs keep saved links meaningful. Only verified replacements
 * enter generation; original definitions remain immutable in source storage. */
export function reconstructedLibrary(library:ComponentLibrary,catalog:ReconstructionCatalog|null):ComponentLibrary{
 if(!catalog)return library
 return {...library,components:library.components.map(c=>{
  const r=catalog.results.find(r=>r.status==='ready'&&r.pattern&&r.candidate.componentIds.includes(c.id));if(!r?.pattern)return c
  const rasters=flatten(c.scene.elements).filter(e=>e.kind==='raster'),assetId=r.candidate.assetId??(rasters.length===1?rasters[0].assetId:undefined)
  // Qualification compares the bitmap, not the component's surrounding masks.
  // Replace that leaf in place; keep crop, ancestor transforms and other layers.
  const replace=(e:ElementIR):ElementIR=>{
   if('children' in e)return {...e,children:e.children.map(replace)}
   if(e.kind!=='raster'||e.assetId!==assetId||e.clipBounds)return e
   return {id:e.id,name:e.name,sourceRef:e.sourceRef,kind:'group',bounds:{...e.bounds},rotation:e.rotation,opacity:e.opacity,visible:e.visible,zIndex:e.zIndex,centeredTransform:e.centeredTransform,blur:e.blur,effects:e.effects,children:assemblePattern(r.pattern!,{width:e.bounds.width,height:e.bounds.height})}
  }
  const elements=c.scene.elements.map(replace)
  return {...c,pattern:r.pattern,scene:{...c.scene,elements},source:{...c.source,assetIds:[...new Set(flatten(elements).flatMap(e=>e.kind==='raster'?[e.assetId]:[]))]}}
 })}
}

/** Recovered diagrams share the existing component catalogue and data renderer. */
export function attachReconstructedDiagrams(catalog:import('./editable-contract').EditableCatalog,reconstructed:ReconstructionCatalog|null,uploadId:string){
 if(!reconstructed||reconstructed.editableCatalogId!==catalog.id)return
 for(const r of reconstructed.results.filter(r=>r.status==='ready'&&r.diagram)){
  const existing=catalog.families.flatMap(f=>f.variants).find(t=>t.id===r.candidate.templateId)
  const graph=r.diagram!,nodes=flatten(graphElements(graph)).filter(e=>e.kind==='text'),id=`recovered-${r.id}`
  if(existing){
   // A graph consumes native text IDs, while the old generic timeline consumes
   // positional title/body pairs. Do not leave the old bindings silently inert.
   // This is a derived view; the saved model response/catalog remains unchanged.
   if(existing.sourceLayout||existing.sourceInline||existing.sourceRegion||existing.sourceChart)continue
   existing.diagramGraph=graph;existing.diagramUploadId=uploadId;existing.width=graph.width;existing.height=graph.height
   existing.data={items:nodes.map(e=>({id:e.id,text:e.kind==='text'?e.text:''}))}
   continue
  }
  const template:import('./editable-contract').EditableTemplate={id,name:'Схема с блоками и связями',description:'Для процессов и взаимосвязей',tags:['Схема','Процесс','Текст'],kind:'diagram',sourceIds:r.candidate.sourceIds,memberIds:[],slide:r.candidate.slides[0],width:graph.width,height:graph.height,style:{},config:{},data:{items:nodes.map(e=>({id:e.id,text:e.kind==='text'?e.text:''}))},dataStatus:'readable',graphicHtml:{},diagramGraph:graph,diagramUploadId:uploadId}
  catalog.families.push({id,name:template.name,description:template.description,tags:template.tags,kind:'diagram',sourceIds:template.sourceIds,slides:r.candidate.slides,variants:[template]})
  catalog.qualification?.checks.push({id,passed:true,source:true,changed:true,issues:[]})
 }
}
