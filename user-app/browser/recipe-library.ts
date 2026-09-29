import { renderFreeFlex, type FreeFlexReport } from './free-flex'
import { applyLibraryVariants, metricVariants, optionFor, type LibraryVariant, type LibraryOption } from '../lib/presentations/recipes/library-choice'
import type { PixelEnvironment } from '../lib/presentations/pixel-contract'
import type { FreeFlexPlan } from '../lib/presentations/free-flex'
import type { RecipeBrand, LibrarySurface } from '../lib/presentations/recipes/content-recipe'
import { prepareLayoutFonts } from './layout-fonts'

export type RecipeLibraryInput = { env: PixelEnvironment; plan: FreeFlexPlan; brand: RecipeBrand; fontCss: string; surfaces: LibrarySurface[] }
export async function renderRecipeLibrary(input: RecipeLibraryInput, variants: LibraryVariant[] = []) {
  // A new page must install the actual fonts; a matching computed family name
  // and embedded screenshot CSS alone do not prove that the font is loaded.
  const fonts = await prepareLayoutFonts(input.env.input)
  if (input.env.fontTokens.some(token => !fonts.fontTokens.includes(token))) throw Error('Missing original library font')
  const plan = applyLibraryVariants(input.plan, variants, input.env)
  return renderFreeFlex(input.env, plan, JSON.stringify(plan), input.fontCss, input.surfaces)
}

async function crop(preview: string, box: { x: number; y: number; width: number; height: number }) {
  const img = new Image(); img.src = preview; await img.decode()
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(box.width); canvas.height = Math.ceil(box.height)
  canvas.getContext('2d')!.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export async function prepareRecipeLibrary(input: RecipeLibraryInput) {
  const baseline = await renderRecipeLibrary(input)
  if (!baseline.passed) throw Error(`Baseline failed: ${baseline.issues.join(', ')}`)
  const variants: LibraryVariant[] = [], options: LibraryOption[] = [], trials: { id: string; issues: string[] }[] = []
  for (const node of input.plan.nodes.filter(n => n.component)) {
    const box = baseline.measurements.find(m => m.id === node.id)!.box, admitted = new Set<string>()
    for (const candidate of metricVariants(input.plan, node.id, box, input.env, input.brand)) {
      const key = `${candidate.mode}:${candidate.componentId}`
      if (admitted.has(key)) continue
      let render: FreeFlexReport
      try { render = candidate.id.endsWith('/keep') ? baseline : await renderRecipeLibrary(input, [candidate]) }
      catch (e) { trials.push({ id: candidate.id, issues: [String(e)] }); continue }
      const issues = [...render.issues]
      // Preserve the surrounding composition, not just the source character set.
      for (const before of baseline.measurements.filter(m => m.kind !== 'text-measurement' && m.id !== node.id)) {
        const after = render.measurements.find(m => m.id === before.id)
        if (!after || (['x', 'y', 'width', 'height'] as const).some(k => Math.abs(before.box[k] - after.box[k]) > 1)) issues.push(`composition-changed:${before.id}`)
      }
      trials.push({ id: candidate.id, issues })
      if (issues.length) continue
      admitted.add(key); variants.push(candidate)
      options.push({ ...optionFor(candidate, input.env), preview: await crop(render.preview, box) })
    }
  }
  const tileW = 550, tileH = 365, columns = 3, canvas = document.createElement('canvas')
  canvas.width = tileW * columns; canvas.height = Math.ceil(options.length / columns) * tileH
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f4f3f8'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const [i, option] of options.entries()) {
    const x = (i % columns) * tileW, y = Math.floor(i / columns) * tileH
    ctx.fillStyle = '#19182a'; ctx.font = '18px sans-serif'; ctx.fillText(option.id, x + 12, y + 25, tileW - 24)
    ctx.font = '16px sans-serif'; ctx.fillText(option.family, x + 12, y + 48, tileW - 24)
    const img = new Image(); img.src = option.preview!; await img.decode()
    const scale = Math.min((tileW - 24) / img.width, (tileH - 65) / img.height)
    ctx.drawImage(img, x + 12, y + 58, img.width * scale, img.height * scale)
  }
  return { baseline, variants, options, trials, catalogPreview: canvas.toDataURL('image/png') }
}
