import { z } from 'zod'
import { flexRefSchema, type FlexRef } from '../free-flex'
import { contentRecipeSchema, CONTENT_RECIPE_VERSION, type ContentRecipe } from './content-recipe'
import { figmaRecipeSchema, FIGMA_RECIPE_VERSION, type FigmaRecipe } from './figma-catalog-v2/contract'
import { figmaCatalog } from './figma-catalog-v2/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'

export const BINDINGS_VERSION = 'recipe-bindings-2'
/** A single JSON shape avoids provider grammar ambiguity across anyOf branches
 * with a shared title/footer prefix. Normalization never invents a binding. */
export const recipeBindingsSchema = z.object({
  version: z.literal(BINDINGS_VERSION),
  recipe: z.enum(['headline', 'metrics-list', 'audience-feature', 'principles-evidence', ...figmaCatalog.map(f => `figma/${f.id}`)]),
  fields: z.array(z.object({ slot: z.string().min(1), refs: z.array(flexRefSchema).min(1).max(100) }).strict()).min(1).max(50),
  panels: figmaRecipeSchema.shape.panels,
  visuals: figmaRecipeSchema.shape.visuals,
}).strict()
export const wireDirectionSchema = z.object({ decision: z.string().min(1).max(600), selection: recipeBindingsSchema }).strict()
export type RecipeBindings = z.infer<typeof recipeBindingsSchema>
const fail = (issue: string): never => { throw new SemanticValidationError([issue]) }

export function normalizeRecipeBindings(raw: RecipeBindings): ContentRecipe | FigmaRecipe {
  const p = recipeBindingsSchema.parse(raw)
  if (p.recipe.startsWith('figma/')) return figmaRecipeSchema.parse({ ...p, version: FIGMA_RECIPE_VERSION, recipe: 'figma', family: p.recipe.slice(6) })
  if (p.visuals.length) fail('content-adaptation-has-no-visual-slots')
  const fields = new Map(p.fields.map(f => [f.slot, f.refs])), panels = new Map(p.panels.map(p => [p.slot, p.componentId]))
  if (fields.size !== p.fields.length || panels.size !== p.panels.length) fail('duplicate-binding-slot')
  const take = (slot: string, optional = false): FlexRef[] => {
    const refs = fields.get(slot)
    if (!refs && !optional) fail(`required-binding:${slot}`)
    fields.delete(slot); return refs ?? []
  }
  const skin = (slot: string) => { const id = panels.get(slot); if (!id) return fail(`required-panel:${slot}`); panels.delete(slot); return id }
  const repeated = <T>(prefix: string, suffix: string, min: number, max: number, build: (s: string) => T): T[] => {
    const result: T[] = []
    for (let i = 1; i <= max; i++) if (fields.has(`${prefix}${i}.${suffix}`)) {
      if (result.length !== i - 1) fail(`binding-index-gap:${prefix}${i}`)
      result.push(build(`${prefix}${i}`))
    }
    if (result.length < min) fail(`binding-count:${prefix}:${min}-${max}`)
    return result
  }
  const pair = (id: string) => ({ value: take(`${id}.value`), caption: take(`${id}.caption`) })
  const metric = (id: string) => ({ componentId: skin(id), ...pair(id) })
  const list = () => ({ heading: take('list.heading'), items: repeated('list.item', 'text', 2, 8, id => take(`${id}.text`)) })
  const common = { version: CONTENT_RECIPE_VERSION, title: take('title'), footer: take('footer', true) } as const
  let recipe: ContentRecipe
  if (p.recipe === 'headline') recipe = { ...common, recipe: 'headline', support: take('support', true) }
  else if (p.recipe === 'metrics-list') recipe = { ...common, recipe: 'metrics-list', metrics: repeated('metric', 'value', 2, 4, metric), list: list() }
  else if (p.recipe === 'audience-feature') recipe = { ...common, recipe: 'audience-feature', metrics: repeated('metric', 'value', 2, 2, metric), list: list(),
    feature: { componentId: skin('feature'), heading: take('feature.heading'), metrics: repeated('feature.metric', 'value', 2, 4, pair) } }
  else if (p.recipe === 'principles-evidence') recipe = { ...common, recipe: 'principles-evidence',
    principles: repeated('principle', 'heading', 2, 5, id => ({ heading: take(`${id}.heading`), body: take(`${id}.body`) })),
    evidence: repeated('evidence', 'value', 1, 3, metric) }
  else return fail('unknown-content-adaptation')
  if (fields.size || panels.size) fail(`unconsumed-binding-slots:${[...fields.keys(), ...panels.keys()].join(',')}`)
  return contentRecipeSchema.parse(recipe)
}

export const adaptationBindings = {
  headline: { required: ['title'], optional: ['support', 'footer'], panels: [] },
  'metrics-list': { required: ['title', 'metric1..N.value', 'metric1..N.caption', 'list.heading', 'list.item1..N.text'], optional: ['footer'], panels: ['metric1..N'], counts: '2–4 metrics; 2–8 list items' },
  'audience-feature': { required: ['title', 'metric1.value', 'metric1.caption', 'metric2.value', 'metric2.caption', 'list.heading', 'list.item1..N.text', 'feature.heading', 'feature.metric1..N.value', 'feature.metric1..N.caption'], optional: ['footer'], panels: ['metric1', 'metric2', 'feature'], counts: 'exactly 2 general metrics; 2–8 list items; 2–4 feature metrics' },
  'principles-evidence': { required: ['title', 'principle1..N.heading', 'principle1..N.body', 'evidence1..N.value', 'evidence1..N.caption'], optional: ['footer'], panels: ['evidence1..N'], counts: '2–5 principles; 1–3 evidence metrics' },
}
