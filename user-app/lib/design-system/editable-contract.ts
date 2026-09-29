import { z } from 'zod'
import type { SourceSnapshot } from '../digital-designer/source-types'
import { SemanticValidationError } from './semantic-contract'
import { expandMetricCollections } from './editable-collections'
import { graphicOnlyProposal } from './editable-evidence'
import { readSourceScene, type SourceScene } from './source-scene'
import { componentIntentSchema, componentIntentResponseSchema, sourceDispositionSchema, intentIssues } from './component-intent'

export const EDITABLE_COMPILER_VERSION = 'editable-html-compiler-14'
export const EDITABLE_VERSION = 'editable-design-system-1'
export const editableKinds = ['text', 'feature', 'metric', 'table', 'chart', 'timeline', 'gantt', 'radial', 'smartart', 'diagram', 'progress', 'composition'] as const
const text = z.string().max(10000), color = z.string().regex(/^#[\da-f]{6}$/i)
const id = z.string().regex(/^[\w-]{1,120}$/)
const series = z.object({ name: text, values: z.array(z.number().finite().nullable()).max(2000), color: color.optional(), type: z.enum(['bar', 'line', 'area']).optional(), axis: z.enum(['left', 'right']).optional(), colors: z.array(color).max(2000).optional(), x: z.array(z.number().finite().nullable()).max(2000).optional(), sizes: z.array(z.number().finite().nullable()).max(2000).optional() }).strict()
const item = z.object({ id: z.string().max(128).optional(), parentId: z.string().max(128).optional(), title: text.optional(), text: text.optional(), value: text.optional(), graphicId: id.optional(), color: color.optional(), ranges: z.array(z.object({ start: z.number().nonnegative(), end: z.number().positive(), color: color.optional() }).strict()).max(20).optional() }).strict()
export const editableDataSchema = z.object({
  title: text.optional(), text: text.optional(), value: text.optional(), unit: z.string().max(30).optional(), graphicId: id.optional(),
  columns: z.array(text).max(60).optional(), rows: z.array(z.array(text).max(60)).max(2000).optional(),
  categories: z.array(text).max(2000).optional(), series: z.array(series).max(32).optional(), items: z.array(item).max(256).optional(), periods: z.array(text).max(100).optional(),
}).strict()
export type EditableData = z.infer<typeof editableDataSchema> & { children?: EditableData[]; templateId?:string; rowKeys?:number[] }
export const editableStyleSchema = z.object({
  font: z.string().max(120).optional(), headingFont: z.string().max(120).optional(), fontSize: z.number().min(10).max(2000).optional(),
  color: color.optional(), accent: color.optional(), muted: color.optional(), background: color.optional(), border: color.optional(),
  palette: z.array(color).max(16).optional(), radius: z.number().min(0).max(100).optional(), gap: z.number().min(0).max(100).optional(),
  padding: z.number().min(0).max(100).optional(), align: z.enum(['left', 'center', 'right']).optional(),
  marker: z.enum(['none', 'circle', 'petal', 'square']).optional(), markerColor: color.optional(),
  metricSize: z.number().min(24).max(2000).optional(), headerFill: color.optional(), headerColor: color.optional(),
  stripe: color.optional(), accentRow: z.number().int().min(-1).max(299).optional(), accentColumn: z.number().int().min(-1).max(59).optional(),
}).strict()
export const editableConfigSchema = z.object({
  layout: z.enum(['grid', 'stack', 'split']).optional(), columns: z.number().int().min(1).max(8).optional(),
  chartType: z.enum(['bar', 'line', 'area', 'donut', 'pie', 'combo', 'scatter', 'bubble', 'radar']).optional(), horizontal: z.boolean().optional(),
  diagramLayout: z.enum(['linear','tree','cycle','pyramid','grid']).optional(),
  stacked: z.boolean().optional(), smooth: z.boolean().optional(), legend: z.boolean().optional(), grid: z.boolean().optional(), axis: z.boolean().optional(), labels: z.boolean().optional(),
  hole: z.number().min(0).max(.9).optional(), yMin: z.number().finite().optional(), yMax: z.number().finite().optional(),
}).strict()
export type EditableStyle = z.infer<typeof editableStyleSchema>
export type EditableConfig = z.infer<typeof editableConfigSchema>
const block = z.object({ id, name: z.string().min(1).max(120), description: z.string().min(1).max(200), tags: z.array(z.string().min(1).max(40)).min(1).max(8),
  kind: z.enum(editableKinds), sourceIds: z.array(id).min(1).max(250), memberIds: z.array(id).max(24),
  style: editableStyleSchema, config: editableConfigSchema, data: editableDataSchema,
  dataStatus: z.enum(['native', 'readable', 'estimated', 'empty']),
  adaptation: componentIntentSchema.optional(),
}).strict()
export type EditableProposal = z.infer<typeof block>
// Commentary does not define component structure. Keep it bounded without
// rejecting valid blocks (or an empty result) for a detailed explanation.
export const EDITABLE_NOTE_LIMIT = 4000
export const editableReplySchema = z.object({ slides: z.array(z.object({ slide: z.number().int(), blocks: z.array(block).max(24), objectRoles: sourceDispositionSchema.optional(), note: z.string().max(EDITABLE_NOTE_LIMIT) }).strict()).min(1).max(4) }).strict()
export type EditableReply = z.infer<typeof editableReplySchema>
export type TableCellStyle = { background?: string; color?: string; align?: 'left'|'center'|'right'; bold?: boolean; colSpan?: number; rowSpan?: number; hidden?: boolean; borderBottom?: string }
export type EditableTemplate = Omit<EditableProposal, 'id' | 'kind'> & {
  kind: EditableProposal['kind'] | 'graphic'
  id: string; slide: number; width: number; height: number; graphicHtml: Record<string, string>
  tableStyles?: TableCellStyle[][]; columnWidths?: number[]
  children?: EditableTemplate[]
  sourceChart?: {rows:EditableTemplate[];labels:string[];gap:number}
  sourceInline?: {graphic:string;width:number;height:number;fontSize:number;font:string;bold:boolean;color:string}
  diagramGraph?: import('./diagram-graph').DiagramGraph
  diagramUploadId?: string
  sourceLayout?: import('./editable-native-layout').NativeLayout
  sourceDiagram?: { graphic: string; text: { id:string; x:number; y:number; width:number; height:number; font:string; fontSize:number; color:string; align:string }[] }
  nativeObject?: import('./native-contract').NativeChart | import('./native-contract').NativeDiagram | import('./native-contract').NativeTable
  sourceRegion?: import('./refinement-raster').RasterRegionEvidence
}
export type EditableFamily = { id: string; name: string; description: string; tags: string[]; kind: EditableTemplate['kind']; variants: EditableTemplate[]; sourceIds: string[]; slides: number[] }
export type EditableCatalog = {
  version: string; compilerVersion:string; id: string; sourceRevision: string; catalogId: string; createdAt: string
  qualification?: import('./editable-qualification').HtmlQualification; families: EditableFamily[]; coverage: { slide: number; blockIds: string[]; note: string; objects?: ReturnType<typeof import('./component-intent').sourceCoverage> }[]
  modelRunIds: string[]; liveRequests: number; excluded: { id: string; reason: string }[]
  refinement?: { baseId: string; requestId: string; previousId: string }
  omissions?: import('./semantic-isolation').ImportOmission[]
  /** Grounded model observations. These never grant rendering/adaptation admission. */
  designIntent?: { auditId: string; status: 'partial' | 'complete'; slides: import('./quality-audit-contract').SlideAudit[]; style: import('./quality-audit-contract').TemplateDesignIntent | null }
}

// Use the same runtime schema for model contracts, editor inputs and saved data.
// JSON schema is deliberately small; optional fields need not be echoed empty.
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) return jsonSchema(schema._def.innerType)
  if (schema instanceof z.ZodNullable) return { anyOf: [jsonSchema(schema._def.innerType), { type: 'null' }] }
  if (schema instanceof z.ZodString) return { type: 'string', ...(schema.minLength!==null?{minLength:schema.minLength}:{}), ...(schema.maxLength!==null?{maxLength:schema.maxLength}:{}) }
  if (schema instanceof z.ZodNumber) return { type: schema.isInt?'integer':'number', ...(schema.minValue!==null?{minimum:schema.minValue}:{}), ...(schema.maxValue!==null?{maximum:schema.maxValue}:{}) }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodLiteral) return { type: 'string', const: schema.value }
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options }
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map((s:z.ZodTypeAny)=>jsonSchema(s)) }
  if (schema instanceof z.ZodArray) return { type: 'array', items: jsonSchema(schema.element), ...(schema._def.minLength?{minItems:schema._def.minLength.value}:{}), ...(schema._def.maxLength?{maxItems:schema._def.maxLength.value}:{}), ...(schema._def.exactLength?{minItems:schema._def.exactLength.value,maxItems:schema._def.exactLength.value}:{}) }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string,z.ZodTypeAny>
    return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,jsonSchema(v)])), required: Object.entries(shape).filter(([,v])=>!v.isOptional()).map(([k])=>k) }
  }
  throw new Error('Unsupported editable schema')
}
type RecognitionEvidence = { nativeKinds: string[]; textIds: string[] }
function modelSchema(requireIntent=false, evidence?: RecognitionEvidence) {
  type BlockSchema={properties:{kind:{type:string;enum:readonly string[]};data:unknown;adaptation:Record<string,unknown>;config:unknown;dataStatus:unknown};required:string[]}
  const schema=jsonSchema(editableReplySchema) as {properties:{slides:{items:{required:string[];properties:{note:Record<string,unknown>;blocks:{items:BlockSchema|{anyOf:BlockSchema[]}}}}}}}
  schema.properties.slides.items.properties.note.maxLength=EDITABLE_NOTE_LIMIT
  const blocks=schema.properties.slides.items.properties.blocks
  const regular=blocks.items as BlockSchema
  // Constrain intervals in the response grammar. A Gantt chart must not become
  // a binary chart series merely because both use horizontal bars.
  const gantt=structuredClone(regular)
  gantt.properties.kind={type:'string',enum:['gantt']}
  gantt.properties.data=jsonSchema(z.object({title:text.optional(),periods:z.array(text),items:z.array(item.extend({ranges:z.array(z.object({start:z.number(),end:z.number(),color:color.optional()}).strict())}))}).strict())
  regular.properties.kind.enum=editableKinds.filter(k=>k!=='gantt')
  blocks.items={anyOf:[gantt,regular]}
  if(requireIntent){
    schema.properties.slides.items.required.push('objectRoles')
    const semantic=structuredClone(regular)
    semantic.properties.kind.enum=['text','feature','metric']
    semantic.required.push('adaptation')
    semantic.properties.adaptation=jsonSchema(componentIntentResponseSchema)
    regular.properties.kind.enum=editableKinds.filter(k=>!['gantt','text','feature','metric','table','chart'].includes(k))
    const structured=(['table','chart'] as const).flatMap(kind=>{
      const assembled=structuredClone(regular)
      assembled.properties.kind={type:'string',enum:[kind]}
      assembled.properties.dataStatus={type:'string',enum:['readable','estimated','empty']}
      assembled.properties.data=jsonSchema(kind==='table'
        ? editableDataSchema.pick({title:true,text:true,columns:true,rows:true}).extend({columns:z.array(text).min(1).max(60),rows:z.array(z.array(text).min(1).max(60)).min(1).max(2000)})
        : editableDataSchema.pick({title:true,text:true,value:true,unit:true,categories:true,series:true}).extend({categories:z.array(text).min(1).max(2000),series:z.array(series).min(1).max(32)}))
      if(kind==='chart')assembled.properties.config=jsonSchema(editableConfigSchema.required({chartType:true}))
      if(evidence&&!evidence.nativeKinds.includes(kind))return [assembled]
      // Native values come from the PPTX parser. The validator additionally
      // verifies ownership against nativeObjects; never ask Qwen to retype them.
      const native=structuredClone(regular)
      native.properties.kind={type:'string',enum:[kind]}
      native.properties.dataStatus={type:'string',enum:['native']}
      native.properties.data=jsonSchema(z.object({}).strict())
      native.properties.config=jsonSchema(z.object({}).strict())
      return [assembled,native]
    })
    blocks.items.anyOf=[gantt,semantic,...structured,regular]
    for(const branch of blocks.items.anyOf){
      const intent=jsonSchema(componentIntentResponseSchema) as {anyOf:{properties:{family:{const:string};fields:{items:{properties:{sourceId:Record<string,unknown>}}}}}[]}
      if(evidence){
        if(!evidence.textIds.length)intent.anyOf=intent.anyOf.filter(option=>option.properties.family.const==='fixed')
        else for(const option of intent.anyOf)option.properties.fields.items.properties.sourceId.enum=[...new Set(evidence.textIds)]
      }
      branch.properties.adaptation=intent
    }
  }
  return schema
}
export const editableModelSchema = modelSchema()
export const editableRecognitionSchema = modelSchema(true)
/** Fresh requests use the actual packet's native evidence. Saved replies keep
 * the historical parser, and are never rewritten to satisfy a newer grammar. */
