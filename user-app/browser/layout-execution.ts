import { toPng } from 'html-to-image'
import { hydrateEditableHtml } from '../lib/design-system/editable-hydrate'
import { loadPresentationReader } from '../lib/digital-designer/browser-loader'
import { LAYOUT_RENDER_VERSION, layoutCandidates, type LayoutFit, type LayoutInput, type LayoutPlan, type LayoutTrial, type LayoutPreviewCheck } from '../lib/presentations/layout-contract'
import { renderLayoutHtml, contrastRatio } from '../lib/presentations/layout-html'
import { adaptationLevel, stateById } from '../lib/presentations/recipes/layout-engine-v1/states'

declare global { interface Window { __mspCaptureLayout?: (id: string) => Promise<string> } }

/** DOM fit is not evidence that a foreignObject export painted its text. */
export async function verifyLayoutPreview(root: HTMLElement, preview: string): Promise<LayoutPreviewCheck> {
  const image = new Image(); image.src = preview; await image.decode()
  const width = image.naturalWidth, height = image.naturalHeight
  if (![1280, 1920].includes(width) || width / height !== 16 / 9) throw Error('PREVIEW_DIMENSIONS: неверный размер снимка слайда.')
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height).data, bounds = root.getBoundingClientRect(), scale = width / bounds.width
  const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1
  const color = swatch.getContext('2d', { willReadFrequently: true })!, textBlocks = []
  for (const node of root.querySelectorAll<HTMLElement>('[data-layout-text]')) {
    color.clearRect(0, 0, 1, 1); color.fillStyle = getComputedStyle(node).color; color.fillRect(0, 0, 1, 1)
    const rgb = color.getImageData(0, 0, 1, 1).data, rect = node.getBoundingClientRect()
    const left = Math.max(0, Math.floor((rect.left - bounds.left) * scale)), right = Math.min(width, Math.ceil((rect.right - bounds.left) * scale))
    const top = Math.max(0, Math.floor((rect.top - bounds.top) * scale)), bottom = Math.min(height, Math.ceil((rect.bottom - bounds.top) * scale))
    let count = 0
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const n = (y * width + x) * 4
      if (pixels[n + 3] > 240 && Math.abs(pixels[n] - rgb[0]) < 45 && Math.abs(pixels[n + 1] - rgb[1]) < 45 && Math.abs(pixels[n + 2] - rgb[2]) < 45) count++
    }
    if (node.textContent?.trim() && count < 3) throw Error(`PREVIEW_TEXT_MISSING: снимок не сохранил текстовый блок ${node.dataset.layoutBlock}.`)
    textBlocks.push({ block: node.dataset.layoutBlock!, pixels: count })
  }
  return { width, height, textBlocks }
}

