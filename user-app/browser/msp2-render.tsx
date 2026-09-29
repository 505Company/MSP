import { Children } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Renderer, JSONUIProvider, defineRegistry, GridLayout, noCompactor, absoluteStrategy, fitty } from '@msp2/runtime'
import { slideCatalog } from '@msp2/runtime/catalog'
import 'react-grid-layout/css/styles.css'
import { toPng } from 'html-to-image'
import { prepareLayoutFonts } from './layout-fonts'
import { measurePreparedBox, renderPreparedBox } from './prepared-components'
import { drawData } from './msp2-data'
import { assembleBackground } from '../lib/design-system/backgrounds'
import { graphicHtml } from '../lib/design-system/diagram-graph'
import { contentHash } from '../lib/design-system/catalog'
import { designTokens } from '../lib/msp2/theme'
import { slideSpec } from '../lib/msp2/spec'
import { GRID, gridRect, layoutCandidates, layoutScore, type WidthMeasurements } from '../lib/msp2/grid'
import { MSP2_VERSION, type ContentSlide, type DesignLibrary, type SlidePlan, type SlideResult } from '../lib/msp2/types'

type Block = ContentSlide['blocks'][number]
const px = (n: number) => `${n}px`
const minimum = (block: Block, field: string) => block.role === 'title' ? 40 : block.role === 'footer' && block.source.length < 160 ? 20 : field === 'value' ? 56 : 24
const fontSize = (b: Block, f: string) => b.role === 'title' ? 72 : b.role === 'footer' ? 24 : f === 'value' ? 140 : f === 'marker' ? 52 : f === 'heading' || f === 'quote' ? 44 : 36

function primitive(box: HTMLElement, block: Block, library: DesignLibrary, scale: number, fitHeight = false, plan?: SlidePlan) {
  const theme = designTokens(library, plan), widths = new Map<string, number>()
  Object.assign(box.style, { display: 'flex', flexDirection: 'column', gap: '20px', padding: block.role === 'footer' ? '0' : '12px 0', justifyContent: block.kind === 'metric' && fitHeight ? 'center' : 'flex-start' })
  for (const [field, value] of Object.entries(block.fields)) {
    const el = document.createElement('div'); el.dataset.mspField = field; el.textContent = value
    const size = Math.max(minimum(block, field), Math.floor(fontSize(block, field) * (fitHeight ? 1 : scale)))
    Object.assign(el.style, { fontFamily: JSON.stringify(theme.font), fontSize: px(size), lineHeight: block.role === 'title' || field === 'value' ? '1.1' : '1.28', fontWeight: block.role === 'title' || ['value', 'heading', 'marker'].includes(field) ? '700' : '400', color: block.role === 'title' || ['value', 'marker'].includes(field) ? theme.accent : theme.ink, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flexShrink: '0', minWidth: '0' })
    box.appendChild(el)
    if (['value', 'marker'].includes(field) && !value.includes('\n')) {
      const fit = fitty(el, { minSize: minimum(block, field), maxSize: size, multiLine: false })
      fit.fit({ sync: true }); const fitted = parseFloat(getComputedStyle(el).fontSize); fit.unsubscribe()
      el.style.fontSize = px(fitted); widths.set(field, fitted)
    }
  }
  if (fitHeight && overflows(box)) {
    const fields = [...box.querySelectorAll<HTMLElement>('[data-msp-field]')]
    const apply = (factor: number) => fields.forEach(el => {
      const key = el.dataset.mspField!
      el.style.fontSize = px(Math.max(minimum(block, key), Math.floor(Math.min(widths.get(key) ?? Infinity, fontSize(block, key) * factor))))
    })
    let low = 0, high = 1
    for (let i = 0; i < 8; i++) { const factor = (low + high) / 2; apply(factor); if (overflows(box)) high = factor; else low = factor }
    apply(low)
  }
}

function overflows(box: HTMLElement) {
  const area = box.getBoundingClientRect()
  if (box.scrollHeight > area.height + 2 || box.scrollWidth > area.width + 2) return true
  return [...box.querySelectorAll<HTMLElement>('[data-msp-field],td,th,[data-component-field],[data-source-text],svg text')].some(el => {
    const range = document.createRange(); range.selectNodeContents(el); const rect = range.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && (rect.left < area.left - 2 || rect.top < area.top - 2 || rect.right > area.right + 2 || rect.bottom > area.bottom + 2)
  })
}

