import type { ComponentDefinition, ComponentIssue } from '../lib/design-system/types'
import { QUALIFICATION_VERSION, fieldKind, type ComponentQualification, type QualificationCase } from '../lib/design-system/calibration-contract'
import { instantiateComponent, visibleElements } from '../lib/design-system/compiler'
import { ensureSceneFonts, materializeFontSubstitutions } from './fonts'
import { renderComponent } from './component-execution'
import { renderSlidePreview } from '../vendor/drag/src/formats/pptx/preview'
import { parsePageIR } from '../vendor/drag/src/core/page-ir'
import { PptxCatalogReader } from '../vendor/drag/src/formats/pptx/catalog'
import { readSlide } from '../vendor/drag/src/formats/pptx/scene'
import { pptxExportIssues, writeEditablePptx } from '../lib/slides/pptx'

type Assets = Array<{ id: string; bytes: Uint8Array }>
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2, '0')).join('')
async function pixels(url: string, side = 40) {
  const image = new Image(); image.src = url; await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')!, scale = Math.min(side / image.width, side / image.height)
  ctx.fillStyle = '#8993a5'; ctx.fillRect(0, 0, side, side)
  ctx.drawImage(image, (side - image.width * scale) / 2, (side - image.height * scale) / 2, image.width * scale, image.height * scale)
  const data = [...ctx.getImageData(0, 0, side, side).data].filter((_, i) => i % 4 !== 3)
  canvas.width = canvas.height = 0; return data
}
async function rawPreview(component: ComponentDefinition, assets: Assets, edge = 400) {
  return renderSlidePreview(parsePageIR({ schemaVersion: 1, id: component.id, sourceIndex: 0, ...component.scene, assets, degradations: [] }), edge, undefined, true)
}
async function clippingIssues(component: ComponentDefinition, assets: Assets): Promise<ComponentIssue[]> {
  const { width, height, elements } = component.scene, pad = Math.max(4, Math.max(width, height) * .06)
  const expanded: ComponentDefinition = { ...component, scene: { width: width + pad * 2, height: height + pad * 2, elements: [{
    id: 'qualification-margin', name: 'Qualification margin', kind: 'group', visible: true, opacity: 1, rotation: 0, zIndex: 0,
    bounds: { x: pad, y: pad, width, height }, children: elements }] } }
  const image = new Image(); image.src = await rawPreview(expanded, assets, 512); await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, scale = 512 / Math.max(expanded.scene.width, expanded.scene.height)
  let outside = 0
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (x >= pad * scale - 1.5 && x <= (pad + width) * scale + 1.5 && y >= pad * scale - 1.5 && y <= (pad + height) * scale + 1.5) continue
    if (pixels[(y * canvas.width + x) * 4 + 3] > 40) outside++
  }
  canvas.width = canvas.height = 0
  return outside > 3 ? [{ code: 'component-clipping', message: 'Часть содержимого выходит за границы компонента.' }] : []
}
async function roundTrip(component: ComponentDefinition, assets: Assets, original: string) {
  const bytes = await writeEditablePptx(materializeFontSubstitutions(component), assets), reader = new PptxCatalogReader(bytes, new DOMParser())
  const page = await readSlide(reader, reader.analyze().pages[0])
  page.elements = page.elements.filter(e => e.name !== 'Slide background')
  const before = visibleElements(component.scene.elements), after = visibleElements(page.elements)
  const texts = (nodes: typeof before) => nodes.filter(e => e.kind === 'text').map(e => e.text).sort()
  if (JSON.stringify(texts(before)) !== JSON.stringify(texts(after))) return false
  if (before.filter(e => e.kind === 'raster').length !== after.filter(e => e.kind === 'raster').length) return false
  const a = await pixels(original, 128), b = await pixels(await renderSlidePreview(page, 400, undefined, true), 128)
  return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length / 255 < .025
}
function samples(component: ComponentDefinition) {
  const values = (mode: 'short' | 'typical' | 'long' | 'boundary') => Object.fromEntries(component.slots.map(slot => {
    const kind = fieldKind(slot), n = slot.defaultText.length
    const value = kind === 'ordinal' ? ({ short: '1', typical: '3', boundary: '99', long: '99999' })[mode]
      : kind === 'number' ? ({ short: '7', typical: n > 1 ? '25' : '8', boundary: '9'.repeat(Math.max(2, n + 1)), long: '123456789012345' })[mode]
      : kind === 'unit' ? slot.defaultText
      : mode === 'short' ? (n < 4 ? 'Да'.slice(0, Math.max(1, n)) : 'Тема')
      : mode === 'typical' ? (n < 4 ? 'Нет'.slice(0, Math.max(1, n)) : n < 10 ? 'Итог' : n < 30 ? 'Новый этап' : 'Краткое описание результата')
      : 'Подробное описание этапа и его результата. '.repeat(Math.ceil(Math.max(20, n * (mode === 'long' ? 3 : 1.3)) / 42)).slice(0, Math.min(4500, Math.max(20, Math.ceil(n * (mode === 'long' ? 3 : 1.3)))))
    return [slot.id, value]
  }))
  return (['short', 'typical', 'long', 'boundary'] as const).map(name => ({ name, values: values(name) }))
}
/** Uses the product renderer and editable exporter. Stress failures record
 * measured limits; arbitrary strings still need an instance render check. */
