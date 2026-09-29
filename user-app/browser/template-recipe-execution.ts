import type { ElementIR, TextElementIR } from '../vendor/drag/src/core/model'
import { renderSlidePreview, renderTextSvg } from '../vendor/drag/src/formats/pptx/preview'
import { ensureSceneFonts, ensureUploadFonts } from './fonts'
import type { TemplateRecipe } from '../lib/presentations/recipes/template-contract'
import type { RecipeMaterial } from '../lib/presentations/recipes/pilot-cases'
import { instantiateTemplate, templateCandidateStates, type TemplatePlan } from '../lib/presentations/recipes/template-plan'
import type { TemplateRenderReport } from '../lib/presentations/recipes/template-measurement'
import { contentHash } from '../lib/design-system/catalog'
import type { ReflowMeasurement } from '../lib/presentations/recipes/template-reflow'
import { comparisonGeometryIssues, resolveTemplateComparison } from '../lib/presentations/recipes/template-comparison'

function textElements(elements: ElementIR[], x = 0, y = 0): TextElementIR[] {
  return elements.flatMap(e => 'children' in e ? textElements(e.children, x + e.bounds.x, y + e.bounds.y)
    : e.kind === 'text' ? [{ ...e, bounds: { ...e.bounds, x: x + e.bounds.x, y: y + e.bounds.y } }] : [])
}
function withoutText(elements: ElementIR[]): ElementIR[] {
  return elements.flatMap((e): ElementIR[] => e.kind === 'text' ? [] : 'children' in e ? [{ ...e, children: withoutText(e.children) }] : [e])
}
const assetCache = new Map<string, Promise<{ id: string; bytes: Uint8Array }>>()
async function sourceAssets(recipe: TemplateRecipe) {
  const ids = new Set<string>()
  const walk = (elements: ElementIR[]) => { for (const e of elements) { if (e.kind === 'raster') ids.add(e.assetId); if ('children' in e) walk(e.children) } }
  walk(recipe.originalElements)
  const assets = []
  for (const id of ids) {
    const key = `${recipe.passport.origin.uploadId}:${id}`
    let load = assetCache.get(key)
    if (!load) {
      load = (async () => {
        const response = await fetch(`/api/uploads/${recipe.passport.origin.uploadId}/assets/${encodeURIComponent(id)}`)
        if (!response.ok) throw Error(`Missing source asset: ${id}`)
        return { id, bytes: new Uint8Array(await response.arrayBuffer()) }
      })()
      assetCache.set(key, load)
      void load.catch(() => assetCache.delete(key))
    }
    assets.push(await load)
  }
  return assets
}
async function bitmap(data: string) {
  const image = new Image(); image.src = data; await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return { canvas, context, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
}

/** Every state comes from a compiled recipe. The source's native typesetter is
 * shared by measurement and PNG; a no-text baseline verifies actual ink. */
export async function renderTemplateRecipe(recipe: TemplateRecipe, material: RecipeMaterial | null, plan: TemplatePlan | null): Promise<TemplateRenderReport> {
  const fontWarnings = await ensureUploadFonts(recipe.passport.origin.uploadId!)
  const assets = await sourceAssets(recipe), trials: TemplateRenderReport['trials'] = []
  const canvas = recipe.passport.canvas, originals = new Map(textElements(recipe.originalElements).map(e => [e.id, e]))
  const states = material ? templateCandidateStates(recipe, plan!) : ['reconstruction']
  if (!states.length) throw Error('INCOMPATIBLE_WITH_RECIPE: no permitted state for all bound content')
  let final!: TemplateRenderReport
  for (const stateId of states) {
    let elements = material ? instantiateTemplate(recipe, material, plan!, stateId) : recipe.originalElements
    const issues: string[] = [], fonts = await ensureSceneFonts(elements)
    issues.push(...fonts.filter(f => f.severity !== 'warning').map(f => f.message))
    const measurements: TemplateRenderReport['measurements'] = []
    let reflowMeasurements: ReflowMeasurement[] | undefined
    let comparisonMeasurements: ReflowMeasurement[] | undefined
    if (material && recipe.stateGraphics?.[stateId]) {
      reflowMeasurements = []
      for (const text of textElements(elements)) if (recipe.slots.some(s => s.sourceId === text.id && s.item > 0)) {
        const { ink } = await renderTextSvg({ ...text, bounds: { ...text.bounds, height: canvas.height * 2 }, textBox: { align: text.textBox?.align ?? 'LEFT', wrap: text.textBox?.wrap ?? true, vertical: 'TOP' } })
        reflowMeasurements.push({ sourceId: text.id, width: text.bounds.width, height: Math.max(1, ink.bottom + 2) })
      }
      elements = instantiateTemplate(recipe, material, plan!, stateId, reflowMeasurements)
    }
    if (material && recipe.comparison) {
      comparisonMeasurements = []
      for (const text of textElements(elements)) if (recipe.slots.some(s => s.sourceId === text.id && s.item > 0 && ['heading', 'body'].includes(s.role))) {
        const { ink } = await renderTextSvg({ ...text, bounds: { ...text.bounds, height: canvas.height * 2 }, textBox: { align: text.textBox?.align ?? 'LEFT', wrap: true, vertical: 'TOP' } })
        comparisonMeasurements.push({ sourceId: text.id, width: text.bounds.width, height: Math.max(1, ink.bottom + 2) })
      }
      elements = instantiateTemplate(recipe, material, plan!, stateId, comparisonMeasurements)
    }
    for (const text of textElements(elements)) {
      const { ink } = await renderTextSvg(text), source = originals.get(text.id)!, originalInk = (await renderTextSvg(source)).ink
      const box = text.bounds
      const allowed = recipe.stateGraphics?.[stateId] || material && recipe.comparison ? { left: 0, top: 0, right: box.width, bottom: box.height }
        : { left: Math.min(0, originalInk.left), top: Math.min(0, originalInk.top), right: Math.max(box.width, originalInk.right), bottom: Math.max(box.height, originalInk.bottom) }
      if (material && (ink.left < allowed.left - 2 || ink.top < allowed.top - 2 || ink.right > allowed.right + 2 || ink.bottom > allowed.bottom + 2)) issues.push(`overflow:${text.id}`)
      if (box.x + ink.left < -2 || box.y + ink.top < -2 || box.x + ink.right > canvas.width + 2 || box.y + ink.bottom > canvas.height + 2) issues.push(`canvas-overflow:${text.id}`)
      measurements.push({ sourceId: text.id, text: text.text, fontSize: text.fontSize, box: { ...box }, ink, pixels: 0 })
    }
    if (material) for (let i = 0; i < measurements.length; i++) for (let j = i + 1; j < measurements.length; j++) {
      const a = measurements[i], b = measurements[j]
      if (a.box.x + a.ink.left < b.box.x + b.ink.right - 2 && b.box.x + b.ink.left < a.box.x + a.ink.right - 2 &&
        a.box.y + a.ink.top < b.box.y + b.ink.bottom - 2 && b.box.y + b.ink.top < a.box.y + a.ink.bottom - 2) issues.push(`collision:${a.sourceId}:${b.sourceId}`)
    }
    const comparison = material && recipe.comparison ? resolveTemplateComparison(recipe, material, plan!, comparisonMeasurements) : null
    if (comparison) issues.push(...comparisonGeometryIssues(recipe, comparison, measurements))
    const page = { schemaVersion: 1 as const, id: stateId, sourceIndex: 0, ...canvas, elements, assets, degradations: [] }
    const preview = await renderSlidePreview(page, 1024)
    const background = await renderSlidePreview({ ...page, elements: withoutText(elements) }, 1024)
    const image = await bitmap(preview), blank = await bitmap(background)
    try {
      const sx = image.canvas.width / canvas.width, sy = image.canvas.height / canvas.height
      for (const measured of measurements) {
        const { box, ink } = measured
        const left = Math.max(0, Math.floor((box.x + ink.left) * sx)), top = Math.max(0, Math.floor((box.y + ink.top) * sy))
        const right = Math.min(image.canvas.width, Math.ceil((box.x + ink.right) * sx)), bottom = Math.min(image.canvas.height, Math.ceil((box.y + ink.bottom) * sy))
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const index = (y * image.canvas.width + x) * 4
          if ([0, 1, 2].some(c => Math.abs(image.pixels[index + c] - blank.pixels[index + c]) > 25)) measured.pixels++
        }
        if (measured.text.trim() && measured.pixels < 3) issues.push(`png-text-missing:${measured.sourceId}`)
      }
    } finally { image.canvas.width = blank.canvas.width = 0 }
    trials.push({ stateId, issues })
    final = { recipeVersion: recipe.passport.version, materialHash: await contentHash(material ?? { reconstruction: recipe.sourceSnapshotHash }), stateId,
      passed: issues.length === 0, issues, fontWarnings: [...new Set([...fontWarnings, ...fonts.filter(f => f.severity === 'warning').map(f => f.message)])], measurements, trials: structuredClone(trials), ...(reflowMeasurements ? { reflowMeasurements } : {}),
      ...(comparison ? { comparisonMeasurements, graphicMeasurements: Object.entries(comparison.graphics).map(([sourceId, box]) => ({ sourceId, box })) } : {}), preview }
    if (final.passed) return final
  }
  return final
}
