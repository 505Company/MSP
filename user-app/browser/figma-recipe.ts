import { compileFigmaRecipe, eligibleVariants, validateFigmaRecipe, FIGMA_RECIPE_VERSION, type FigmaRecipe, type FigmaSettings } from '../lib/presentations/recipes/figma-catalog-v2/contract'
import type { RecipeVariant } from '../lib/presentations/recipes/figma-catalog-v2/catalog'
import type { RecipeBrand } from '../lib/presentations/recipes/content-recipe'
import type { PixelEnvironment } from '../lib/presentations/pixel-contract'
import { layoutGraphics } from './layout-execution'
import { renderFreeFlex, type FreeFlexReport } from './free-flex'
const digest = async (v: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))))].map(b => b.toString(16).padStart(2, '0')).join('')

export async function renderFigmaRecipe(env: PixelEnvironment, raw: FigmaRecipe, brand: RecipeBrand, fontCss = '', exactVariant?: RecipeVariant) {
  const p = validateFigmaRecipe(raw, env, brand), started = performance.now()
  const graphics = await layoutGraphics(env.input, { visuals: p.visuals.map(v => ({ id: v.graphicId, fit: v.fit, reason: 'Bound recipe visual' })), connectorId: null } as Parameters<typeof layoutGraphics>[1])
  for (const v of p.visuals) if (!graphics[v.graphicId]) throw Error(`recipe-graphic-unrenderable:${v.graphicId}`)
  const variants = exactVariant ? [exactVariant] : eligibleVariants(p)
  const trials: { settings: FigmaSettings; sourceFrame: string; issues: string[]; warnings: string[]; planHash: string; elapsedMs: number }[] = []
  let chosen: ReturnType<typeof compileFigmaRecipe> | undefined, render: FreeFlexReport | undefined
  // Geometry variants first, then local type steps. All failed transitions are
  // recorded; no truncation, arbitrary text editing or model-independent rebinding.
  for (let pass = 0; pass < 5; pass++) {
    for (let variant = 0; variant < variants.length; variant++) {
      const t = performance.now(), steps: Record<string, number> = {}
      if (pass >= 2) for (const f of p.fields) steps[f.slot] = pass - 1
      const settings = { variant, compact: pass > 0, steps }
      chosen = compileFigmaRecipe(p, env, brand, settings, exactVariant)
      const planHash = await digest(chosen)
      render = await renderFreeFlex(env, chosen.plan, planHash, fontCss, chosen.surfaces, chosen.visuals.map(v => ({ ...v, dataUrl: graphics[v.graphicId] })))
      const issues = [...render.issues]
      for (const m of render.measurements.filter(m => m.kind === 'text-measurement')) {
        if (m.fontSize! < chosen.floors[m.id]) issues.push(`readability-floor:${m.id}`)
        let ancestor = m.parent
        while (ancestor) {
          const padding = chosen.insets[ancestor]
          if (padding) {
            const b = render.measurements.find(b => b.id === ancestor && b.kind !== 'text-measurement')!.box
            if (m.ink?.some(i => i.x < b.x + padding - 1 || i.y < b.y + padding - 1 || i.x + i.width > b.x + b.width - padding + 1 || i.y + i.height > b.y + b.height - padding + 1)) issues.push(`component-inset:${ancestor}:${m.id}`)
          }
          ancestor = chosen.plan.nodes.find(n => n.id === ancestor)?.parent ?? null
        }
      }
      trials.push({ settings, sourceFrame: chosen.sourceFrame, issues: [...new Set(issues)], warnings: render.warnings, planHash, elapsedMs: Math.round(performance.now() - t) })
      if (!issues.length) return { version: FIGMA_RECIPE_VERSION, recipe: p, brand, passed: true, trials, compiled: chosen, render, elapsedMs: Math.round(performance.now() - started), modelCalls: 0 as const }
    }
  }
  return { version: FIGMA_RECIPE_VERSION, recipe: p, brand, passed: false, trials, compiled: chosen!, render: render!, elapsedMs: Math.round(performance.now() - started), modelCalls: 0 as const }
}
