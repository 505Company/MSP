import { getFontEmbedCSS, toPng } from 'html-to-image'
import { contrast, slideNumber, overlap } from '../lib/presentations/studio/color-zones'
import { accentPalette, BRAND_ACCENTS_VERSION, canApplyBrandAccents, sparsePanelRect, textContrastMinimum, type BrandAccents } from '../lib/presentations/studio/brand-accents'
import type { Box, Candidate, RenderReceipt, SlideWork, StudioLibrary } from '../lib/presentations/studio/contract'

const hex = (color: string) => {
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase()
  const values = color.match(/[\d.]+/g)?.map(Number)
  return values && values.length >= 3 ? '#' + values.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined
}
const bounds = (el: Element, root: HTMLElement, glyphs = false): Box => {
  const range = document.createRange(); range.selectNodeContents(el)
  const r = glyphs && el.namespaceURI !== 'http://www.w3.org/2000/svg' ? range.getBoundingClientRect() : el.getBoundingClientRect(), base = root.getBoundingClientRect()
  return { x: r.x - base.x, y: r.y - base.y, w: r.width, h: r.height }
}
const textElements = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement | SVGElement>('[data-field], [data-component-field], [data-source-text], svg text')].filter(el => !el.querySelector('[data-field], [data-component-field], [data-source-text], svg text'))
const remember = (el: HTMLElement | SVGElement) => { if (!el.hasAttribute('data-before-brand-style')) el.setAttribute('data-before-brand-style', el.getAttribute('style') ?? '') }

function surfaceBehind(el: Element, root: HTMLElement): string | undefined {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node), color = style.backgroundColor, alpha = color.match(/[\d.]+/g)?.map(Number)[3] ?? 1
    if (style.backgroundImage !== 'none' || alpha > 0 && alpha < 1) return
    if (alpha === 1 && hex(color)) return hex(color)
    if (node === root) break
  }
}

function transparentToRoot(el: Element, root: HTMLElement) {
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    const css = getComputedStyle(node), alpha = css.backgroundColor.match(/[\d.]+/g)?.map(Number)[3] ?? 1
    if (alpha > 0 || css.backgroundImage !== 'none') return false
  }
  return true
}

/** Paint after fitting. Geometry, field values, native data and source graphics
 * stay intact. Only measured text accents and one spacious block may change. */