export const editableRecognitionSchemaFor = (evidence: RecognitionEvidence) => modelSchema(true, evidence)

export function validateEditableData(kind: EditableTemplate['kind'], raw: unknown, config: EditableConfig = {}): EditableData {
  const data = editableDataSchema.parse(raw)
  const issues: string[] = []
  if (kind === 'table' && (!data.columns?.length || !data.rows?.length || data.rows.some(r=>r.length!==data.columns!.length))) issues.push('table-rectangular-data-required')
  if (kind === 'chart') {
    if (!config.chartType || !data.categories?.length || !data.series?.length || data.series.some(s=>s.values.length!==data.categories!.length)) issues.push(`chart-aligned-series-required: categories=${data.categories?.length??0}, series=${data.series?.map(s=>s.values.length).join(',')??'none'}; keep each wrapped category label as one entry`)
    if (['donut','pie'].includes(config.chartType??'') && (config.chartType==='pie'&&data.series?.length!==1 || data.series?.some(s=>s.values.some(v=>v!==null&&v<0)))) issues.push('circular-chart-needs-nonnegative-series')
    if (config.yMin!==undefined&&config.yMax!==undefined&&config.yMax<=config.yMin) issues.push('invalid-axis-range')
  }
  if (['timeline','gantt','radial','smartart','diagram','progress'].includes(kind) && !data.items?.length) issues.push('items-required')
  if (kind==='smartart') {
    const items=data.items??[],ids=new Set(items.map(i=>i.id)),parents=new Map(items.map(i=>[i.id,i.parentId]))
    if(ids.size!==items.length||items.some(i=>!i.id||i.parentId&&!ids.has(i.parentId)))issues.push('invalid-smartart-nodes')
    for(const item of items){const seen=new Set<string>();let at=item.id;while(at){if(seen.has(at)){issues.push('cyclic-smartart');break}seen.add(at);at=parents.get(at)}}
  }
  if (kind === 'gantt' && (!data.periods?.length || !data.items?.length || data.items.some(i=>!i.ranges?.length || i.ranges.some(r=>r.end<=r.start || r.end>data.periods!.length)))) issues.push('gantt-requires-data.periods-and-data.items[{title,ranges:[{start,end,color}]}]; start/end are positions on periods; do not use categories/series for gantt')
  if (['metric','feature','text'].includes(kind) && ![data.title,data.text,data.value].some(v=>v?.trim()) && !(['text','feature'].includes(kind)&&data.items?.some(i=>i.text?.trim()||i.title?.trim()||i.value?.trim()))) issues.push('editable-content-required')
  if (issues.length) throw new SemanticValidationError(issues)
  return data
}

