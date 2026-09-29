import { z } from 'zod'
import type { EditableTemplate } from './editable-contract'
import { nativeBoundText } from './editable-native-layout'

export const COMPONENT_FLOW_VERSION = 'metric-caption-flow-1'
export type ComponentFlow = {
  version: typeof COMPONENT_FLOW_VERSION; kind: 'number-caption'; metric: number; caption: number;
  direction: 'row' | 'stack'; breakpoint: number; fraction: number;
  padding: number; gap: number; minWidth: number; maxWidth: number; maxHeight: number;
  fontScale: number; minHeight: number;
}
/** Only source rectangles and round rectangles, never charts, illustrations or
 * text-bearing raster surfaces. Their source SVG remains the decoration. */
function panelArtwork(svg: string) {
  if (/<(?:image|text|ellipse|line|polygon|polyline|foreignObject|use)\b/i.test(svg)) return false
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m => m[1])
  if (!paths.length && !/<rect\b/.test(svg)) return false
  return paths.every(path => {
    if (path.replace(/[-+\d.e\s,]/g, '') !== 'MLCLCLCLCZ') return false
    const n = path.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
    if (n.length !== 34) return false
    const r = n[0], w = n[2] + r, h = n[11] + r, k = .5522847498307936
    if (r <= 0 || r > Math.min(w,h)/2+.01) return false
    const expected = [r,0,w-r,0,w-r+r*k,0,w,r-r*k,w,r,w,h-r,w,h-r+r*k,w-r+r*k,h,w-r,h,r,h,r-r*k,h,0,h-r+r*k,0,h-r,0,r,0,r-r*k,r-r*k,0,r,0]
    return expected.every((v,i) => Math.abs(v-n[i]) < .02)
  })
}
export function proposeComponentFlow(t: EditableTemplate): ComponentFlow | null {
  const l=t.sourceLayout
  if(t.kind!=='metric'||!l||l.bar||t.children||t.sourceChart||t.sourceInline||t.sourceRegion||l.text.length!==2||l.structure?.panels!==1||!panelArtwork(l.graphic))return null
  const metric=l.text.findIndex(s=>['value','metric'].includes(s.binding.field)),caption=1-metric
  if(metric<0||l.text.some(s=>s.element.rotation||s.element.centeredTransform?.flipH||s.element.centeredTransform?.flipV||!s.element.visible||s.recoveredAsset))return null
  if(l.text.some(s=>!nativeBoundText(s,t.data).text.trim()))return null
  const m=l.text[metric].element,c=l.text[caption].element
  if(c.fontSize<=0||m.fontSize<c.fontSize*1.5)return null
  const fontScale=Math.max(1,Math.min(2,32/c.fontSize)),padding=Math.max(16,Math.min(48,Math.min(m.bounds.x,c.bounds.x,m.bounds.y)*fontScale))
  const row=c.bounds.x>=m.bounds.x+m.bounds.width-4
  if(!row&&c.bounds.y<m.bounds.y+m.bounds.height-4)return null
  return {version:COMPONENT_FLOW_VERSION,kind:'number-caption',metric,caption,direction:row?'row':'stack',breakpoint:Math.max(520,Math.min(720,t.width*fontScale*.75)),fraction:Math.max(.3,Math.min(.65,m.bounds.width/(m.bounds.width+c.bounds.width))),padding,gap:Math.max(12,Math.min(32,(row?c.bounds.x-m.bounds.x-m.bounds.width:c.bounds.y-m.bounds.y-m.bounds.height)*fontScale)),minWidth:320,maxWidth:1000,maxHeight:720,fontScale,minHeight:Math.max(140,Math.min(320,t.height*fontScale))}
}
export const componentFlowCheckSchema=z.object({id:z.string(),name:z.string(),profile:z.string().regex(/^[a-f0-9]{64}$/),passed:z.boolean(),cases:z.array(z.object({name:z.string(),width:z.number(),height:z.number(),passed:z.boolean(),expected:z.boolean(),issues:z.array(z.string()),pixels:z.array(z.number())}).strict()).max(20),issues:z.array(z.string())}).strict()
export const componentFlowReportSchema=z.object({version:z.literal(COMPONENT_FLOW_VERSION),catalogId:z.string().regex(/^[a-f0-9]{64}$/),checks:z.array(componentFlowCheckSchema).max(2000)}).strict()
export type ComponentFlowReport=z.infer<typeof componentFlowReportSchema>
export async function flowProfileKey(t:EditableTemplate) {
  const value=JSON.stringify({profile:proposeComponentFlow(t),source:t.sourceIds,layout:t.sourceLayout,data:t.data})
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function qualifiedComponentFlow(t:EditableTemplate,report:ComponentFlowReport|undefined) {
  const profile=await flowProfileKey(t)
  const check=report?.version===COMPONENT_FLOW_VERSION&&report.checks.find(c=>c.id===t.id&&c.passed&&c.profile===profile)
  return check?proposeComponentFlow(t):null
}
export function componentCapabilities(t:EditableTemplate,flow:ComponentFlow|null=null) {
  const slots=t.sourceLayout?.text.map((s,i)=>({sourceId:s.element.id,role:i===flow?.metric?'number':i===flow?.caption?'caption':s.binding.field==='metric'?'number':s.binding.field,required:true,binding:s.binding,order:i}))??[]
  return {mode:flow?'adaptive':slots.length?'fixed-native':'graphic-only',text:!!slots.length,data:slots.some(s=>['value','number','metric'].includes(s.role)),colors:false,width:!!flow,height:!!flow,slots,...(flow?{layout:flow,artisticStatus:'not-reviewed'}:{})}
}

export const flowCases=[
 {name:'short-min',width:320,value:'73%',caption:'Новые заявки',expected:true},
 {name:'medium',width:560,value:'128',caption:'Пользователи завершили оформление и получили подтверждение',expected:true},
 {name:'long',width:880,value:'128,4 тыс.',caption:'Подробное пояснение показателя: учитываем все обращения за отчётный период и сохраняем полный текст без сокращений и скрытых строк.',expected:true},
 {name:'unequal-lines',width:560,value:'42',caption:'Короткая строка\nПодробное пояснение условий измерения и результата',expected:true},
 {name:'max-width',width:1000,value:'7 507',caption:'Всего участников',expected:true},
 {name:'overflow',width:320,value:'73%',caption:'Содержание должно быть сохранено полностью. '.repeat(65),expected:false},
 {name:'below-min',width:280,value:'73%',caption:'Новые заявки',expected:false},
] as const