function componentValues(block: Block, plan: SlidePlan) {
  return Object.fromEntries(Object.entries(plan.components[block.id].fields).map(([field, source]) => [field, block.fields[source]]))
}
async function measureComponent(block: Block, plan: SlidePlan, library: DesignLibrary, width: number, height: number, reduce: boolean) {
  const pin = library.prepared[plan.components[block.id].id]
  if (!pin) throw Error(`${block.id}: исходный компонент недоступен.`)
  const result = await measurePreparedBox(library.uploadId, pin, componentValues(block, plan), { width: Math.min(width, pin.profile.maxWidth, 1600), maxHeight: Math.min(Math.max(60, height), pin.profile.maxHeight, 1200), widthMode: 'fill', heightMode: 'hug', background: designTokens(library).background }, undefined, false, { maxTypeStep: reduce ? 4 : 0 })
  if (result.measurement.status !== 'fits' || !result.measurement.chosen || result.measurement.chosen.fields.some(f => f.fontSize < minimum(block, plan.components[block.id].fields[f.id]))) throw Error(`${block.id}: компонент «${pin.profile.name}» требует больше места.`)
  return result
}

async function measureWidths(host: HTMLElement, library: DesignLibrary, plan: SlidePlan, scale: number, signal?: AbortSignal) {
  const measurements: WidthMeasurements = {}, errors: string[] = []
  let measured = 0
  for (const block of plan.content.blocks) {
    measurements[block.id] = {}
    for (const columns of block.role === 'body' ? [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [plan.background?.area.w ?? 12]) {
      signal?.throwIfAborted(); measured++
      const width = gridRect({ i: '', x: 0, y: 0, w: columns, h: 48 }).width
      const box = document.createElement('div'); Object.assign(box.style, { width: px(width), height: 'auto', boxSizing: 'border-box' }); host.appendChild(box)
      try {
        let height: number
        if (plan.components[block.id]) {
          const heights = scale === 1 ? [984] : [180, 280, 420, 600, 984]
          let required = Infinity
          for (const maxHeight of heights) try { const r = await measureComponent(block, plan, library, width, maxHeight, scale < 1); required = r.measurement.chosen!.height; break } catch { /* Try the next measured height. */ }
          height = required
        } else if (block.data?.template.kind === 'chart') {
          let required = Infinity
          for (const h of [360, 440, 560, 720, 900]) {
            box.style.height = px(h)
            try { drawData(box, block.data.template, block.data.values, width, h, scale); if (!overflows(box)) { required = h; break } } catch (e) { errors.push(e instanceof Error ? e.message : 'Ошибка данных') }
          }
          height = required
        } else {
          if (block.data) drawData(box, block.data.template, block.data.values, width, 984, scale)
          else primitive(box, block, library, scale, false, plan)
          height = box.getBoundingClientRect().height
          if (overflows(box)) height = Infinity
        }
        measurements[block.id][columns] = height
      } catch (e) { measurements[block.id][columns] = Infinity; errors.push(e instanceof Error ? e.message : 'Ошибка измерения') }
      finally { box.remove() }
    }
    if (!Object.values(measurements[block.id]).some(Number.isFinite)) errors.push(`${block.id}: содержание не помещается ни при одной допустимой ширине.`)
  }
  return { measurements, measured, errors }
}

async function populate(box: HTMLElement, block: Block, plan: SlidePlan, library: DesignLibrary, scale: number) {
  const binding = plan.components[block.id], area = box.getBoundingClientRect()
  const text: SlideResult['text'] = [], components: SlideResult['components'] = [], css: string[] = []
  if (binding) {
    const { measurement, resources } = await measureComponent(block, plan, library, area.width, area.height, scale < 1)
    await renderPreparedBox(box, library.uploadId, library.prepared[binding.id], componentValues(block, plan), measurement); css.push(resources.css)
    const chosen = measurement.chosen!
    for (const f of chosen.fields) {
      const key = binding.fields[f.id]; if (!key) continue
      const source = library.prepared[binding.id].profile.fields.find(v => v.id === f.id)!
      text.push({ blockId: block.id, field: key, value: block.fields[key], size: f.fontSize, x: f.box.x, y: f.box.y, width: f.box.width, height: f.box.height, font: f.font, color: source.color, weight: source.weight })
    }
    components.push({ blockId: block.id, componentId: binding.id, kind: 'prepared', width: chosen.width, height: chosen.height, state: chosen.state })
  } else if (block.data) {
    drawData(box, block.data.template, block.data.values, area.width, area.height, scale)
    components.push({ blockId: block.id, componentId: block.data.template.id, kind: 'editable', width: area.width, height: area.height })
  } else primitive(box, block, library, scale, true, plan)
  for (const el of box.querySelectorAll<HTMLElement>('[data-msp-field]')) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect()
    text.push({ blockId: block.id, field: el.dataset.mspField!, value: el.textContent ?? '', size: parseFloat(s.fontSize), x: r.x - area.x, y: r.y - area.y, width: r.width, height: r.height, font: s.fontFamily, color: s.color, weight: parseInt(s.fontWeight) || 400 })
  }
  if (overflows(box)) throw Error(`${block.id}: текст или данные выходят за границы блока.`)
  for (const [key, value] of Object.entries(block.fields)) if (!text.some(t => t.field === key && t.value === value)) throw Error(`${block.id}: поле ${key} потеряно или изменено.`)
  return { text, components, css }
}

