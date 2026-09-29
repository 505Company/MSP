import type { VisualManifest } from '../digital-designer/visual-package'
import type { UploadJob } from '../uploads/domain'
import type { DesignSystemDraft } from '../uploads/design-system'
import type { QwenStyleAnalysis } from '../uploads/qwen-analysis'

/** Summary of the native snapshot. Never pass this off as the legacy OOXML profile. */
export function buildVisualDraft(visual:VisualManifest,job:UploadJob,analysis:QwenStyleAnalysis|null):DesignSystemDraft{
  const s=visual.snapshot,objects=s.elements.filter(e=>e.kind!=='source-picture')
  const styles=new Map<string,DesignSystemDraft['typography'][number]>()
  for(const e of objects){
    if(e.kind!=='text')continue
    const p=e.properties,runs=Array.isArray(p.styleRuns)?p.styleRuns:[]
    const seen=new Set<string>()
    for(const style of [p,...runs] as Record<string,unknown>[]){
      if(typeof style.fontFamily!=='string'||typeof style.fontSize!=='number')continue
      const face=typeof style.fontStyle==='string'?style.fontStyle:null
      const weight=typeof style.fontWeight==='number'?style.fontWeight:face?face.includes('Bold')?700:400:null
      const italic=typeof style.italic==='boolean'?style.italic:face?face.includes('Italic'):null
      const key=JSON.stringify([style.fontFamily,style.fontSize,weight,italic])
      if(seen.has(key))continue;seen.add(key)
      const current=styles.get(key)??{id:`type-${styles.size+1}`,fontFamily:style.fontFamily,fontSizePt:style.fontSize*72/96,
        fontWeight:weight,italic,
        usageCount:0,occurrenceCount:0,occurrences:[]}
      current.usageCount++;current.occurrenceCount++;if(current.occurrences.length<12)current.occurrences.push({slideIndex:e.slide,objectId:e.id})
      styles.set(key,current)
    }
  }
  return {schemaVersion:'1.0.0',status:'draft',parserVersion:'source-snapshot/1',generatedAt:job.updatedAt,
    source:{fileName:job.fileName,sha256:s.sourceId,sizeBytes:job.sizeBytes,slideCount:s.slideCount,
      slideSizeEmu:{width:Math.round(s.slides[0].width*9525),height:Math.round(s.slides[0].height*9525)}},
    coverage:{slides:s.slideCount,hiddenSlides:null,objects:objects.length,resolvedGeometry:null},
    colors:s.colors.map(c=>({id:`color-${c.hex.slice(1)}`,hex:c.hex,usageCount:c.occurrences,suggestedRoles:[],occurrenceCount:c.occurrences,occurrences:[]})),
    typography:[...styles.values()],repeatedElements:[],layouts:[],slides:[],analysis,
    warnings:['Это сводка нормализованной веб-сцены. Дерево объектов, локальная геометрия и происхождение находятся в visual.snapshot и рабочих компонентах.',
      'Скрытость слайдов и число объектов с абсолютной геометрией в этой сводке не определены. Семантические роли и повторения не выводятся из одного совпадения.',
      ...s.limitations,...s.slides.flatMap(slide=>slide.warnings.map(w=>`Слайд ${slide.number}: ${w}`))]}
}