export function applyStudioBrandAccents(root: HTMLElement, library: StudioLibrary, work: SlideWork, candidate: Candidate, text: RenderReceipt['text']): BrandAccents | undefined {
  if (!canApplyBrandAccents(work.content, candidate)) return
  if (root.querySelector('[data-studio-color-zone]')) throw Error('Для обновления нужен сохранённый слайд до цветовых заливок.')
  const result: BrandAccents = { version: BRAND_ACCENTS_VERSION, colors: [] }
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-block]')]
  const elements = textElements(root).map(el => {
    const id = el.closest<HTMLElement>('[data-block]')?.dataset.block, block = work.content.blocks.find(b => b.id === id)
    const component = el.closest<HTMLElement>('[data-component-box]')?.dataset.componentBox
    const field = el.dataset.field ?? work.bindings[id ?? '']?.find(b => b.id === component)?.fields[el.dataset.componentField ?? '']
    const style = getComputedStyle(el)
    return { el, block, field, box: bounds(el, root, true), minimum: textContrastMinimum(parseFloat(style.fontSize), Number(style.fontWeight) || 400) }
  })
  const setColor = (entry: typeof elements[number], color: string) => {
    const { el, block, field } = entry
    remember(el); el.style.setProperty(el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'fill' : 'color', color)
    for (const child of el.querySelectorAll<HTMLElement>('span')) if (child.style.color) { remember(child); child.style.color = color }
    for (const t of text) if (t.blockId === block?.id && (t.field === field || !field && el.textContent?.includes(t.value))) t.color = color
    if (!result.colors.includes(color)) result.colors.push(color)
  }
  // Source images, graphs, coloured cards and decorations retain their own art.
  const decorations = [...root.querySelectorAll<HTMLElement>('[data-recipe-decoration], [data-background], svg, img')].map(el => bounds(el, root))
  const panelColors = accentPalette(library)
  for (const blockEl of blocks) {
    const block = work.content.blocks.find(b => b.id === blockEl.dataset.block)
    if (!block || block.data || !['text', 'quote'].includes(block.kind) || block.role === 'footer') continue
    // A fact grid already owns its values, rules and contrasting labels.
    // Its spacing is structural, not a vacant area for a second accent panel.
    if(candidate.slots.some(s=>s.blocks.includes(block.id)&&(s.presentation?.factLayout||s.presentation?.contentTreatment)))continue
    const entries = elements.filter(e => e.block?.id === block.id && e.box.w && e.box.h)
    if (!entries.length || entries.some(e => !e.el.dataset.field || !transparentToRoot(e.el, root) || surfaceBehind(e.el, root) !== '#FFFFFF')) continue
    const region = bounds(blockEl, root)
    const panel = sparsePanelRect(region, entries.map(e => e.box), [...blocks.filter(b => b !== blockEl).map(b => bounds(b, root)), ...decorations])
    const colors = panelColors.filter(c => entries.every(e => contrast('#FFFFFF', c) >= e.minimum))
    if (!panel || !colors.length) continue
    const color = colors[Math.max(0, slideNumber(work.content) - 2) % colors.length]
    result.panel = { blockId: block.id, color, ...panel, minContrast: contrast('#FFFFFF', color) }
    const layer = document.createElement('div'); layer.dataset.studioAccentPanel = BRAND_ACCENTS_VERSION; layer.setAttribute('aria-hidden', 'true')
    Object.assign(layer.style, { position: 'absolute', pointerEvents: 'none', left: panel.rect.x + 'px', top: panel.rect.y + 'px', width: panel.rect.w + 'px', height: panel.rect.h + 'px', background: color })
    root.insertBefore(layer, root.firstChild)
    entries.forEach(e => setColor(e, '#FFFFFF'))
    break
  }
  let index = Math.max(0, slideNumber(work.content) - 2)
  for (const entry of elements) {
    const { block, field, el } = entry
    if (!block || block.data || block.id === result.panel?.blockId || block.role === 'footer') continue
    // When we have the original canvas, retain its title treatment and the
    // actual component inks. A chart's rare red series isn't a heading theme.
    if (library.backgrounds) continue
    if (!(block.role === 'title' || block.kind === 'metric' && field === 'value' || block.kind === 'step' && field === 'marker')) continue
    const surface = surfaceBehind(el, root)
    if (!surface || decorations.some(box => overlap(box, entry.box) > 1)) continue
    const colors = accentPalette(library, surface, entry.minimum)
    if (colors.length) setColor(entry, colors[index++ % colors.length])
  }
  root.dataset.studioBrandAccents = BRAND_ACCENTS_VERSION
  return result
}

/** The caller supplies the pristine saved receipt for legacy band migrations.
 * Never rerun fitting or the model when changing an existing appearance. */
export async function restyleStudioReceipt(library: StudioLibrary, work: SlideWork, source: RenderReceipt, signal?: AbortSignal): Promise<RenderReceipt> {
  if (source.brandAccents?.version === BRAND_ACCENTS_VERSION) return source
  const candidate = work.candidates.find(c => c.id === source.candidateId)
  if (!candidate) throw Error('Не найден сохранённый макет слайда.')
  if (!canApplyBrandAccents(work.content, candidate)) return source
  if (source.colorZone) throw Error('Не найден исходный слайд до цветовых заливок.')
  const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true'); Object.assign(host.style, { position: 'fixed', left: '-22000px', top: '0', width: '1920px' }); host.innerHTML = source.html; document.body.appendChild(host)
  try {
    const root = host.querySelector<HTMLElement>('[data-studio-slide]'); if (!root) throw Error('Не найден сохранённый слайд.')
    await document.fonts.ready; signal?.throwIfAborted()
    const text = structuredClone(source.text), brandAccents = applyStudioBrandAccents(root, library, work, candidate, text)
    if (!brandAccents) return source
    const fontEmbedCSS = await getFontEmbedCSS(root).catch(() => '')
    const preview = await toPng(root, { pixelRatio: 2 / 3, fontEmbedCSS, cacheBust: false }); signal?.throwIfAborted()
    return { ...source, text, brandAccents, preview, html: host.innerHTML }
  } finally { host.remove() }
}
