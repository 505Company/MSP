import type { PixelBrief, PixelPlan, PixelEnvironment, PixelBox } from '../lib/presentations/pixel-contract'
import { containsPixelBox, overlapPixelBoxes } from '../lib/presentations/pixel-contract'
import { textGeometry } from './layout-execution'
import { decoration } from './component-flow'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const position = (b: PixelBox) => `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;`
export type PixelMeasurement = { id: string; regionId: string; box: PixelBox; ink: PixelBox; lines: number; contentHeight: number; scrollWidth: number; scrollHeight: number; text: string; fontSize: number; fontFamily: string }
export type PixelReport = { version: 'pixel-executor-1'; passed: boolean; issues: string[]; geometryUnchanged: boolean; measurements: PixelMeasurement[]; regions: { id: string; box: PixelBox }[]; textPixels: { id: string; pixels: number }[]; planHash: string; preview: string }

/** Execute exactly one model-authored plan. No candidate search, font fitting,
 * re-grouping, fallback component, colour choice or coordinate correction. */
export async function renderPixelLayout(env: PixelEnvironment, brief: PixelBrief, plan: PixelPlan, planHash: string): Promise<PixelReport> {
  const root = document.createElement('div'), color = (id: string) => env.input.colors.find(c => c.id === id)!.hex
  root.style.cssText = `position:fixed;left:0;top:0;width:1920px;height:1080px;background:${color(plan.canvas.background)};overflow:hidden;z-index:2147483647;letter-spacing:0;`
  root.dataset.pixelRoot = 'true'
  root.innerHTML = plan.regions.map(r => {
    const group = brief.groups.find(g => g.id === r.id), template = group?.component ? env.input.components.find(t => t.id === group.component!.id)! : null
    const artwork = template ? r.mode === 'flow' ? decoration(template, env.input.componentFlows![template.id]) : `<div style="position:absolute;inset:0">${template.sourceLayout!.graphic}</div>` : ''
    const texts = plan.texts.filter(t => t.regionId === r.id).map(t => {
      const family = env.input.fonts.find(f => f.id === t.fontToken)!.family
      const text = t.fragments.map(id => env.input.content.find(f => f.id === id)!.text).join('\n')
      return `<div data-pixel-text="${esc(t.id)}" style="${position(t.box)}font-family:${esc(JSON.stringify(family))};font-size:${t.fontSize}px;line-height:${t.lineHeight}px;font-weight:${t.weight};color:${color(t.color)};opacity:${t.opacity};text-align:${t.align};white-space:${t.wrap ? 'pre-wrap' : 'pre'};overflow-wrap:normal;word-break:normal;letter-spacing:0;overflow:visible;"><span>${esc(text)}</span></div>`
    }).join('')
    return `<section data-pixel-region="${esc(r.id)}" style="${position(r.box)}box-sizing:border-box;border-radius:${r.radius}px;background:${r.background ? color(r.background) : 'transparent'};">${artwork}${texts}</section>`
  }).join('')
  document.body.appendChild(root)
  const issues: string[] = [], measurements: PixelMeasurement[] = [], regions: PixelReport['regions'] = []
  try {
    await document.fonts.ready
    const origin = root.getBoundingClientRect(), rect = (r: DOMRect): PixelBox => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })
    for (const image of root.querySelectorAll('image,img')) {
      try { const im = new Image(); im.src = image.getAttribute('href') ?? image.getAttribute('src') ?? ''; await im.decode() } catch { issues.push('component-artwork-unavailable') }
    }
    for (const node of root.querySelectorAll<HTMLElement>('[data-pixel-region]')) regions.push({ id: node.dataset.pixelRegion!, box: rect(node.getBoundingClientRect()) })
    for (const node of root.querySelectorAll<HTMLElement>('[data-pixel-text]')) {
      const t = plan.texts.find(t => t.id === node.dataset.pixelText)!, region = plan.regions.find(r => r.id === t.regionId)!, box = rect(node.getBoundingClientRect())
      const geometry = textGeometry(node), left = Math.min(...geometry.ink.map(r => r.left)), top = Math.min(...geometry.ink.map(r => r.top))
      const ink = geometry.ink.length ? rect(new DOMRect(left, top, Math.max(...geometry.ink.map(r => r.right)) - left, Math.max(...geometry.ink.map(r => r.bottom)) - top)) : { ...box, width: 0, height: 0 }
      const style = getComputedStyle(node), text = node.textContent ?? ''
      const family = env.input.fonts.find(f => f.id === t.fontToken)!.family
      if (![...document.fonts].some(f => f.status === 'loaded' && f.family.replace(/^["']|["']$/g, '') === family)) issues.push(`font-unavailable:${t.id}`)
      if (text !== t.fragments.map(id => env.input.content.find(f => f.id === id)!.text).join('\n')) issues.push(`source-changed:${t.id}`)
      if (node.scrollWidth > box.width + 1 || node.scrollHeight > box.height + 1 || !ink.width || !ink.height || !containsPixelBox(box, ink)) issues.push(`overflow:${t.id}:lines=${geometry.lines},requiredHeight=${Math.max(node.scrollHeight, geometry.lines*t.lineHeight)},available=${box.width}x${box.height}`)
      if (!containsPixelBox(region.box, ink)) issues.push(`region-overflow:${t.id}`)
      measurements.push({ id: t.id, regionId: t.regionId, box, ink, lines: geometry.lines, contentHeight: geometry.lines * t.lineHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, text, fontSize: parseFloat(style.fontSize), fontFamily: family })
    }
    for (let i = 0; i < measurements.length; i++) for (let j = i + 1; j < measurements.length; j++) if (overlapPixelBoxes(measurements[i].ink, measurements[j].ink)) issues.push(`text-collision:${measurements[i].id}/${measurements[j].id}`)
    const equal = (a: PixelBox, b: PixelBox) => ['x','y','width','height'].every(k => Math.abs(a[k as 'x'] - b[k as 'x']) < .1)
    const geometryUnchanged = regions.every(r => equal(r.box, plan.regions.find(p => p.id === r.id)!.box)) && measurements.every(m => {
      const t = plan.texts.find(t => t.id === m.id)!, region = plan.regions.find(r => r.id === t.regionId)!
      return equal(m.box, { ...t.box, x: t.box.x + region.box.x, y: t.box.y + region.box.y }) && Math.abs(m.fontSize - t.fontSize) < .01
    })
    if (!geometryUnchanged) issues.push('executor-changed-model-geometry')
    if (!window.__mspCaptureLayout) throw Error('Native screenshot hook required')
    const capture = async () => { const id = crypto.randomUUID(); root.dataset.layoutCapture = id; return window.__mspCaptureLayout!(id) }
    const preview = await capture()
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-pixel-text]')]
    let blank: string
    try { nodes.forEach(n => { n.style.visibility = 'hidden' }); blank = await capture() }
    finally { nodes.forEach(n => { n.style.visibility = '' }) }
    const pixels = async (src: string) => {
      const im = new Image(); im.src = src; await im.decode()
      if (im.width !== 1920 || im.height !== 1080) throw Error('Pixel pilot requires full-size PNG')
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
      const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(im, 0, 0)
      return ctx.getImageData(0, 0, c.width, c.height).data
    }
    const visible = await pixels(preview), hidden = await pixels(blank), textPixels = measurements.map(m => {
      let count = 0
      for (let y = Math.max(0, Math.floor(m.ink.y)); y < Math.min(1080, Math.ceil(m.ink.y + m.ink.height)); y++) for (let x = Math.max(0, Math.floor(m.ink.x)); x < Math.min(1920, Math.ceil(m.ink.x + m.ink.width)); x++) {
        const i = (y * 1920 + x) * 4
        if ([0,1,2].some(n => Math.abs(visible[i+n] - hidden[i+n]) > 25)) count++
      }
      if (count < 3) issues.push(`missing-text-pixels:${m.id}`)
      return { id: m.id, pixels: count }
    })
    return { version: 'pixel-executor-1', passed: !issues.length, issues, geometryUnchanged, measurements, regions, textPixels, planHash, preview }
  } finally { root.remove() }
}