export function textGeometry(node: Element) {
  const canvas = document.createElement('canvas').getContext('2d')!, style = getComputedStyle(node)
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const range = document.createRange(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const lines = new Map<number, { text: string; left: number; top: number; height: number }>()
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    let offset = 0
    for (const glyph of text.textContent ?? '') {
      range.setStart(text, offset); offset += glyph.length; range.setEnd(text, offset)
      const rect = range.getBoundingClientRect()
      if (rect.width < .1 || rect.height < .1) continue
      const key = Math.round(rect.top * 2), line = lines.get(key)
      if (line) { line.text += glyph; line.left = Math.min(line.left, rect.left) }
      else lines.set(key, { text: glyph, left: rect.left, top: rect.top, height: rect.height })
    }
  }
  // Range rectangles include font ascent/descent, not visible ink. With cap-edge
  // trimming those invisible margins extend above the authored text box.
  const ink = [...lines.values()].flatMap(line => {
    const metrics = canvas.measureText(line.text)
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    if (width <= 0 || height <= 0) return []
    const baseline = line.top + (line.height + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
    return [new DOMRect(line.left - metrics.actualBoundingBoxLeft, baseline - metrics.actualBoundingBoxAscent, width, height)]
  })
  return { lines: lines.size, ink }
}
export async function measureLayout(root: HTMLElement, input: LayoutInput, plan: LayoutPlan, stateId: string, plainComponents = false, wideContext = false): Promise<LayoutTrial> {
  const state = stateById(stateId)!, trial: LayoutTrial = { stateId, plainComponents, ...(wideContext ? { wideContext } : {}), level: Math.max(adaptationLevel(stateById(plan.preferredState)!, state), wideContext ? 2 : 0) as 0 | 1 | 2 | 3, issues: [], measurements: [] }
  if (!CSS.supports('text-box-trim', 'trim-both')) trial.issues.push({ code: 'RENDERER_UNSUPPORTED', message: 'Браузер не поддерживает точные метрики текста этого рецепта.' })
  // This recipe prohibits the source-component renderer's shrink-to-fit path.
  for (const node of root.querySelectorAll<SVGSVGElement>('[data-native-text]')) {
    const source = JSON.parse(node.dataset.nativeText!)
    source.flow = { ...source.flow, autoFit: 'NONE' }; node.dataset.nativeText = JSON.stringify(source)
    for (const run of [source, ...(source.styleRuns ?? [])]) if (![...document.fonts].some(f => f.status === 'loaded' && f.family.replace(/^["']|["']$/g, '') === run.fontFamily)) trial.issues.push({ code: 'FONT_TOKEN_UNAVAILABLE', message: `Недоступен исходный шрифт компонента: ${run.fontFamily}.` })
  }
  const issues = await hydrateEditableHtml(root, { loadFonts: false })
  for (const message of issues) trial.issues.push({ code: 'component-font', message })
  await document.fonts.ready
  const origin = root.getBoundingClientRect(), blocks = [...root.querySelectorAll<HTMLElement>('[data-layout-block]')]
  const occupied: { id: string; rect: DOMRect }[] = []
  for (const node of blocks) {
    const id = node.dataset.layoutBlock!, b = node.getBoundingClientRect(), text = node.hasAttribute('data-layout-text')
    const geometry = text ? textGeometry(node.firstElementChild!) : { ink: [b], lines: 0 }
    const rects = geometry.ink, lines = geometry.lines
    const style = getComputedStyle(node), fontSize = parseFloat(style.fontSize)
    trial.measurements.push({ block: id, width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, lines: text ? lines : 0, fontSize })
    if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1 || text && lines > Number(node.dataset.maxLines)) trial.issues.push({ code: 'overflow', block: id, message: `${id}: ${lines} строк, ${node.scrollWidth}×${node.scrollHeight} в области ${node.clientWidth}×${node.clientHeight}.` })
    for (const rect of rects) {
      if (rect.left < origin.left - 1 || rect.top < origin.top - 1 || rect.right > origin.right + 1 || rect.bottom > origin.bottom + 1) trial.issues.push({ code: 'canvas-overflow', block: id, message: `${id}: содержимое выходит за холст.` })
      occupied.push({ id, rect })
    }
    if (node.hasAttribute('data-layout-component')) {
      if (node.querySelector('[data-native-overflow="true"]')) trial.issues.push({ code: 'component-overflow', block: id, message: `${id}: данные не помещаются в исходные поля компонента.` })
      for (const child of node.children) { const r = child.getBoundingClientRect(); if (r.width > b.width + 1 || r.height > b.height + 1) trial.issues.push({ code: 'component-fit', block: id, message: `${id}: компонент больше проверенной области.` }) }
      // Every component field must still be visible after native text hydration.
      const binding = plan.support[Number(id.split('-')[1])]
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
      const content = normalize(node.textContent ?? '')
      for (const part of binding.parts) { const source = input.content.find(f => f.id === part.fragmentId)!.text.slice(part.start, part.end); if (!content.includes(normalize(source))) trial.issues.push({ code: 'component-content', block: id, message: `${id}: компонент не вывел исходный фрагмент.` }) }
    }
    if (node.hasAttribute('data-layout-visual')) {
      const image = node.querySelector('img')!
      try { if (!image.getAttribute('src')) throw Error(); await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw Error() }
      catch { trial.issues.push({ code: 'graphic-unavailable', block: id, message: `${id}: исходная графика не загрузилась.` }) }
    }
  }
  for (let i = 0; i < occupied.length; i++) for (let j = i + 1; j < occupied.length; j++) {
    const a = occupied[i], b = occupied[j]
    if (a.id === b.id) continue
    if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1) trial.issues.push({ code: 'collision', block: a.id, message: `${a.id} пересекается с ${b.id}.` })
  }
  const color = (role: keyof LayoutPlan['colors']) => input.colors.find(c => c.id === plan.colors[role])!.hex
  const background = state.innerSurface ? color('surface') : color('background')
  for (const role of ['primary', 'secondary'] as const) if (contrastRatio(color(role), background) < 3) trial.issues.push({ code: 'INVALID_COLOR_COMBINATION', message: `Недостаточный контраст ${role} на фоне.` })
  if (plan.facts.length && contrastRatio(color('onSurface'), color('surface')) < 3) trial.issues.push({ code: 'INVALID_COLOR_COMBINATION', message: 'Факты не читаются на выбранной поверхности.' })
  return { ...trial, issues: [...new Map(trial.issues.map(i => [`${i.code}:${i.block}:${i.message}`, i])).values()].slice(0, 100) }
}
export async function layoutGraphics(input: LayoutInput, plan: LayoutPlan, signal?: AbortSignal) {
  const result: Record<string, string> = {}, ids = [...new Set([...plan.visuals.map(v => v.id), ...(plan.connectorId ? [plan.connectorId] : [])])]
  if (!ids.length) return result
  const reader = await loadPresentationReader(), cache = new Map<string, Uint8Array>()
  for (const id of ids) {
    signal?.throwIfAborted()
    const component = input.graphics.find(g => g.id === id)!
    for (const assetId of component.source.assetIds) if (!cache.has(assetId)) {
      const r = await fetch(`/api/uploads/${input.uploadId}/assets/${assetId}`, { signal })
      if (r.ok) cache.set(assetId, new Uint8Array(await r.arrayBuffer()))
    }
    const rendered = await reader.renderComponent(component, {}, [...cache].map(([id, bytes]) => ({ id, bytes })))
    if (rendered.fits) result[id] = rendered.dataUrl
  }
  return result
}
export async function fitLayout(input: LayoutInput, plan: LayoutPlan, planHash: string, options: { fontCss?: string; graphics?: Record<string, string>; signal?: AbortSignal } = {}) {
  const graphics = options.graphics ?? await layoutGraphics(input, plan, options.signal)
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-22000px;top:0;width:1920px;opacity:0;pointer-events:none;'; host.setAttribute('aria-hidden', 'true'); document.body.appendChild(host)
  const trials: LayoutTrial[] = []
  try {
    for (const { state, plainComponents: plain, wideContext } of layoutCandidates(plan)) {
      options.signal?.throwIfAborted()
      host.innerHTML = renderLayoutHtml(plan, input, state.id, graphics, plain, wideContext)
      const root = host.firstElementChild as HTMLElement, trial = await measureLayout(root, input, plan, state.id, plain, wideContext)
      trials.push(trial)
      if (trial.issues.length) continue
      options.signal?.throwIfAborted()
      let preview: string
      if (window.__mspCaptureLayout) {
        const id = crypto.randomUUID(); root.dataset.layoutCapture = id
        host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;z-index:2147483647;pointer-events:none;'
        preview = await window.__mspCaptureLayout(id)
        delete root.dataset.layoutCapture
      } else preview = await toPng(root, { canvasWidth: 1280, canvasHeight: 720, pixelRatio: 1, fontEmbedCSS: options.fontCss ?? '', skipAutoScale: true })
      const previewCheck = await verifyLayoutPreview(root, preview)
      const fit: LayoutFit = { version: LAYOUT_RENDER_VERSION, planHash, passed: true, stateId: state.id, plainComponents: plain, trials, previewCheck }
      return { fit, preview, html: root.outerHTML }
    }
    const fit: LayoutFit = { version: LAYOUT_RENDER_VERSION, planHash, passed: false, stateId: null, plainComponents: false, trials }
    return { fit, preview: '', html: '' }
  } finally { host.remove() }
}
