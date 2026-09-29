import { z } from 'zod'
import type { StudioRun } from './contract'
import {readStudioRun} from './storage'

export type GenerationSummary = {
  revision: string; createdAt: string; mode: 'fast' | 'balanced' | 'creative'
  styleName: string; status: StudioRun['status']; slides: number
}
export const generationLabels = { fast: 'Быстрый', balanced: 'Сбалансированный', creative: 'Творческий' }
// Keep pending/blocked runs reachable, including before their slide list exists.
// Completed empty runs stay in storage for undo but disappear from the gallery.
export const isVisibleGeneration = (run: GenerationSummary) => run.slides > 0 || !['complete', 'cancelled'].includes(run.status)
export function generationSummary(run: StudioRun): GenerationSummary {
  // A stopped run only displays completed slides; unfinished work is not a
  // visible slide that could keep an otherwise deleted generation alive.
  const ids=new Set(run.status==='cancelled'
    ?run.slides.filter(s=>run.results[s.content.id]?.passed).map(s=>s.content.id)
    :[...run.slides.map(s=>s.content.id),...run.semantic?.units?.map(u=>u.id)??[]])
  return { revision: run.revision, createdAt: run.createdAt, mode: run.mode === 'fast' ? 'fast' : run.semantic?.strategy === 'components' ? 'creative' : 'balanced', styleName: run.library.name, status: run.status, slides: [...ids].filter(id=>!run.deletedSlideIds?.includes(id)).length }
}

/** Receipts embed fonts and editable HTML. A long gallery needs thumbnails,
 * not dozens of copies of these export payloads. The saved run stays intact. */
export function generationPreview(run: StudioRun): StudioRun {
  const receipt = (r: StudioRun['results'][string]) => ({ ...r, html: '' })
  return { ...run, previewOnly: true,
    library:{...run.library,prepared:{},editable:[],backgrounds:undefined},
    results: Object.fromEntries(Object.entries(run.results).map(([id, r]) => [id, receipt(r)])),
    slides: run.slides.map(s => ({ ...s,candidates:[],bindings:{},flexNodes:undefined,semanticBlocks:undefined,previousDesigns:undefined, options: s.options?.map(o => ({ ...o, receipt: o.receipt ? receipt(o.receipt) : undefined })) })),
  }
}

/** Worker polls carry status and one pending slide, never font-rich receipts. */
export function generationWorkView(run:StudioRun,slideId?:string,includeLibrary=true):StudioRun{
 const receipt=(r:StudioRun['results'][string])=>({...r,html:'',preview:'',text:[],components:[]})
 return {...run,library:includeLibrary?run.library:{...run.library,prepared:{},editable:[],backgrounds:undefined},
  results:Object.fromEntries(Object.entries(run.results).map(([id,r])=>[id,receipt(r)])),
  slides:run.slides.filter(s=>!slideId||s.content.id===slideId).map(s=>({...s,options:s.options?.map(o=>({...o,receipt:undefined}))})),
 }
}

/** Old revisions already contain complete snapshots. Discover them without
 * migrating, starting, or rewriting a generation when a project is opened. */
export async function listStudioGenerations(bucket: R2Bucket, projectId: string) {
  z.string().uuid().parse(projectId)
  const prefix = `presentation-studio/${projectId}/`, keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    keys.push(...page.objects.map(o => o.key).filter(key => /^[\da-f-]{36}\/run\.json$/i.test(key.slice(prefix.length))))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  const summaries: GenerationSummary[] = []
  // Parsing several font-rich snapshots at once exceeds small worker heaps.
  for (const key of keys) {
    const run = await (await bucket.get(key))?.json<StudioRun>()
    if (run?.projectId === projectId && run.library && run.createdAt) summaries.push(generationSummary(run))
  }
  return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revision.localeCompare(b.revision))
}

export async function latestStudioRun(bucket:R2Bucket,projectId:string){
  const latest=(await listStudioGenerations(bucket,projectId)).filter(isVisibleGeneration).at(-1)
  return latest?readStudioRun(bucket,projectId,latest.revision):null
}
