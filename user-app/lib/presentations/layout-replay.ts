import { contentHash } from '../design-system/catalog'
import { readModelRun } from '../uploads/model-run'
import { parseModelJson } from '../uploads/qwen-structured'
import type { LayoutContext } from './layout-context'
import { resolveLayoutPlan, type LayoutEvidence, type LayoutInput, type LayoutResolution } from './layout-contract'

export type LayoutReplay = LayoutResolution & { evidence: LayoutEvidence; source: { prefix: string; runId: string; inputHash: string } }
const json = { httpMetadata: { contentType: 'application/json' } }
async function read<T>(bucket: R2Bucket, key: string) { const file = await bucket.get(key); return file ? file.json<T>() : null }

/** Recompile only exact legacy inputs. Raw replies, failed runs and old renders
 * remain immutable; new DOM reports and PNG reviews are always required. */
export async function replayLayoutPlan(bucket: R2Bucket, context: LayoutContext, input: LayoutInput): Promise<LayoutReplay | 'running' | null> {
  const key = `${context.prefix}/${input.slideId}/round-0/replay.json`
  const existing = await read<LayoutReplay>(bucket, key)
  if (existing) {
    resolveLayoutPlan(existing.plan, input, existing.evidence)
    return existing
  }
  if (!context.legacyPrefix || !context.legacyInputId) return null
  for (const round of [1, 0]) {
    const prefix = `${context.legacyPrefix}/${input.slideId}/round-${round}/plan`, run = await readModelRun(bucket, prefix)
    if (!run) continue
    if (run.status === 'running' && Date.now() - Date.parse(run.startedAt) < 660_000) return 'running'
    if (run.status !== 'complete' && run.error?.code !== 'SEMANTIC_VALIDATION') continue
    const saved = await read<{ task: { messages: { content: unknown }[] }; scope: { inputId: string }; model: unknown }>(bucket, `${prefix}/inputs/${run.inputHash}.json`)
    const evidence = await read<LayoutEvidence>(bucket, prefix.replace(/\/plan$/, '/evidence.json'))
    const reply = await read<{ content: string; identity: unknown; finishReason: string }>(bucket, run.clarificationRequests ? `${prefix}/clarifications/${run.id}/response.json` : `${prefix}/responses/${run.id}.json`)
    if (!saved || !evidence || !reply || reply.finishReason !== 'stop' || saved.scope.inputId !== context.legacyInputId || await contentHash(saved) !== run.inputHash || JSON.stringify(saved.model) !== JSON.stringify(reply.identity)) continue
    try {
      const source = JSON.parse(String(saved.task.messages[1].content)).source as { id: string; text: string }[]
      if (JSON.stringify(source.map(({ id, text }) => ({ id, text }))) !== JSON.stringify(input.content)) continue
      const resolution = resolveLayoutPlan(parseModelJson(reply.content), input, evidence)
      const replay: LayoutReplay = { ...resolution, evidence, source: { prefix, runId: run.id, inputHash: run.inputHash } }
      await bucket.put(key, JSON.stringify(replay), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
      return (await read<LayoutReplay>(bucket, key))!
    } catch { /* Incompatible evidence requires a fresh model plan, not manual repair. */ }
  }
  return null
}
