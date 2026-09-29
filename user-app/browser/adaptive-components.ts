import { renderComponentFlow } from './component-flow'
import { flowIssues } from '../lib/design-system/component-flow-layout'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import { glyphInk } from '../lib/design-system/editable-hydrate'
import { renderTextSvg } from '../vendor/drag/src/formats/pptx/preview'
import { adaptiveComponentData, componentElements, componentScale, componentMeasurementIssues, type AdaptiveComponent, type ComponentMeasurement } from '../lib/presentations/adaptive-components'
import type { AdaptivePlan, AdaptiveTrial } from '../lib/presentations/adaptive-layout'
import type { LayoutInput } from '../lib/presentations/layout-contract'
import { measurePreparedBox } from './prepared-components'
import { preparedContent, PREPARED_BOX_VERSION } from '../lib/presentations/prepared-components'

export function componentHtml(binding: AdaptiveComponent, input: LayoutInput, fillWidth = false, flow = false, prepared = false) {
  const t = input.components.find(t => t.id === binding.id)!, copy = structuredClone(t)
  if (prepared && input.preparedComponents?.[t.id]) return '<div data-adaptive-component data-prepared-box style="width:100%;min-width:0"></div>'
  if(flow && input.componentFlows?.[t.id])return `<div data-adaptive-component data-component-flow style="width:100%;min-width:0"></div>`
  // Native artwork includes its own background and insets. No outer card skin.
  copy.style = { ...copy.style, background: 'transparent', padding: 0, border: undefined, radius: 0 }
  return `<div data-adaptive-component style="width:100%;${fillWidth ? '' : `max-width:${t.width * componentScale(t, 100000)}px;`}aspect-ratio:${t.width}/${t.height};">${renderEditableHtml(copy, adaptiveComponentData(binding, t, input))}</div>`
}
export async function measureAdaptiveComponents(root: HTMLElement, plan: AdaptivePlan, input: LayoutInput, step: number, options: { fillWidth?: boolean; fitText?: boolean; flow?: boolean } = {}): Promise<ComponentMeasurement[]> {
  const result: ComponentMeasurement[] = [], origin = root.getBoundingClientRect(), family = input.fonts.find(f => f.id === plan.fontToken)!.family
  for (const [i, b] of plan.blocks.entries()) for (const [j, p] of b.parts.entries()) if (p.component) {
    const id = `block-${i}-part-${j}`, unit = root.querySelector<HTMLElement>(`[data-adaptive-unit="${id}"]`)!, node = unit.firstElementChild as HTMLElement
    const template = input.components.find(t => t.id === p.component!.id)!, bounds = node.getBoundingClientRect(), scale = bounds.width / template.width
    const m: ComponentMeasurement = { id, templateId: template.id, x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height, scale, fontFamily: family, assetsLoaded: true, fields: [] }
    const pin = plan.version === PREPARED_BOX_VERSION && input.preparedComponents?.[template.id]
    if (pin) {
      const background = input.colors.find(c => c.id === plan.colors.background)!.hex
      const content = preparedContent(p.component, pin, input.content), width = Math.min(unit.getBoundingClientRect().width, pin.profile.maxWidth)
      node.style.width = `${width}px`
      const maxHeight = Math.min(pin.profile.maxHeight, root.querySelector('[data-adaptive-body]')!.getBoundingClientRect().height)
      const preparedResult = await measurePreparedBox(input.uploadId, pin, content, { width, maxHeight: Math.max(60, maxHeight), heightMode: 'hug', widthMode: 'fill', background }, node, !options.fitText)
      const { measurement, evidence } = preparedResult, chosen = measurement.chosen
      const b = node.getBoundingClientRect(); m.x = b.x - origin.x; m.y = b.y - origin.y; m.width = b.width; m.height = b.height; m.scale = 1; m.fontStep = chosen?.step ?? 0
      m.prepared = { id, version: measurement.version, fingerprint: measurement.fingerprint, status: measurement.status, constraints: measurement.constraints, chosen, feasibleSizes: measurement.feasibleSizes, pixels: evidence?.pixels, ...(evidence?.artwork ? { artwork: evidence.artwork } : {}) }
      m.fields = chosen?.fields.map(f => ({ sourceId: f.id, text: f.text, fontSize: f.fontSize, box: { ...f.box, x: f.box.x + m.x, y: f.box.y + m.y }, ink: { ...f.ink, x: f.ink.x + m.x, y: f.ink.y + m.y } })) ?? []
      for (const field of node.querySelectorAll<HTMLElement>('[data-component-field]')) field.setAttribute('data-adaptive-native-text', `${id}:${field.dataset.componentField}`)
      node.dataset.adaptiveFontStep = String(m.fontStep)
      m.assetsLoaded = measurement.status === 'fits' && (!evidence || evidence.passed)
      if (measurement.status !== 'fits') node.style.minHeight = `${Math.min(pin.profile.maxHeight, chosen?.requiredHeight ?? 1000)}px`
      else node.style.removeProperty('min-height')
      result.push(m); continue
    }
    const profile=options.flow && input.componentFlows?.[template.id]
    if(profile) {
      const data=adaptiveComponentData(p.component,template,input), width=unit.getBoundingClientRect().width
      let measured: Awaited<ReturnType<typeof renderComponentFlow>> | undefined
      for(let n=0;n<=4;n++){measured=await renderComponentFlow(node,template,data,width,n);if(!flowIssues(measured,template,data,profile).length)break}
      node.style.width='100%';node.dataset.adaptiveFontStep=String(measured!.fontStep)
      const b=node.getBoundingClientRect();m.x=b.x-origin.x;m.y=b.y-origin.y;m.width=b.width;m.height=b.height;m.scale=1;m.fontStep=measured!.fontStep;m.layoutVersion=profile.version;m.flowDirection=measured!.direction
      m.fields=measured!.fields.map(f=>({...f,box:{...f.box,x:f.box.x+m.x,y:f.box.y+m.y},ink:{...f.ink,x:f.ink.x+m.x,y:f.ink.y+m.y}}))
      for(const n of node.querySelectorAll('[data-adaptive-native-text]'))n.setAttribute('data-adaptive-native-text',`${id}:${n.getAttribute('data-flow-text')}`)
      result.push(m);continue
    }
    // Decode original artwork before capturing; a broken image cannot qualify.
    for (const image of node.querySelectorAll('image')) {
      try { const bitmap = new Image(); bitmap.src = image.getAttribute('href') ?? ''; await bitmap.decode() } catch { m.assetsLoaded = false }
    }
    const steps = options.fitText ? [0, 1, 2, 3, 4] : [options.fillWidth ? Number(node.dataset.adaptiveFontStep) : step]
    for (const localStep of steps) {
      m.fields = []
      if (options.fillWidth) m.fontStep = localStep
      const elements = componentElements(p.component, template, input, family, localStep)
      for (const [index, e] of elements.entries()) {
        const target = [...node.querySelectorAll<SVGSVGElement>('[data-source-text]')].find(n => n.dataset.sourceText === e.id)!
        const recovered = template.sourceLayout!.text[index].recoveredAsset
        if (recovered) {
          try { e.colorRuns = [{ start: 0, end: e.text.length, fill: { type: 'solid', color: await glyphInk(recovered) } }] } catch { m.assetsLoaded = false }
        }
        const rendered = await renderTextSvg(e)
        target.innerHTML = rendered.svg
        target.setAttribute('data-adaptive-native-text', `${id}:${e.id}`)
        const normalize = (s: string) => s.replace(/\s+/g, '')
        const text = normalize(target.textContent ?? '') === normalize(e.text) ? e.text : target.textContent ?? ''
        const box = { x: m.x + e.bounds.x * scale, y: m.y + e.bounds.y * scale, width: e.bounds.width * scale, height: e.bounds.height * scale }
        m.fields.push({ sourceId: e.id, text, fontSize: Math.min(e.fontSize, ...e.styleRuns?.map(r => r.fontSize) ?? []) * scale, box,
          ink: { x: box.x + rendered.ink.left * scale, y: box.y + rendered.ink.top * scale, width: (rendered.ink.right - rendered.ink.left) * scale, height: (rendered.ink.bottom - rendered.ink.top) * scale } })
      }
      if (!options.fitText) break
      node.dataset.adaptiveFontStep = String(localStep)
      // Native field wrapping is scale-invariant. Resolve it locally before
      // allocating tracks; absolute font floors are checked at the final size.
      const issues = componentMeasurementIssues(m, p.component, input, family, localStep, bounds.width, true, false, true)
      if (!issues.some(i => /^component-(?:field-overflow|overflow|collision):/.test(i))) break
    }
    result.push(m)
  }
  return result
}