async function qualify(component: ComponentDefinition, assets: Assets): Promise<ComponentQualification> {
  await ensureSceneFonts(component.scene.elements)
  const cases: QualificationCase[] = [], issues: ComponentIssue[] = [], preview = await rawPreview(component, assets)
  for (const sample of [{ name: 'source' as const, values: {} as Record<string, string> }, ...(component.slots.length ? samples(component) : [])]) {
    try {
      const scene = { ...component, scene: instantiateComponent(component, sample.values) }
      const report = await renderComponent(component, sample.values, assets)
      const problems = [...report.issues, ...pptxExportIssues(scene), ...await clippingIssues(scene, assets)]
      const fits = !problems.some(i => i.severity !== 'warning'), exported = fits && await roundTrip(scene, assets, report.dataUrl)
      if (fits && !exported) problems.push({ code: 'pptx-roundtrip', message: 'После экспорта изменились текст, графика или внешний вид.' })
      cases.push({ ...sample, fits, issues: problems, roundTrip: exported })
    } catch {
      cases.push({ ...sample, fits: false, roundTrip: false, issues: [{ code: 'qualification-render', message: 'Не удалось проверить воспроизведение или редактируемый экспорт.' }] })
    }
  }
  const source = cases[0], changed = cases.slice(1).filter(c => c.fits && c.roundTrip)
  issues.push(...source.issues)
  if (component.slots.some(s => fieldKind(s) !== 'unit') && !changed.some(c => c.name === 'short' || c.name === 'typical')) issues.push({ code: 'no-editable-sample', message: 'Не прошла проверка замены содержания.' })
  const fields = component.slots.map(slot => {
    const values = [...new Set(changed.map(c => c.values[slot.id]))]
    return { id: slot.id, label: slot.label, kind: fieldKind(slot), samples: values, testedMaxLength: Math.max(0, ...values.map(v => v.length)) }
  })
  const neutral = Object.fromEntries(component.slots.map(s => [s.id, fieldKind(s) === 'unit' ? s.defaultText : fieldKind(s) === 'text' ? 'Т' : '1']))
  const normalized = await rawPreview({ ...component, scene: instantiateComponent(component, neutral) }, assets)
  return { version: QUALIFICATION_VERSION, componentId: component.id, definitionHash: await hash(component),
    ready: source.fits && source.roundTrip && !issues.some(i => i.severity !== 'warning'), fields, cases, issues, preview,
    signature: await pixels(normalized), environment: { userAgent: navigator.userAgent, fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.style + ' ' + f.weight).sort() } }
}

export async function qualifyComponent(component: ComponentDefinition, assets: Assets): Promise<ComponentQualification> {
  try { return await qualify(component, assets) }
  catch {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#8993a5'; ctx.fillRect(0, 0, 320, 160)
    ctx.fillStyle = '#fff'; ctx.font = '16px Arial'; ctx.fillText('Превью недоступно', 75, 85)
    const preview = canvas.toDataURL('image/png'); canvas.width = canvas.height = 0
    const issues = [{ code: 'qualification-render', message: 'Не удалось воспроизвести компонент или подставить новое содержание.' }]
    return { version: QUALIFICATION_VERSION, componentId: component.id, definitionHash: await hash(component), ready: false,
      fields: component.slots.map(s => ({ id: s.id, label: s.label, kind: fieldKind(s), samples: [], testedMaxLength: 0 })),
      cases: [{ name: 'source', values: {}, fits: false, roundTrip: false, issues }, ...samples(component).map(s => ({ ...s, fits: false, roundTrip: false, issues }))].slice(0, component.slots.length ? 5 : 1) as QualificationCase[],
      issues, preview, signature: await pixels(preview), environment: { userAgent: navigator.userAgent, fonts: [] } }
  }
}
