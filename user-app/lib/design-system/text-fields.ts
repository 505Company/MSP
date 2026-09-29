import type { TextElementIR } from '../../vendor/drag/src/core/model'
import type { TextSlot } from './types'

type Range = { start: number; end: number }
const properties = (range: Range) => JSON.stringify(Object.fromEntries(Object.entries(range).filter(([key]) => key !== 'start' && key !== 'end')))
const same = (ranges: Range[] = []) => new Set(ranges.map(properties)).size <= 1
function coalesce<T extends Range>(ranges: T[] = []) {
  const result: T[] = []
  for (const r of ranges) {
    const previous = result.at(-1)
    if (previous?.end === r.start && properties(previous) === properties(r)) previous.end = r.end
    else result.push({ ...r })
  }
  return result
}
const boundary = (text: string, at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]))
function validRanges(ranges: Range[] = [], length: number) {
  return ranges.every((r, i) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end >= r.start && r.end <= length && (!i || r.start >= ranges[i - 1].end))
}
function coversText(ranges: Range[] = [], text: string) {
  if (!ranges.length) return true
  let cursor = 0
  for (const r of ranges) { if (text.slice(cursor, r.start).replace(/\n/g, '')) return false; cursor = r.end }
  return !text.slice(cursor).replace(/\n/g, '')
}
function uniform(e: TextElementIR) {
  return same(e.styleRuns) && same(e.colorRuns) && same(e.paragraphs) && !e.paragraphs?.some(p => p.markerLength) && coversText(e.styleRuns, e.text) && coversText(e.colorRuns, e.text)
}

/** Only creates fields inside a TEXT that the semantic model already selected.
 * Uniform text gets one field. Rich text gets explicit source ranges; separators,
 * paragraph boundaries and native list prefixes are retained, never redistributed. */
export function createTextFields(e: TextElementIR, label: string): TextSlot[] {
  if (!e.text.trim() || e.linkRuns?.length || /[\r\t\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e.text) || (e.flow?.columns ?? 1) !== 1 || e.paragraphs?.some(p => p.tabs?.length)) return []
  if (![e.styleRuns, e.colorRuns, e.paragraphs].every(r => validRanges(r, e.text.length))) return []
  const slot = (id: string, text: string, range?: Range): TextSlot => ({ id, elementId: e.id, label, defaultText: text, policy: 'fixed-box', maxLength: 5000, ...(range ? { range } : {}) })
  if (uniform(e)) return [slot(e.id, e.text)]
  const points = new Set([0, e.text.length]), protectedRanges: Range[] = []
  const styles = coalesce(e.styleRuns), colors = coalesce(e.colorRuns)
  for (const ranges of [styles, colors, e.paragraphs]) for (const r of ranges ?? []) { points.add(r.start); points.add(r.end) }
  for (const p of e.paragraphs ?? []) if (p.markerLength) {
    if (p.markerLength < 0 || p.start + p.markerLength > p.end) return []
    protectedRanges.push({ start: p.start, end: p.start + p.markerLength }); points.add(p.start + p.markerLength)
  }
  for (let i = 0; i < e.text.length; i++) if (e.text[i] === '\n') { points.add(i); points.add(i + 1) }
  const bounds = [...points].sort((a, b) => a - b)
  if (bounds.some(p => !boundary(e.text, p))) return []
  const spans: Range[] = []
  const styleAt = (at: number) => JSON.stringify([styles.find(r => r.start <= at && at < r.end), colors.find(r => r.start <= at && at < r.end), e.paragraphs?.find(r => r.start <= at && at < r.end)].map(r => r ? properties(r) : null))
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1], text = e.text.slice(start, end)
    if (!text.trim() || protectedRanges.some(r => start >= r.start && end <= r.end)) continue
    const previous = spans.at(-1)
    if (previous?.end === start && styleAt(previous.start) === styleAt(start)) previous.end = end
    else spans.push({ start, end })
  }
  if (!spans.length || spans.length > 32) return []
  return spans.map((r, i) => {
    // Keep spaces between differently styled fragments outside the values.
    const text = e.text.slice(r.start, r.end), start = r.start + text.length - text.trimStart().length, end = r.end - text.length + text.trimEnd().length
    return { ...slot(`${e.id}--part-${i + 1}`, e.text.slice(start, end), { start, end }), label: `${label} · часть ${i + 1}` }
  })
}

/** Called on a cloned element. Ranges always refer to the immutable source. */
export function fillTextFields(e: TextElementIR, slots: TextSlot[], values: Record<string, string>) {
  if (e.flow) e.flow.autoFit = 'NONE'
  const edits = slots.map(slot => ({ slot, value: values[slot.id] ?? slot.defaultText }))
  if (edits.every(({ slot, value }) => value === slot.defaultText)) return
  if (slots.length === 1 && !slots[0].range) {
    if (!uniform(e) || e.linkRuns?.length) throw new Error('Для смешанного оформления нужны отдельные текстовые поля')
    const text = edits[0].value
    e.text = text
    e.styleRuns = e.styleRuns?.slice(0, 1).map(r => ({ ...r, start: 0, end: text.length })).filter(r => r.end > 0)
    e.colorRuns = e.colorRuns?.slice(0, 1).map(r => ({ ...r, start: 0, end: text.length })).filter(r => r.end > 0)
    if (e.paragraphs?.length) { const p = e.paragraphs[0]; let start = 0; e.paragraphs = text.split('\n').map(line => { const row = { ...p, start, end: start + line.length }; start += line.length + 1; return row }) }
    return
  }
  const allowed = createTextFields(e, slots[0].label)
  if (e.styleRuns) e.styleRuns = coalesce(e.styleRuns)
  if (e.colorRuns) e.colorRuns = coalesce(e.colorRuns)
  const sorted = edits.map(({ slot, value }) => {
    const r = slot.range
    if (!r || !allowed.some(a => a.range?.start === r.start && a.range.end === r.end) || slot.defaultText !== e.text.slice(r.start, r.end) || value.includes('\n')) throw new Error('Сохраняйте отдельные части текста и исходные абзацы')
    return { ...r, value }
  }).sort((a, b) => a.start - b.start)
  if (!validRanges(sorted, e.text.length)) throw new Error('Текстовые поля пересекаются')
  const offset = (position: number) => {
    let delta = 0
    for (const edit of sorted) {
      if (position >= edit.end) delta += edit.value.length - (edit.end - edit.start)
      else if (position > edit.start) throw new Error('Граница оформления попала внутрь текстового поля')
    }
    return position + delta
  }
  const remap = <T extends Range>(ranges: T[] | undefined) => ranges?.map(r => ({ ...r, start: offset(r.start), end: offset(r.end) }))
  let cursor = 0, text = ''
  for (const edit of sorted) { text += e.text.slice(cursor, edit.start) + edit.value; cursor = edit.end }
  e.text = text + e.text.slice(cursor)
  e.styleRuns = remap(e.styleRuns)?.filter(r => r.end > r.start)
  e.colorRuns = remap(e.colorRuns)?.filter(r => r.end > r.start)
  e.paragraphs = remap(e.paragraphs)
}
