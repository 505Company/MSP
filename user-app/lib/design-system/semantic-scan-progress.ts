import type { ScanRun } from './semantic-scan'

/** Processed packets include failed attempts, but these never become ready
 * components. Share this wording between the executor and read-only observer. */
export function semanticScanProgress(run: Pick<ScanRun, 'parts'>) {
  const ready = run.parts.filter(p => p.status === 'complete' || p.status === 'partial').length
  const omissions = run.parts.filter(p => p.status === 'partial' || p.status === 'skipped').length
  const failed = run.parts.filter(p => p.status === 'failed')
  const completed = run.parts.filter(p => ['complete', 'partial', 'skipped', 'failed'].includes(p.status)).length
  const summary = [`Готово: ${ready}`, ...(omissions ? [`с пропусками: ${omissions}`] : []), ...(failed.length ? [`ожидают повтор: ${failed.length}`] : [])]
  return { completed, total: run.parts.length,
    detail: completed ? `Анализ пакетов. ${summary.join('; ')}.${failed.at(-1)?.error ? ` ${failed.at(-1)!.error}` : ''}`
      : 'Анализируем слайды и проверяем найденные элементы' }
}