async function embedAssets(slide: HTMLElement, uploadId: string, signal?: AbortSignal) {
  for (const node of slide.querySelectorAll('img, image')) {
    const key = node.tagName.toLowerCase() === 'img' ? 'src' : 'href', href = node.getAttribute(key) ?? ''
    if (!href.startsWith(`/api/uploads/${encodeURIComponent(uploadId)}/assets/`)) continue
    const response = await fetch(href, { signal }); if (!response.ok) throw Error('Исходная графика недоступна.')
    const blob = await response.blob(), data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
    node.setAttribute(key, data)
  }
}

export async function renderMsp2Slide(library: DesignLibrary, plan: SlidePlan, signal?: AbortSignal): Promise<SlideResult> {
  const start = performance.now(), theme = designTokens(library, plan), spec = slideSpec(plan), planHash = await contentHash(plan)
  const families = [...new Set([theme.font, ...plan.content.blocks.flatMap(b => b.data?.template.style.font ? [b.data.template.style.font] : [])])]
  const fonts = await prepareLayoutFonts({ uploadId: library.uploadId, fonts: families.map((family, i) => ({ id: `msp2-${i}`, family })) })
  if (fonts.fontTokens.length !== families.length) throw Error('Не все исходные шрифты доступны для измерения.')
  await document.fonts.ready
  const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true'); Object.assign(host.style, { position: 'fixed', left: '-22000px', top: '0', width: '1920px', height: '1080px' }); document.body.appendChild(host)
  const probes = document.createElement('div'); Object.assign(probes.style, { position: 'fixed', left: '-24000px', top: '0' }); document.body.appendChild(probes)
  const root = createRoot(host), errors: string[] = []
  let measuredWidths = 0, candidateCount = 0, checked = 0
  try {
    for (const scale of [1, .85, .7, 0]) {
      const measured = await measureWidths(probes, library, plan, scale, signal)
      measuredWidths += measured.measured; errors.push(...measured.errors)
      const candidates = layoutCandidates(plan, measured.measurements); candidateCount += candidates.length
      let best: { node: HTMLElement; text: SlideResult['text']; components: SlideResult['components']; css: string[]; grid: SlideResult['grid']; score: number } | undefined
      for (const grid of candidates.slice(0, 8)) {
        signal?.throwIfAborted(); checked++
        const blockComponent = ({ props }: { props: { id: string } }) => <div data-msp-block={props.id} style={{ width: '100%', height: '100%', boxSizing: 'border-box' }} />
        const { registry } = defineRegistry(slideCatalog, { components: {
          Slide: ({ children }) => <GridLayout width={GRID.width} layout={grid} gridConfig={{ cols: GRID.columns, rowHeight: GRID.rowHeight, maxRows: GRID.rows, margin: [GRID.gap, GRID.verticalGap], containerPadding: [GRID.padding, GRID.padding] }} dragConfig={{ enabled: false }} resizeConfig={{ enabled: false }} compactor={noCompactor} positionStrategy={absoluteStrategy} autoSize={false} style={{ width: 1920, height: 1080, background: theme.background, color: theme.ink, overflow: 'hidden' }}>{Children.toArray(children).map((child, i) => <div key={plan.content.blocks[i].id}>{child}</div>)}</GridLayout>,
          Text: blockComponent, Metric: blockComponent, Group: blockComponent, Component: blockComponent, Table: blockComponent, Chart: blockComponent,
        } })
        flushSync(() => root.render(<JSONUIProvider registry={registry}><Renderer key={JSON.stringify(grid) + scale} spec={spec} registry={registry} /></JSONUIProvider>))
        const text: SlideResult['text'] = [], components: SlideResult['components'] = [], css = [...Object.values(fonts.css)]
        try {
          for (const block of plan.content.blocks) {
            signal?.throwIfAborted()
            const box = host.querySelector<HTMLElement>(`[data-msp-block="${block.id}"]`)
            if (!box) throw Error('Каталог не создал блок ' + block.id)
            const result = await populate(box, block, plan, library, scale), rect = gridRect(grid.find(c => c.i === block.id)!)
            text.push(...result.text.map(t => ({ ...t, x: t.x + rect.x, y: t.y + rect.y }))); components.push(...result.components); css.push(...result.css)
          }
          const shrink = text.reduce((sum, t) => sum + Math.max(0, 1 - t.size / fontSize(plan.content.blocks.find(b => b.id === t.blockId)!, t.field)), 0)
          const score = layoutScore(grid, plan, measured.measurements) - shrink * 12
          if (!best || score > best.score) best = { node: host.firstElementChild!.cloneNode(true) as HTMLElement, text, components, css, grid, score }
        } catch (e) { if (signal?.aborted) throw e; errors.push(e instanceof Error ? e.message : 'Ошибка измерения') }
      }
      if (!best) continue
      flushSync(() => root.render(null)); host.appendChild(best.node)
      if (plan.background && library.backgrounds) {
        const preset = library.backgrounds.presets.find(p => p.id === plan.background!.id)
        if (!preset) throw Error('Исходный фон недоступен.')
        const layer = document.createElement('div'); layer.dataset.mspBackground = preset.id
        Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
        layer.innerHTML = graphicHtml(assembleBackground(library.backgrounds, preset.selection, { width: 1920, height: 1080 }).elements, 1920, 1080, library.uploadId)
        best.node.insertBefore(layer, best.node.firstChild)
      }
      await embedAssets(best.node, library.uploadId, signal)
      for (const img of best.node.querySelectorAll('img')) await img.decode()
      const fontEmbedCSS = [...new Set(best.css)].join('\n'), preview = await toPng(best.node, { pixelRatio: 2 / 3, fontEmbedCSS })
      const style = '.react-grid-layout{position:relative}.react-grid-item{position:absolute;box-sizing:border-box}.react-grid-item>.react-resizable-handle{display:none}'
      return { version: MSP2_VERSION, slideId: plan.content.id, planHash, grid: best.grid, spec, passed: true, preview, html: `<style>${style}${fontEmbedCSS.replaceAll('</style', '<\\/style')}</style>${best.node.outerHTML}`, blockIds: plan.content.blocks.map(b => b.id), issues: [], warnings: scale < 1 ? ['Кегль подогнан после измерения вариантов; читаемые минимумы сохранены.'] : [], text: best.text, components: best.components, dataValues: plan.content.blocks.filter(b => b.data).map(b => ({ blockId: b.id, templateId: b.data!.template.id, values: b.data!.values })), search: { measuredWidths, candidates: candidateCount, checked, score: best.score, typographyScale: scale }, elapsedMs: Math.round(performance.now() - start) }
    }
    throw Error(['Содержание не помещается на слайд при читаемом кегле. Разделите материал явно.', ...[...new Set(errors)].slice(-4)].join('\n'))
  } finally { root.unmount(); host.remove(); probes.remove() }
}
