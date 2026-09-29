import { digest } from '../component-lab/source'
import { readPreparationJobs, readPreparedComponent, PREPARATION_VERSION, type PreparedComponent } from '../component-lab/preparation-jobs'
import type { PreparedBoxes } from './prepared-components'
import type { LayoutContext } from './layout-context'

type Project = { id: string; revision: number | string; uploadId: string }
const snapshotKey = (project: Project) => `presentation-component-profiles/${project.id}/${project.revision}.json`

/** Freeze one set per saved project revision. Existing presentation runs retain
 * their previous contract even when a background preparation finishes later. */
export async function projectPreparedBoxes(bucket: R2Bucket, project: Project, options: { adoptCurrent?: boolean } = {}) {
  const key = snapshotKey(project)
  const saved = await (await bucket.get(key))?.json<{ boxes: PreparedBoxes; hash: string }>()
  if (saved) { if (await digest(saved.boxes) !== saved.hash) throw Error('Снимок адаптивных компонентов повреждён.'); return saved.boxes }
  const old = await bucket.list({ prefix: `presentation-layouts/${project.id}/`, limit: 1 })
  const adopted = await bucket.list({ prefix: `presentation-component-profiles/${project.id}/`, limit: 1 })
  const boxes: PreparedBoxes = {}
  if (options.adoptCurrent || !old.objects.length || adopted.objects.length) for (const job of await readPreparationJobs(bucket, project.uploadId)) {
    if (job.status !== 'complete' || !job.result?.generationAdmission) continue
    let ready: PreparedComponent | null
    try { ready = await readPreparedComponent(bucket, project.uploadId, job.componentId) } catch { continue }
    if (!ready?.generationAdmission || ready.version !== PREPARATION_VERSION || ready.fidelity.status !== 'preserved') continue
    const { version, inputHash, ruleRevision, profile, rules, faces, assets, proofHash, fidelity } = ready
    boxes[job.componentId] = { version, inputHash, ruleRevision, profile, rules, faces, assets, proofHash, fidelity, sourceContent: ready.source.content }
  }
  return boxes
}

/** GET may observe current qualified components; only an explicit generation
 * action freezes that exact observed set, including an intentionally empty set. */
export async function pinPreparedContext(bucket: R2Bucket, context: Pick<LayoutContext, 'projectId' | 'sourceRevision' | 'uploadId' | 'inputs'>) {
  const key = snapshotKey({ id: context.projectId, revision: context.sourceRevision, uploadId: context.uploadId })
  const boxes = context.inputs[0]?.preparedComponents ?? {}
  if (context.inputs.some(input => JSON.stringify(input.preparedComponents ?? {}) !== JSON.stringify(boxes))) throw Error('Снимки компонентов слайдов различаются.')
  const next = { boxes, hash: await digest(boxes) }
  if (await bucket.put(key, JSON.stringify(next), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })) return
  const winner = await (await bucket.get(key))!.json<typeof next>()
  if (await digest(winner.boxes) !== winner.hash || winner.hash !== next.hash) throw Error('Состав подготовленных компонентов изменился. Обновите состояние генерации.')
}
