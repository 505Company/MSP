import { compileContentRecipe, initialRecipeSettings, validateContentRecipe, CONTENT_RECIPE_VERSION, type ContentRecipe, type RecipeBrand, type RecipeSettings } from '../lib/presentations/recipes/content-recipe'
import type { PixelEnvironment } from '../lib/presentations/pixel-contract'
import { renderFreeFlex, type FreeFlexReport } from './free-flex'

export type RecipeTrial = { settings: RecipeSettings; issues: string[]; warnings: string[]; planHash: string; elapsedMs: number }
const digest = async (v: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))))].map(b => b.toString(16).padStart(2, '0')).join('')

/** All changes are bounded recipe transitions. No LLM, content edits or fallback
 * to unbranded plain cards. Every failed candidate is retained as evidence. */
export async function renderContentRecipe(env: PixelEnvironment, raw: ContentRecipe, brand: RecipeBrand, fontCss = '') {
  const p = validateContentRecipe(raw, env, brand), trials: RecipeTrial[] = [], started = performance.now()
  const settings = initialRecipeSettings()
  let chosen: ReturnType<typeof compileContentRecipe> | undefined, render: FreeFlexReport | undefined
  let geometrySearchDone = false
  const geometryStates = p.recipe === 'headline' ? 1 : 3
  for (let round = 0; round < 24; round++) {
    const trialStarted = performance.now()
    chosen = compileContentRecipe(p, env, brand, settings)
    const planHash = await digest(chosen)
    render = await renderFreeFlex(env, chosen.plan, planHash, fontCss, chosen.surfaces)
    const issues = [...render.issues]
    const title = render.measurements.find(m => m.id === 'title' && m.kind === 'text-measurement')!
    // A content title may consume at most three lines; the headline family uses
    // the complete canvas and the existing 184/140 authored scale.
    if (p.recipe !== 'headline' && title.box.height > Math.min(280, title.fontSize! * 1.2 * 3) + 1) issues.push('title-budget:title')
    for (const m of render.measurements.filter(m => m.kind === 'text-measurement')) {
      if (m.fontSize! < (m.id === 'footer' ? 24 : p.recipe === 'headline' ? 48 : 32)) issues.push(`readability-floor:${m.id}`)
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
    trials.push({ settings: structuredClone(settings), planHash, issues, warnings: render.warnings, elapsedMs: Math.round(performance.now() - trialStarted) })
    if (!issues.length) break
    if (round === 23) break
    if (issues.includes('title-budget:title') && settings.titleStep < 3) { settings.titleStep++; continue }
    if (!geometrySearchDone) {
      if (settings.geometry < geometryStates - 1) { settings.geometry++; continue }
      if (!settings.compact) { settings.compact = true; settings.geometry = 0; continue }
      geometrySearchDone = true
      const best = trials.filter(t => t.settings.titleStep === settings.titleStep && t.settings.compact).sort((a, b) => a.issues.length - b.issues.length)[0]
      if (best.settings.geometry !== settings.geometry) { settings.geometry = best.settings.geometry; continue }
    }
    // Local field/cell failures shrink only that block. Container capacity or
    // title failures step down the heading before touching the body hierarchy.
    const ids = issues.flatMap(i => i.split(':').slice(1)), owners = new Set(ids.map(id => chosen!.ownership[id]).filter(Boolean))
    const local = [...owners].filter(id => !['root', 'body', 'title', 'metrics', 'audience', 'principles', 'evidence'].includes(id) && (settings.localSteps[id] ?? 0) < 2)
    if (local.length) for (const id of local) settings.localSteps[id] = (settings.localSteps[id] ?? 0) + 1
    else if (settings.titleStep < (p.recipe === 'headline' ? 1 : 3)) settings.titleStep++
    else {
      // If the whole content still overflows, descend one documented body step.
      const all = new Set(Object.values(chosen.ownership).filter(id => !['root', 'body', 'title', 'footer', 'metrics', 'audience', 'principles', 'evidence'].includes(id)))
      if ([...all].every(id => (settings.localSteps[id] ?? 0) >= 2)) break
      for (const id of all) settings.localSteps[id] = Math.min(2, (settings.localSteps[id] ?? 0) + 1)
    }
    // Keep the best width choice during local typography changes; geometry has
    // already been tried at larger type. No repeated widening/shrinking loop.
  }
  return { version: CONTENT_RECIPE_VERSION, recipe: p, brand, passed: !trials.at(-1)!.issues.length,
    trials, compiled: chosen!, render: render!, elapsedMs: Math.round(performance.now() - started), modelCalls: 0 as const }
}
