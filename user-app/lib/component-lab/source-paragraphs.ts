import type { TextElementIR } from '../../vendor/drag/src/core/model'

type Range = { start: number; end: number }
function clip<T extends Range>(runs: T[] | undefined, p: Range) {
  return runs?.filter(r => r.end > p.start && r.start < p.end)
    .map(r => ({ ...r, start: Math.max(r.start, p.start) - p.start, end: Math.min(r.end, p.end) - p.start }))
}
function covers(runs: Range[] | undefined, text: string) {
  if (!runs?.length) return false
  let end = 0
  for (const r of runs) {
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < end || r.end <= r.start || r.end > text.length || text.slice(end, r.start).trim()) return false
    end = r.end
  }
  return !text.slice(end).trim()
}

/** A common PPTX card stores its heading and body in one text shape. Derive
 * two fields only when paragraph boundaries and typography prove that split.
 * Native source/data stay intact; these ranges belong only to the box profile. */
export function titleBodyParagraphs(source: TextElementIR): TextElementIR[] | undefined {
  let paragraphs = source.paragraphs
  if (paragraphs?.length === 3 && paragraphs[1].start === paragraphs[1].end) paragraphs = [paragraphs[0], paragraphs[2]]
  // PPTX line breaks can share a paragraph. A single heading line followed by
  // a uniformly lighter body is an equally explicit boundary (speaker cards).
  const newline = source.text.indexOf('\n')
  const inlineHeading = paragraphs?.length === 1 && newline > 0 && source.text.indexOf('\n', newline + 1) < 0
  if (inlineHeading) paragraphs = [{ ...paragraphs![0], start: 0, end: newline }, { ...paragraphs![0], start: newline + 1, end: source.text.length }]
  if (paragraphs?.length !== 2 || (source.flow?.columns ?? 1) !== 1 || source.linkRuns?.length || /[\r\t]/.test(source.text)) return
  if (paragraphs.some(p => !source.text.slice(p.start, p.end).trim())) return
  if (!covers(paragraphs, source.text) || paragraphs.some(p => p.markerLength || p.indent || p.right || p.tabs?.length || (p.left ?? 0) < 0) || paragraphs[0].left !== paragraphs[1].left) return
  if (!covers(source.styleRuns, source.text) || !covers(source.colorRuns, source.text)) return
  const fields = paragraphs.map((p, i) => {
    const e = structuredClone(source)
    e.id = `${source.id}--paragraph-${i + 1}`
    e.text = source.text.slice(p.start, p.end)
    e.styleRuns = clip(source.styleRuns, p); e.colorRuns = clip(source.colorRuns, p)
    const style = e.styleRuns![0]
    e.fontFamily = style.fontFamily; e.fontStyle = style.fontStyle; e.fontSize = style.fontSize
    // A shared paragraph inset becomes card padding. Paragraph spacing belongs
    // to flex gap; lists, unequal insets and mixed runs are never flattened.
    e.bounds.x += p.left ?? 0
    e.paragraphs = [{ ...p, start: 0, end: e.text.length, left: 0, before: 0, after: 0 }]
    e.textBox = { vertical: 'TOP', wrap: true, ...e.textBox, align: p.align ?? e.textBox?.align ?? 'LEFT' }
    return e
  })
  const weightHierarchy = inlineHeading && /bold/i.test(fields[0].fontStyle ?? '') && !/bold/i.test(fields[1].fontStyle ?? '') && fields[0].fontSize >= fields[1].fontSize
  if (fields.some(e => !e.text.trim()) || !weightHierarchy && fields[0].fontSize < fields[1].fontSize * 1.15) return
  return fields
}
