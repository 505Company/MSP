import { toPng } from 'html-to-image'
import { FREE_FLEX_VERSION, flexDeclarations, flexText, flexColor, validateFreeFlex, type FreeFlexPlan, type FreeFlexNode, type FlexRef } from '../lib/presentations/free-flex'
import { sourceInk, type PixelEnvironment } from '../lib/presentations/pixel-contract'
import { componentSlots } from '../lib/presentations/adaptive-components'
import { textGeometry } from './layout-execution'
import { decoration } from './component-flow'
import { renderTextSvg } from '../vendor/drag/src/formats/pptx/preview'
import { nativeBoundText } from '../lib/design-system/editable-native-layout'
import { componentData } from '../lib/presentations/layout-contract'
import { contrastRatio } from '../lib/presentations/layout-html'

type Box = { x: number; y: number; width: number; height: number }
export type FlexMeasurement = { id: string; parent: string | null; kind: string; box: Box; text?: string; fontSize?: number; fontFamily?: string; fontWeight?: string; color?: string; ink?: Box[]; refs?: FlexRef[]; scroll?: { width: number; height: number; clientWidth: number; clientHeight: number } }
export type FreeFlexReport = { version: string; planHash: string; passed: boolean; issues: string[]; warnings: string[]; measurements: FlexMeasurement[]; textPixels: { id: string; pixels: number }[]; preview: string; html: string; planUnchanged: boolean }
const contains = (a: Box, b: Box) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1
const overlap = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
function styles(node: HTMLElement, css: string, env: PixelEnvironment) {
  for (const [name, raw] of flexDeclarations(css, env)) {
    const value = name === 'font-family' ? `"${env.input.fonts.find(f => f.id === raw)!.family}"` : raw.replace(/\bcolor-\d+\b/gu, token => flexColor(token, env))
    if (!CSS.supports(name, value)) throw Error(`unsupported-css-value:${name}:${raw}`)
    node.style.setProperty(name, value)
  }
}
function textNode(id: string, refs: FlexRef[], css: string, env: PixelEnvironment) {
  const node = document.createElement('div')
  node.dataset.flexText = id
  node.style.cssText = 'box-sizing:border-box;min-width:0;min-height:0;flex:0 0 auto;white-space:pre-wrap;overflow-wrap:normal;'
  styles(node, css, env); node.textContent = flexText(refs, env.input)
  return node
}
function dataFor(model: FreeFlexNode, env: PixelEnvironment) {
  const c = model.component!, template = env.input.components.find(t => t.id === c.id)!
  const source = c.fields.map(f => ({ id: f.path, text: flexText(f.refs, env.input) }))
  const data = componentData({ id: c.id, fields: source.map(f => ({ path: f.id, parts: [{ fragmentId: f.id, start: 0, end: f.text.length }] })) }, template, { ...env.input, content: source })
  return { template, data }
}
export async function renderFreeFlex(env: PixelEnvironment, plan: FreeFlexPlan, planHash: string, fontCss = '', surfaces: readonly { nodeId: string; componentId: string; adaptation: 'compound-metrics-1' }[] = [], visuals: readonly { nodeId: string; graphicId: string; dataUrl: string; fit: 'contain' | 'cover' }[] = []): Promise<FreeFlexReport> {
  validateFreeFlex(plan, env, visuals)
  if (new Set(visuals.map(v => v.nodeId)).size !== visuals.length) throw Error('duplicate-recipe-visual')
  for (const v of visuals) if (!env.input.graphics.some(g => g.id === v.graphicId) || !/^data:image\//u.test(v.dataUrl) ||
    !plan.nodes.some(n => n.id === v.nodeId && n.kind === 'flex') || plan.nodes.some(n => n.parent === v.nodeId)) throw Error('invalid-recipe-visual')
  if (new Set(surfaces.map(s => s.nodeId)).size !== surfaces.length) throw Error('duplicate-library-surface')
  for (const s of surfaces) {
    const n = plan.nodes.find(n => n.id === s.nodeId)
    if (!n || n.kind !== 'flex' || !env.input.componentFlows?.[s.componentId] || !env.input.components.find(t => t.id === s.componentId)?.sourceLayout ||
      flexDeclarations(n.css).some(([k]) => /background|border/u.test(k))) throw Error('invalid-library-surface')
  }
  const before = JSON.stringify(plan), issues: string[] = [], warnings: string[] = [], measurements: FlexMeasurement[] = []
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;z-index:2147483647;pointer-events:none;'; document.body.appendChild(host)
  const elements = new Map<string, HTMLElement>(), refsById = new Map<string, FlexRef[]>(), nativeTexts: { model: FreeFlexNode; node: HTMLElement }[] = []
  const make = (model: FreeFlexNode): HTMLElement => {
    const node = model.kind === 'text' ? textNode(model.id, model.refs, model.css, env) : document.createElement('div')
    if (model.kind !== 'text') {
      node.style.cssText = `box-sizing:border-box;min-width:0;min-height:0;flex:0 0 auto;${model.kind === 'flex' || model.component?.mode === 'free-flow' ? 'display:flex;' : ''}`
      styles(node, model.css, env)
    } else refsById.set(model.id, model.refs)
    node.dataset.flexNode = model.id; elements.set(model.id, node)
    if (model.kind === 'flex') for (const child of plan.nodes.filter(n => n.parent === model.id)) node.appendChild(make(child))
    const visual = visuals.find(v => v.nodeId === model.id)
    if (visual) {
      const img = document.createElement('img'); img.src = visual.dataUrl; img.alt = ''
      img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${visual.fit};`
      node.style.position = 'relative'; node.dataset.libraryGraphic = visual.graphicId; node.appendChild(img)
    }
    const surface = surfaces.find(s => s.nodeId === model.id)
    if (surface) {
      const template = env.input.components.find(t => t.id === surface.componentId)!
      const skin = document.createElement('div'); skin.innerHTML = decoration(template, env.input.componentFlows![template.id])
      node.style.position = 'relative'
      for (const child of node.children) if (child instanceof HTMLElement) child.style.position = 'relative'
      node.insertBefore(skin.firstElementChild!, node.firstChild)
      node.dataset.librarySurface = template.id; node.dataset.libraryAdaptation = surface.adaptation
    }
    if (model.component) {
      const { template } = dataFor(model, env)
      if (model.component.mode === 'free-flow') {
        const skin = document.createElement('div'); skin.innerHTML = decoration(template, env.input.componentFlows![template.id])
        node.style.position = 'relative'; node.appendChild(skin.firstElementChild!)
        for (const field of model.component.fields) {
          const slot = componentSlots(template).findIndex(s => s.paths.includes(field.path))
          const ink = sourceInk(template, slot, env.input), fieldCss = flexDeclarations(field.css).some(([k]) => k === 'color') ? field.css : `color:${ink.color};${field.css}`
          const id = `${model.id}:${field.path}`, text = textNode(id, field.refs, fieldCss, env)
          // Decoration is the only positioned element; all content stays in flex.
          text.style.position = 'relative'; text.style.opacity = String(ink.opacity); refsById.set(id, field.refs); node.appendChild(text)
        }
      } else {
        const intrinsic = document.createElement('div')
        intrinsic.style.cssText = `position:relative;width:100%;aspect-ratio:${template.width}/${template.height};`
        intrinsic.dataset.flexNative = model.id
        intrinsic.innerHTML = template.sourceLayout!.graphic
        for (const s of intrinsic.children) if (s instanceof SVGSVGElement) { s.style.width = '100%'; s.style.height = '100%' }
        node.appendChild(intrinsic); nativeTexts.push({ model, node: intrinsic })
      }
    }
    return node
  }
  try {
    const rootModel = plan.nodes.find(n => n.parent === null)!, root = make(rootModel)
    root.style.width = '1920px'; root.style.height = '1080px'; root.style.flex = 'none'
    root.dataset.freeFlexRoot = 'true'; host.appendChild(root)
    await document.fonts.ready
    for (const img of root.querySelectorAll('img')) try { await img.decode() } catch { issues.push('recipe-image-decode') }
    for (const { model, node } of nativeTexts) {
      const { template, data } = dataFor(model, env), scale = node.getBoundingClientRect().width / template.width
      if (!Number.isFinite(scale) || scale <= 0) { issues.push(`native-empty-frame:${model.id}`); continue }
      const slots = componentSlots(template)
      for (const [index, slot] of template.sourceLayout!.text.entries()) {
        const field = model.component!.fields.find(f => slots[index].paths.includes(f.path))!, id = `${model.id}:${field.path}`
        const sourceColor = sourceInk(template, index, env.input), fieldCss = flexDeclarations(field.css).some(([k]) => k === 'color') ? field.css : `color:${sourceColor.color};${field.css}`
        const probe = textNode(id, field.refs, fieldCss, env); node.appendChild(probe)
        const computed = getComputedStyle(probe), inkColor = computed.color, inkWeight = computed.fontWeight, e = nativeBoundText(slot, data)
        e.fontFamily = computed.fontFamily.replace(/^"|"$/gu, ''); e.fontSize = parseFloat(computed.fontSize) / scale
        e.styleRuns = [{ start: 0, end: e.text.length, fontSize: e.fontSize, fontFamily: e.fontFamily, fontStyle: Number(computed.fontWeight) >= 600 ? 'Bold' : 'Regular' }]
        const rgb = inkColor.match(/[\d.]+/gu)!.map(Number)
        e.colorRuns = [{ start: 0, end: e.text.length, fill: { type: 'solid', color: { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a: 1 } } }]
        delete e.paragraphs; e.flow = { columns: 1, gap: 0, autoFit: 'NONE' }
        const rendered = await renderTextSvg(e); probe.remove()
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), b = e.bounds
        svg.dataset.flexText = id; refsById.set(id, field.refs)
        svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`)
        svg.style.cssText = `position:absolute;left:${b.x * scale}px;top:${b.y * scale}px;width:${b.width * scale}px;height:${b.height * scale}px;overflow:visible;color:${inkColor};font-family:"${e.fontFamily}";font-size:${e.fontSize * scale}px;font-weight:${inkWeight};`
        svg.innerHTML = rendered.svg; node.appendChild(svg)
        svg.style.opacity = String(sourceColor.opacity)
        svg.dataset.sourceTextExact = flexText(field.refs, env.input)
        svg.dataset.nativeInk = JSON.stringify({ left: rendered.ink.left * scale, top: rendered.ink.top * scale, width: (rendered.ink.right - rendered.ink.left) * scale, height: (rendered.ink.bottom - rendered.ink.top) * scale })
      }
    }
    for (const im of root.querySelectorAll('image')) try { const bitmap = new Image(); bitmap.src = im.getAttribute('href') ?? ''; await bitmap.decode() } catch { issues.push('component-image-decode') }
    const origin = root.getBoundingClientRect(), rect = (b: DOMRect): Box => ({ x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height })
    for (const model of plan.nodes) {
      const node = elements.get(model.id)!, box = rect(node.getBoundingClientRect())
      measurements.push({ id: model.id, parent: model.parent, kind: model.kind, box })
      if (!box.width || !box.height || !contains({ x: 0, y: 0, width: 1920, height: 1080 }, box)) issues.push(`canvas-or-empty:${model.id}`)
      if (model.parent && !contains(rect(elements.get(model.parent)!.getBoundingClientRect()), box)) issues.push(`parent-overflow:${model.id}`)
      if (model.kind === 'flex' && getComputedStyle(node).display !== 'flex') issues.push(`not-flex:${model.id}`)
      const siblings = plan.nodes.filter(n => n.parent === model.id)
      for (let i = 0; i < siblings.length; i++) for (let j = i + 1; j < siblings.length; j++) if (overlap(rect(elements.get(siblings[i].id)!.getBoundingClientRect()), rect(elements.get(siblings[j].id)!.getBoundingClientRect()))) issues.push(`sibling-overlap:${siblings[i].id}:${siblings[j].id}`)
    }
    const hex = (cssColor: string) => '#' + cssColor.match(/[\d.]+/gu)!.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')
    const textMeasurements: FlexMeasurement[] = []
    for (const node of root.querySelectorAll<HTMLElement | SVGSVGElement>('[data-flex-text]')) {
      const id = node.dataset.flexText!, box = rect(node.getBoundingClientRect()), style = getComputedStyle(node)
      const native = node.dataset.nativeInk ? JSON.parse(node.dataset.nativeInk) : null
      const ink = native ? [{ x: box.x + native.left, y: box.y + native.top, width: native.width, height: native.height }] : textGeometry(node).ink.map(rect)
      const expected = flexText(refsById.get(id)!, env.input), actual = node.textContent ?? ''
      if (native ? actual.replace(/\s/gu, '') !== expected.replace(/\s/gu, '') : actual !== expected) issues.push(`rendered-text-changed:${id}`)
      if (!ink.length || ink.some(b => !contains(box, b))) issues.push(`text-overflow:${id}`)
      // Font ascent/descent can enlarge scrollHeight while every visible glyph
      // fits. Keep it as evidence; actual ink containment/collisions above decide.
      if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) warnings.push(`font-linebox-scroll:${id}`)
      const m = { id, parent: node.parentElement?.dataset.flexNode ?? null, kind: 'text-measurement', box, text: expected, fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily, fontWeight: style.fontWeight, color: style.color, ink, refs: refsById.get(id), scroll: { width: node.scrollWidth, height: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight } }
      textMeasurements.push(m)
      if (m.fontSize < 24) warnings.push(`small-text:${id}:${m.fontSize}px`)
      let ancestor: Element | null = node, background = 'rgb(255, 255, 255)'
      while (ancestor) { const c = getComputedStyle(ancestor).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { background = c; break }; ancestor = ancestor.parentElement }
      // Native artwork may supply the background; do not infer its colour from CSS.
      if (!node.closest('[data-flex-native],[data-library-surface]') && !plan.nodes.some(n => n.id === m.parent && n.component)) {
        const ratio = contrastRatio(hex(style.color), hex(background))
        if (ratio < 4.5) warnings.push(`low-contrast:${id}:${ratio.toFixed(2)}`)
      }
      const family = style.fontFamily.replace(/^"|"$/gu, '')
      if (!env.input.fonts.some(f => env.fontTokens.includes(f.id) && f.family === family)) issues.push(`unavailable-rendered-font:${id}:${family}`)
    }
    for (let i = 0; i < textMeasurements.length; i++) for (let j = i + 1; j < textMeasurements.length; j++) if (textMeasurements[i].ink!.some(a => textMeasurements[j].ink!.some(b => overlap(a, b)))) issues.push(`text-ink-overlap:${textMeasurements[i].id}:${textMeasurements[j].id}`)
    measurements.push(...textMeasurements)
    const capture = async () => {
      if (window.__mspCaptureLayout) { const id = crypto.randomUUID(); root.dataset.layoutCapture = id; return window.__mspCaptureLayout(id) }
      return toPng(root, { pixelRatio: 1, canvasWidth: 1920, canvasHeight: 1080, fontEmbedCSS: fontCss })
    }
    const preview = await capture(), textPixels: { id: string; pixels: number }[] = []
    const textNodes = [...root.querySelectorAll<HTMLElement>('[data-flex-text]')]
    const previousStyles = textNodes.map(n => n.getAttribute('style') ?? '')
    let hidden: string
    try { textNodes.forEach(n => n instanceof SVGSVGElement ? n.style.opacity = '0' : n.style.setProperty('color', 'transparent', 'important')); hidden = await capture() }
    finally { textNodes.forEach((n, i) => n.setAttribute('style', previousStyles[i])) }
    const pixels = async (src: string) => { const image = new Image(); image.src = src; await image.decode(); const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 1920, 1080).data }
    const visiblePixels = await pixels(preview), hiddenPixels = await pixels(hidden)
    for (const m of textMeasurements) {
      let count = 0
      for (const b of m.ink!) for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(1080, Math.ceil(b.y + b.height)); y++) for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(1920, Math.ceil(b.x + b.width)); x++) {
        const at = (y * 1920 + x) * 4
        if ([0, 1, 2].some(c => Math.abs(visiblePixels[at + c] - hiddenPixels[at + c]) > 20)) count++
      }
      textPixels.push({ id: m.id, pixels: count }); if (count < 3) issues.push(`invisible-text:${m.id}`)
    }
    return { version: FREE_FLEX_VERSION, planHash, passed: !issues.length, issues: [...new Set(issues)], warnings: [...new Set(warnings)], measurements, textPixels, preview, html: root.outerHTML, planUnchanged: before === JSON.stringify(plan) }
  } finally { host.remove() }
}