export function validateEditableReply(raw: unknown, snapshot: SourceSnapshot, slideNumbers: number[], nativeObjects: {kind:string; sourceIds:string[]}[]): EditableReply {
  const parsed = editableReplySchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.slice(0,12).map(i=>`${i.path.join('.')}: ${i.message}`))
  const reply = expandMetricCollections(parsed.data, snapshot), sources = new Map(snapshot.elements.map(e=>[e.id,e])), issues: string[] = []
  if (reply.slides.length!==slideNumbers.length || new Set(reply.slides.map(s=>s.slide)).size!==slideNumbers.length || slideNumbers.some(n=>!reply.slides.some(s=>s.slide===n))) issues.push('every-supplied-slide-exactly-once')
  const all = reply.slides.flatMap(s=>s.blocks), byId = new Map(all.map(b=>[b.id,b]))
  let scene:SourceScene|undefined
  if (byId.size!==all.length) issues.push('duplicate-block-id')
  for (const slide of reply.slides) for (const b of slide.blocks) {
    if (b.adaptation) issues.push(...intentIssues(b, scene ??= readSourceScene(snapshot)).map(issue => `${b.id}:${issue}`))
    if (b.sourceIds.some(id=>sources.get(id)?.slide!==slide.slide)) issues.push(`unknown-or-cross-slide-source:${b.id}`)
    if (new Set(b.sourceIds).size!==b.sourceIds.length) issues.push(`duplicate-source:${b.id}`)
    const native=nativeObjects.some(t=>t.kind===b.kind&&t.sourceIds.some(id=>b.sourceIds.includes(id)))
    if (b.kind==='smartart'&&!native) issues.push(`native-object-required:${b.id}; use diagram for source shapes, with empty data`)
    if (!native&&b.kind!=='diagram') {
      try { validateEditableData(b.kind,b.data,b.config) } catch(e) {
        const graphicOnly=e instanceof SemanticValidationError&&e.issues.length===1&&e.issues[0]==='editable-content-required'&&graphicOnlyProposal(b,scene??=readSourceScene(snapshot))
        if(!graphicOnly)issues.push(`${b.id}:${e instanceof SemanticValidationError?e.issues.join(','):'invalid-data'}`)
      }
      if(b.dataStatus==='native')issues.push(`native-data-not-supplied:${b.id}`)
    }
    if (b.kind==='composition') {
      if (b.memberIds.length<2 || b.memberIds.some(id=>!byId.has(id) || byId.get(id)!.kind==='composition' || !slide.blocks.some(c=>c.id===id))) issues.push(`invalid-composition-members:${b.id}`)
    } else if (b.memberIds.length) issues.push(`component-has-members:${b.id}`)
    for (const graphicId of [b.data.graphicId,...(b.data.items??[]).map(i=>i.graphicId)].filter(Boolean) as string[]) {
      const s=sources.get(graphicId)
      if (!s || s.slide!==slide.slide || s.kind==='text' || s.kind==='source-picture') issues.push(`invalid-graphic-source:${graphicId}`)
    }
  }
  if (issues.length) throw new SemanticValidationError([...new Set(issues)])
  return reply
}
