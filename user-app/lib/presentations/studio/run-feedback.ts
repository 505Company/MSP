import { compactPackets } from './compact-content'
import type { StudioRun } from './contract'

export function displayStudioError(error: string) {
  const lines=error.split('\n').map(line=>line.replace(/^(?:slide-)?\d+:\s*/,''))
  if(lines.length>1&&new Set(lines).size===1)error=lines[0]
  if (/"validation"|"invalid_string"|"invalid_type"/.test(error)) return 'Модель вернула неверные ссылки на блоки. Слайд не собран.'
  if (/unknown-or-duplicate|missing-fragments|Смысловой разбор не сохранил/.test(error)) return 'Модель пропустила или повторила часть содержания. Слайд не собран.'
  return error
}

/** Frozen packets are never silently rewritten on resume. A visible restart
 * notice prevents another paid attempt against a known outdated input parse. */
export function needsStudioReparse(run: StudioRun) {
  if (run.status === 'complete' || run.status === 'cancelled' || !run.semantic?.units) return false
  try { return JSON.stringify(compactPackets(run.semantic.source)) !== JSON.stringify(run.semantic.units.map(u => u.packet)) }
  catch { return false }
}

/** Failed semantic jobs have no SlideWork yet, but still occupy their original
 * numbered place in the deck. Never renumber successful neighbors around them. */
export function studioSlideFeedback(run: StudioRun) {
  const units = run.semantic?.units
  return (units?.flatMap(u => [u.id, ...run.slides.filter(s => s.fallback?.sourceSlideId === u.id && s.content.id !== u.id).map(s => s.content.id)]) ?? run.slides.map(s => s.content.id)).filter(id=>!run.deletedSlideIds?.includes(id)).map(id => {
    const work = run.slides.find(s => s.content.id === id), unit = units?.find(u => u.id === id)
    return { id, work, result: run.results[id], title: work?.content.title ?? unit?.packet.atoms[0]?.text ?? `Слайд ${(unit?.packet.index ?? 0) + 1}`,
      error: work?.error ?? unit?.error }
  })
}
