import type { PreparationInput } from '../../lib/component-lab/preparation-jobs'
import { resolveComponentFonts } from './fonts'
import { checkQuality, qualityProof } from './qualification'
import { sourceConstraints } from '../../lib/component-lab/source-check'
import { measureComponent, pixelEvidence } from './measure'

/** One component per worker lease; no hidden work in the user's editor. */
export async function executeComponentPreparation(upload: string, jobId: string, token: string, signal: AbortSignal) {
  const advance = async (report?: unknown) => {
    const response = await fetch(`/api/uploads/${encodeURIComponent(upload)}/component-preparation`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'work', jobId, token, ...(report ? { report } : {}) }) })
    const value = await response.json() as { done?: boolean; input?: PreparationInput; error?: string }
    if (!response.ok) throw Error(value.error ?? 'Не удалось подготовить компонент.')
    return value
  }
  const next = await advance(); if (next.done) return
  if (!next.input) throw Error('Отсутствует исходный профиль.')
  const resolved = await resolveComponentFonts(upload, next.input.profile, next.input.rules, { portable: true })
  signal.throwIfAborted()
  const report = await checkQuality(resolved.profile, resolved.fonts, { signal })
  signal.throwIfAborted()
  const target = document.createElement('div'); Object.assign(target.style, { position: 'fixed', left: '-20000px', top: '0' }); document.body.appendChild(target)
  try {
    const measured = await measureComponent(resolved.profile, next.input.content, sourceConstraints(resolved.profile), resolved.fonts, { signal, target })
    const evidence = measured.status === 'fits' ? await pixelEvidence(target.firstElementChild as HTMLElement, measured.chosen!, resolved.fonts) : undefined
    await advance({ rules: resolved.rules, proof: qualityProof(report), source: { id: 'source', status: measured.status, chosen: measured.chosen, pixels: evidence?.pixels, ...(evidence?.artwork ? { artwork: evidence.artwork } : {}) }, faces: resolved.fonts.faces ?? [], assets: resolved.fonts.artwork?.assets ?? [] })
  } finally { target.remove() }
}
