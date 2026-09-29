import { toPng } from 'html-to-image'
import { contentHash } from '../lib/design-system/catalog'
import { fallbackSource, fallbackWork, fallbackItems, fallbackPage, validateFallbackCoverage, type FallbackPiece, type FallbackItem } from '../lib/presentations/studio/fallback-content'
import { renderStudioOptions } from './studio-generation'
import { studioTheme } from '../lib/presentations/studio/theme'
import type { RenderReceipt, StudioRun } from '../lib/presentations/studio/contract'
import { prepareLayoutFonts } from './layout-fonts'
import { renderStudioData, studioDataInstance } from './studio-data'

type Page = { root: HTMLElement; pieces: FallbackPiece[]; y: number }
const WIDTH = 1760, TOP = 80, BOTTOM = 1000

/** Last-resort composition: measured text flow and native data, continued on
 * additional slides instead of dropping content or shrinking it to fit. */
export async function renderStudioFallback(run: StudioRun, slideId: string, signal?: AbortSignal) {
  const started = performance.now(), source = fallbackSource(run, slideId), items = fallbackItems(source)
  const basis = await contentHash(source), theme = studioTheme(run.library)
  try {
    const options = await renderStudioOptions(run.library, fallbackWork(run, slideId), signal, { limit: 1 })
    return { basis, recipe: { id: options[0].id, receipt: options[0].receipt! } }
  } catch (error) { if (signal?.aborted) throw error }
  let family = theme.font, fontCSS = ''
  try { fontCSS = Object.values((await prepareLayoutFonts({ uploadId: run.library.uploadId, fonts: [{ id: 'fallback', family }] })).css).join('\n') }
  catch { family = 'Arial' }
  const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, { position: 'fixed', left: '-26000px', top: '0', pointerEvents: 'none' }); document.body.appendChild(host)
  const pages: Page[] = []
  function newPage() {
    const root = document.createElement('div'); root.dataset.studioSlide = slideId
    Object.assign(root.style, { width: '1920px', height: '1080px', position: 'relative', boxSizing: 'border-box', background: theme.background, color: theme.ink, fontFamily: `${JSON.stringify(family)}, Arial, sans-serif`, overflow: 'hidden' })
    if (pages.length) {
      const label = document.createElement('div'); label.textContent = `Продолжение · ${pages.length + 1}`
      Object.assign(label.style, { position: 'absolute', left: '80px', top: '28px', fontSize: '20px', color: theme.ink }); root.appendChild(label)
    }
    host.appendChild(root); const page = { root, pieces: [] as FallbackPiece[], y: TOP }; pages.push(page); return page
  }
  let page = newPage()
  const frame = () => {
    const el = document.createElement('div'); el.dataset.block = `f${page.pieces.length + 1}`
    Object.assign(el.style, { position: 'absolute', left: '80px', top: `${page.y}px`, width: `${WIDTH}px`, boxSizing: 'border-box' }); page.root.appendChild(el); return el
  }
  function textField(el: HTMLElement, item: FallbackItem) {
    const field = document.createElement('div'); field.dataset.field = item.field
    const size = item.role === 'title' ? 52 : item.field === 'value' ? 64 : /heading|marker/.test(item.field) ? 32 : 28
    Object.assign(field.style, { fontSize: `${size}px`, fontWeight: item.role === 'title' || /value|heading|marker/.test(item.field) ? '700' : '400', lineHeight: '1.25', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: item.role === 'title' || item.field === 'value' ? theme.accent : theme.ink })
    el.appendChild(field); return field
  }
  function table(el: HTMLElement, item: FallbackItem) {
    const data = item.data!.values, table = document.createElement('table')
    Object.assign(table.style, { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '28px', lineHeight: '1.25', color: theme.ink })
    for (const [i, row] of [data.columns ?? [], ...data.rows ?? []].entries()) {
      const tr = table.insertRow()
      for (const value of row) {
        const cell = document.createElement(i ? 'td' : 'th'); cell.textContent = value
        Object.assign(cell.style, { padding: '14px', verticalAlign: 'top', textAlign: 'left', fontWeight: i ? '400' : '700', borderBottom: `1px solid ${theme.ink}33`, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', color: i ? theme.ink : theme.accent }); tr.appendChild(cell)
      }
    }
    el.appendChild(table)
  }
  function record(piece: FallbackPiece, el: HTMLElement) { page.pieces.push(piece); page.y += el.getBoundingClientRect().height + 28 }
  try {
    for (const item of items) {
      signal?.throwIfAborted()
      if (item.data) {
        let el = frame()
        const draw = () => {
          if (item.data!.template.kind === 'table') table(el, item)
          else {
            el.style.height = '720px'
            const instance = studioDataInstance(item.data!.template, item.data!.values, WIDTH)
            renderStudioData(el, { ...instance.template, width: WIDTH, height: 720, style: { ...instance.template.style, font: family } }, instance.data)
          }
        }
        try {
          draw()
          if (page.y + el.getBoundingClientRect().height > BOTTOM && page.pieces.length) { el.remove(); page = newPage(); el = frame(); draw() }
          const rect = el.getBoundingClientRect()
          const overflow = [...el.querySelectorAll<HTMLElement>('td,th,svg')].some(e => { const r = e.getBoundingClientRect(); return r.right > rect.right + 1 || r.bottom > rect.bottom + 1 || e.scrollWidth > e.clientWidth + 1 })
          if (page.y + rect.height <= BOTTOM && !overflow) { record({ item: item.id, start: 0, end: item.text.length, render: 'native' }, el); continue }
        } catch { /* Exact literal data below remains available if native layout fails. */ }
        el.remove()
      }
      let start = 0
      while (start < item.text.length) {
        signal?.throwIfAborted()
        let el = frame(), field = textField(el, item); field.textContent = item.text.slice(start)
        let height = el.getBoundingClientRect().height
        if (height > BOTTOM - page.y && height <= BOTTOM - TOP && page.pieces.length) { el.remove(); page = newPage(); el = frame(); field = textField(el, item); field.textContent = item.text.slice(start); height = el.getBoundingClientRect().height }
        let end = item.text.length
        if (height > BOTTOM - page.y) {
          let low = start, high = item.text.length
          while (low < high) { const mid = Math.ceil((low + high) / 2); field.textContent = item.text.slice(start, mid); if (el.getBoundingClientRect().height <= BOTTOM - page.y) low = mid; else high = mid - 1 }
          end = low
          if (end <= start) { el.remove(); page = newPage(); continue }
          const boundary = item.text.slice(start, end).search(/\s+\S*$/u)
          if (boundary > (end - start) * .7) end = start + boundary + 1
          if (/[\uD800-\uDBFF]/.test(item.text[end - 1])) end--
          field.textContent = item.text.slice(start, end)
        }
        record({ item: item.id, start, end, render: 'text' }, el); start = end
        if (start < item.text.length) page = newPage()
      }
    }
    const filled = pages.filter(p => p.pieces.length); validateFallbackCoverage(items, filled)
    const output: { pieces: FallbackPiece[]; receipt: RenderReceipt }[] = []
    for (const [i, p] of filled.entries()) {
      signal?.throwIfAborted()
      const content = fallbackPage(source, items, p.pieces, i), rootBox = p.root.getBoundingClientRect(), text: RenderReceipt['text'] = [], layout: NonNullable<RenderReceipt['layout']> = {}
      p.root.dataset.studioSlide = content.id
      for (const block of content.blocks) {
        const el = p.root.querySelector<HTMLElement>(`[data-block="${block.id}"]`)!, r = el.getBoundingClientRect()
        layout[block.id] = { x: r.x - rootBox.x, y: r.y - rootBox.y, w: r.width, h: r.height }
        for (const field of block.data ? [] : el.querySelectorAll<HTMLElement>('[data-field]')) {
          const s = getComputedStyle(field), b = field.getBoundingClientRect()
          text.push({ blockId: block.id, field: field.dataset.field!, value: field.textContent!, size: parseFloat(s.fontSize), font: family, weight: Number(s.fontWeight), color: s.color, x: b.x - rootBox.x, y: b.y - rootBox.y, width: b.width, height: b.height })
        }
      }
      output.push({ pieces: p.pieces, receipt: { slideId: content.id, candidateId: 'fallback/readable', optionId: `fallback-${i + 1}`, passed: true, preview: await toPng(p.root, { pixelRatio: 2 / 3, fontEmbedCSS: fontCSS }), html: p.root.outerHTML, blockIds: content.blocks.map(b => b.id), issues: [], warnings: ['Использована простая вёрстка с сохранением содержания.'], components: [], layout, text, dataValues: content.blocks.flatMap(b => b.data ? [{ blockId: b.id, templateId: b.data.template.id, values: b.data.values }] : []), elapsedMs: Math.round(performance.now() - started) } })
    }
    return { basis, fontCSS, pages: output }
  } finally { host.remove() }
}
