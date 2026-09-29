import { materialIdentity, MATERIAL_VERSION } from './material-identity'
import { QwenAnalysisError } from '../uploads/qwen-analysis'

// Adapted from packages/contracts/presentation.ts. Stored offsets are UTF-16,
// exactly as String.slice uses them; neither the model nor display labels edit text.
export const MAX_MATERIAL_LENGTH = 100_000
export const MAX_PART_LENGTH = 24_000
export const MAX_PART_FRAGMENTS = 120
export const MATERIAL_PARSER_VERSION = 'web-material-parser-2'
export type MaterialFragment = {
  id: string; text: string; start: number; end: number
  kind: 'content' | 'direction' | 'boundary'; displayStart: number; sectionId: string | null
}
export type PresentationMaterial = {
  id: string; version: typeof MATERIAL_VERSION; parserVersion: typeof MATERIAL_PARSER_VERSION; text: string
  fragments: MaterialFragment[]; explicitBoundaries: boolean
}
export type MaterialPart = { id: string; fragments: MaterialFragment[]; explicitBoundaries: boolean }
const limit = (message: string): never => { throw new QwenAnalysisError('CONTENT_LIMIT', message) }
const direction = /^(?:визуально|инфографика|оформление|композиция|дизайн|layout|visuals?)\s*:/iu
const heading = /^(?:#\s+|(?:слайд|slide)\s+\d+\s*[—–:.-]\s*)/iu
const standaloneSlide = /^(?:слайд|slide)\s+\d+\s*[—–:.-]?$/iu
const pureArrow = /^[↓↑→←⟶⟵]+$/u

/** Long prose splits at sentences, then words. Even a long unbroken token is
 * retained whole in meaning: safe UTF-16 spans account for every character. */
function spans(text: string): [number, number][] {
  const result: [number, number][] = []
  const sentences = [...new Intl.Segmenter('ru', { granularity: 'sentence' }).segment(text)]
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + 650, text.length)
    if (end < text.length) {
      const boundary = sentences.map(s => s.index + s.segment.length).filter(n => n > start && n <= end).at(-1)
      const space = text.slice(start, end).search(/\s+\S*$/u)
      if (boundary) end = boundary
      else if (space > 0) end = start + space
      else if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
    }
    result.push([start, end]); start = end
  }
  return result
}

export async function prepareMaterial(text: string): Promise<PresentationMaterial> {
  if (!text.trim() || text.length > MAX_MATERIAL_LENGTH || text.includes('\0')) limit('Нужен непустой текст до 100 000 символов.')
  const fragments: MaterialFragment[] = []
  let sectionId: string | null = null, section = 0, fence: string | null = null
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    const value = line[0].trim(), lineStart = line.index! + line[0].length - line[0].trimStart().length
    if (!value) continue
    const fenceToken = /^(?:`{3,}|~{3,})/.exec(value)?.[0]
    const inCode = Boolean(fence) || Boolean(fenceToken)
    if (fenceToken) {
      if (!fence) fence = fenceToken
      else if (fenceToken[0] === fence[0] && fenceToken.length >= fence.length) fence = null
    }
    const mark = !inCode ? heading.exec(value)?.[0] : undefined
    const boundary = !inCode && standaloneSlide.test(value)
    if (boundary || mark && value.slice(mark.length).trim()) sectionId = `section-${++section}`
    const kind = boundary ? 'boundary' : !inCode && (direction.test(value) || pureArrow.test(value)) ? 'direction' : 'content'
    // Heading syntax is accounted for by displayStart, not silently removed.
    for (const [a, b] of spans(value)) {
      const raw = value.slice(a, b), left = raw.length - raw.trimStart().length, exact = raw.trim()
      if (!exact) continue
      const start = lineStart + a + left
      fragments.push({ id: `f${fragments.length + 1}`, text: exact, start, end: start + exact.length,
        kind, displayStart: a === 0 && mark && !boundary ? mark.length : 0, sectionId })
    }
  }
  if (fragments.length > 1000) limit('В материале слишком много отдельных строк. Объедините связанные строки в абзацы; содержание сохранено.')
  if (!fragments.some(f => f.kind === 'content')) limit('Добавьте содержание презентации помимо указаний по оформлению.')
  if (section) {
    const preamble = fragments.filter(f => f.sectionId === null)
    // A leading formatting note belongs to the first real slide, never to an
    // empty slide of its own. Ordinary introductory prose remains a preamble.
    const section = preamble.every(f => f.kind === 'direction') ? 'section-1' : 'preamble'
    for (const f of preamble) f.sectionId = section
  }
  const id = await materialIdentity(text)
  return { id, version: MATERIAL_VERSION, parserVersion: MATERIAL_PARSER_VERSION, text, fragments, explicitBoundaries: section > 0 }
}

/** Bounded requests keep the existing 100k input usable. Explicit slides are
 * indivisible. Unstructured long material is processed in source order. */
export function materialParts(material: PresentationMaterial): MaterialPart[] {
  const units: MaterialFragment[][] = []
  for (const f of material.fragments) {
    const last = units.at(-1)
    if (material.explicitBoundaries && last?.[0].sectionId === f.sectionId) last.push(f)
    else units.push([f])
  }
  const parts: MaterialPart[] = []
  let current: MaterialFragment[] = [], size = 0, unitCount = 0
  const flush = () => {
    if (!current.length) return
    if (!current.some(f => f.kind === 'content')) limit('Добавьте текст рядом с указаниями по оформлению.')
    parts.push({ id: `part-${parts.length + 1}`, fragments: current, explicitBoundaries: material.explicitBoundaries })
    current = []; size = 0; unitCount = 0
  }
  for (const unit of units) {
    if (unit.some(f => f.kind === 'boundary') && !unit.some(f => f.kind === 'content')) limit('После номера слайда нужен текст. Пустой слайд не отправлен модели; исходник сохранён.')
    const length = unit.reduce((n, f) => n + f.text.length, 0)
    if (length > MAX_PART_LENGTH || unit.length > MAX_PART_FRAGMENTS) limit('В одном заданном слайде слишком много материала. Разделите его на несколько заголовков «#»; исходный текст сохранён.')
    if (size + length > MAX_PART_LENGTH || current.length + unit.length > MAX_PART_FRAGMENTS || material.explicitBoundaries && unitCount >= 24) flush()
    current.push(...unit); size += length; unitCount++
  }
  flush()
  return parts
}

export const visibleFragmentText = (fragment: MaterialFragment) => fragment.text.slice(fragment.displayStart)