/** Difference from the same PNG with native glyphs hidden prevents coloured
 * panels/artwork from being mistaken for rendered text. */
export async function verifyComponentPixels(root: HTMLElement, preview: string, trial: AdaptiveTrial, capture: () => Promise<string>) {
  if (!trial.components?.length) return []
  const nodes = [...root.querySelectorAll<SVGSVGElement>('[data-adaptive-native-text]')]
  let blank: string
  try {
    nodes.forEach(n => { n.style.visibility = 'hidden' })
    blank = await capture()
  } finally { nodes.forEach(n => { n.style.removeProperty('visibility') }) }
  const bitmap = async (src: string) => {
    const image = new Image(); image.src = src; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0)
    return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
  }
  const a = await bitmap(preview), b = await bitmap(blank), blocks = [], scale = a.canvas.width / 1920
  try {
    if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height) throw Error('COMPONENT_PREVIEW_DIMENSIONS')
    for (const component of trial.components) for (const f of component.fields) {
      let pixels = 0
      for (let y = Math.max(0, Math.floor(f.ink.y * scale)); y < Math.min(a.canvas.height, Math.ceil((f.ink.y + f.ink.height) * scale)); y++) {
        for (let x = Math.max(0, Math.floor(f.ink.x * scale)); x < Math.min(a.canvas.width, Math.ceil((f.ink.x + f.ink.width) * scale)); x++) {
          const at = (y * a.canvas.width + x) * 4
          if ([0, 1, 2].some(c => Math.abs(a.pixels[at + c] - b.pixels[at + c]) > 25)) pixels++
        }
      }
      if (pixels < 3) throw Error(`COMPONENT_PREVIEW_TEXT_MISSING:${component.id}:${f.sourceId}`)
      blocks.push({ block: `${component.id}:${f.sourceId}`, pixels })
    }
    return blocks
  } finally { a.canvas.width = b.canvas.width = 0 }
}
