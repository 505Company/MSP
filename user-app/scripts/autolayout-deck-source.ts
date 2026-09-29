import type { LayoutFragment } from '../lib/presentations/layout-contract'
import { z } from 'zod'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'

export type DeckSource = {
  number: number; title: string; content: LayoutFragment[]; directions: string[]
  sequence: { line: number; raw: string; text: string; kind: 'content' | 'direction'; id: string }[]
}
// Explicit author annotations in the supplied benchmark, not a model's license
// to remove arbitrary prose. Every other nonempty line remains visible content.
const directionLines = new Set([
  'Мелкая подпись:', 'Отдельная карточка:', 'Справа две небольшие карточки:', 'Небольшой вывод:',
  'Более свободный двухколоночный слайд.', 'Внизу крупная цифра:',
  'Здесь можно сделать горизонтальную customer journey:', 'Внизу 3 коротких показателя:',
  'Можно сделать визуально более легкий слайд — четыре большие карточки.', 'Небольшая фраза снизу:',
  'Очень минималистичный слайд.', 'Слева огромно:', 'Справа три пункта:', 'Внизу:',
  'Очень простой финальный тезисный слайд.', 'Справа короткий вывод:',
])
export function parseAutolayoutDeckSource(raw: string): DeckSource[] {
  const slides: DeckSource[] = []
  for (const [index, rawLine] of raw.split(/\r?\n/u).entries()) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed === '---') continue
    const heading = /^(\d+)\.\s+\*\*(.+)\*\*$/u.exec(trimmed)
    if (heading) {
      if (Number(heading[1]) !== slides.length + 1) throw Error('Nonsequential slide heading')
      slides.push({ number: Number(heading[1]), title: heading[2], content: [], directions: [], sequence: [] })
    }
    const slide = slides.at(-1)
    if (!slide) throw Error('Content before the first slide')
    const text = trimmed.replace(/\\$/u, '').replace(/^[-]\s+/u, '').replace(/\*\*/gu, '').replace(/^\*(.*)\*$/u, '$1').trim()
    const kind = directionLines.has(text) ? 'direction' : 'content'
    const id = kind === 'direction' ? `d${slide.directions.length + 1}` : `f${slide.content.length + 1}`
    if (kind === 'direction') slide.directions.push(text)
    else slide.content.push({ id, text })
    slide.sequence.push({ line: index + 1, raw: rawLine, text, kind, id })
  }
  if (!slides.length || slides.some(s => s.content.length < 2)) throw Error('Empty slide source')
  return slides
}

/** Serialize shared ledger mutations while inference requests run concurrently. */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }
}

export function validateAutolayoutDeckReview(raw: unknown) {
  const value = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1).max(1000)).max(6) }).strict().parse(raw)
  if ((value.verdict === 'pass') !== (value.issues.length === 0)) throw new SemanticValidationError(['inconsistent-review'])
  return value
}
