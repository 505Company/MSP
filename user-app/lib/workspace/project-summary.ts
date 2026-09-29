import { readLayoutJob, type LayoutJob } from '../presentations/layout-jobs'
import { loadSlide } from '../slides/storage'
import { getProject } from './storage'
import type { PresentationProject, ProjectSummary } from './types'
import { readStudioRun } from '../presentations/studio/storage'
import { latestStudioRun } from '../presentations/studio/generations'

type PreviewRef = { inputId: string; slideId: string; round: number; render: string }
type SavedRender = { fit?: { passed: boolean }; preview?: string; report?: { passed: boolean; preview?: string } }
const renderKey = (id: string, ref: PreviewRef) => `presentation-layouts/${id}/${ref.inputId}/${ref.slideId}/round-${ref.round}/render-${ref.render}.json`
const isTemplateRender = (version: string) => /^template-render-\d+$/.test(version)
const compatibleRender = (job: LayoutJob, version: string) => version === job.renderVersion || isTemplateRender(version) || ['adaptive-render-1', 'adaptive-render-2', 'adaptive-render-3', 'adaptive-render-4', 'adaptive-render-5', 'adaptive-render-6', 'adaptive-render-7', 'adaptive-render-8', 'adaptive-render-9'].includes(version)
function savedPreview(saved: SavedRender | null, render: string) {
  const passed = isTemplateRender(render) ? saved?.report?.passed : saved?.fit?.passed
  const preview = isTemplateRender(render) ? saved?.report?.preview : saved?.preview
  return passed && preview?.startsWith('data:image/png;base64,') ? preview : null
}

/** Read saved evidence only. Listing projects must never start a model job,
 * rebuild the style library, or treat a result for old inputs as current. */
async function savedPreviews(bucket: R2Bucket, job: LayoutJob, firstOnly = false): Promise<PreviewRef[]> {
  const prefix = `presentation-layouts/${job.id}/${job.inputId}/`, refs: PreviewRef[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
    for (const { key } of page.objects) {
      const match = key.slice(prefix.length).match(/^([a-zA-Z0-9_-]+)\/round-(\d+)\/render-([a-zA-Z0-9_-]+)\.json$/)
      if (match && compatibleRender(job, match[3])) refs.push({ inputId: job.inputId, slideId: match[1], round: Number(match[2]), render: match[3] })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  const order = new Map(job.slides?.map((slide, index) => [slide.id, index]))
  refs.sort((a, b) => (order.get(a.slideId) ?? Infinity) - (order.get(b.slideId) ?? Infinity) || a.slideId.localeCompare(b.slideId, 'en', { numeric: true }) || b.round - a.round)
  const result: PreviewRef[] = [], seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.slideId)) continue
    const file = await bucket.get(renderKey(job.id, ref)), saved = file && await file.json<SavedRender>()
    if (savedPreview(saved, ref.render)) {
      result.push(ref); seen.add(ref.slideId)
      if (firstOnly) break
    }
  }
  return result
}
const previewUrl = (id: string, ref: PreviewRef) => `/api/projects/${id}/preview?${new URLSearchParams({ ...ref, round: String(ref.round) })}`

export async function readProjectPresentation(bucket: R2Bucket, projectId: string) {
  const current = await getProject(bucket,projectId)
  if(current?.generationMode&&!current.archivedAt){const run=await readStudioRun(bucket,projectId,current.revision)??await latestStudioRun(bucket,projectId)
    return run?.status==='complete'?{inputId:run.id,slides:run.slides.filter(s=>!run.deletedSlideIds?.includes(s.content.id)).map(s=>({id:s.content.id,title:s.content.title,image:`/api/projects/${projectId}/compose/preview?revision=${run.revision}&slideId=${s.content.id}`,status:'Готов'}))}:null}
  const [project, job] = await Promise.all([getProject(bucket, projectId), readLayoutJob(bucket, projectId)])
  if (!project || project.archivedAt || !job || job.status !== 'complete' || job.sourceRevision !== project.revision) return null
  const refs = await savedPreviews(bucket, job)
  return { inputId: job.inputId, slides: refs.map((ref, index) => ({ id: ref.slideId, title: job.slides?.find(s => s.id === ref.slideId)?.title ?? `Слайд ${index + 1}`, image: previewUrl(projectId, ref), status: 'Готов' })) }
}

export async function summarizeProject(bucket: R2Bucket, project: PresentationProject): Promise<ProjectSummary> {
  const { text, ...base } = project
  void text
  if(project.generationMode){const run=await readStudioRun(bucket,project.id,project.revision)??await latestStudioRun(bucket,project.id),ready=run?.slides.flatMap(s=>{const r=run.results[s.content.id];return r?.passed&&!run.deletedSlideIds?.includes(s.content.id)?[r]:[]})??[]
    return {...base,slideCount:run?.slides.filter(s=>!run.deletedSlideIds?.includes(s.content.id)).length??0,objectCount:ready.reduce((n,r)=>n+r.text.length+r.components.length,0),readyCount:ready.length,status:!run?'draft':run.status==='complete'?(run.revision===project.revision?'ready':'changed'):run.status==='blocked'?'blocked':'working',previewUrl:ready[0]?`/api/projects/${project.id}/compose/preview?revision=${run!.revision}&slideId=${ready[0].slideId}`:null}}
  const [job, legacy] = await Promise.all([readLayoutJob(bucket, project.id), loadSlide(bucket, project.id, 'project')])
  const summary: ProjectSummary = { ...base, slideCount: 0, objectCount: legacy?.document.items.length ?? 0, readyCount: 0, status: 'draft', previewUrl: null }
  if (job) {
    if (job.sourceRevision !== project.revision || job.status === 'cancelled') return { ...summary, status: 'changed' }
    const total = Math.max(0, job.progress.total ?? 0), ready = Math.min(total, Math.max(0, job.progress.completed ?? 0))
    const ref = (await savedPreviews(bucket, job, true))[0]
    return { ...summary, slideCount: total, readyCount: job.status === 'complete' ? total : ready,
      status: job.status === 'complete' ? 'ready' : job.status === 'blocked' ? 'blocked' : 'working',
      previewUrl: ref ? previewUrl(project.id, ref) : null }
  }
  if (legacy?.document.items.length) return { ...summary, slideCount: 1, status: 'saved' }
  return summary
}

export async function readProjectPreview(bucket: R2Bucket, projectId: string, ref: PreviewRef): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(ref.inputId) || !/^[a-zA-Z0-9_-]+$/.test(ref.slideId) || !/^(?:layout-dom|template-render|adaptive-render)-\d+$/.test(ref.render) || !Number.isInteger(ref.round) || ref.round < 0 || ref.round > 1) return null
  const [project, job] = await Promise.all([getProject(bucket, projectId), readLayoutJob(bucket, projectId)])
  if (!project || project.archivedAt || !job || job.status === 'cancelled' || project.revision !== job.sourceRevision || ref.inputId !== job.inputId || !compatibleRender(job, ref.render)) return null
  const file = await bucket.get(renderKey(projectId, ref)), saved = file && await file.json<SavedRender>()
  return savedPreview(saved, ref.render)
}
