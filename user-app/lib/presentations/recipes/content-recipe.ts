import { z } from 'zod'
import { flexRefSchema, validateFreeFlex, FREE_FLEX_VERSION, type FlexRef, type FreeFlexNode, type FreeFlexPlan } from '../free-flex'
import { componentSlots } from '../adaptive-components'
import { sourceInk, type PixelEnvironment } from '../pixel-contract'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { stateById } from './layout-engine-v1/states'

export const CONTENT_RECIPE_VERSION = 'content-recipe-1'
const refs = z.array(flexRefSchema).min(1).max(100)
const metric = z.object({ componentId: z.string().min(1), value: refs, caption: refs }).strict()
const list = z.object({ heading: refs, items: z.array(refs).min(2).max(8) }).strict()
const common = { version: z.literal(CONTENT_RECIPE_VERSION), title: refs, footer: z.array(flexRefSchema).max(20) }
// This is the model-facing boundary. There is no CSS, arbitrary shape, raw text
// or coordinate field. The offline fixture exercises exactly the same boundary.
export const contentRecipeSchema = z.discriminatedUnion('recipe', [
  z.object({ ...common, recipe: z.literal('headline'), support: z.array(flexRefSchema).max(20) }).strict(),
  z.object({ ...common, recipe: z.literal('metrics-list'), metrics: z.array(metric).min(2).max(4), list }).strict(),
  z.object({ ...common, recipe: z.literal('audience-feature'), metrics: z.array(metric).length(2), list,
    feature: z.object({ componentId: z.string().min(1), heading: refs,
      metrics: z.array(z.object({ value: refs, caption: refs }).strict()).min(2).max(4) }).strict() }).strict(),
  z.object({ ...common, recipe: z.literal('principles-evidence'),
    principles: z.array(z.object({ heading: refs, body: refs }).strict()).min(2).max(5),
    evidence: z.array(metric).min(1).max(3) }).strict(),
])
export type ContentRecipe = z.infer<typeof contentRecipeSchema>
export type RecipeBrand = { headingFont: string; bodyFont: string; metricFont: string; background: string; headingColor: string; bodyColor: string }
export type LibrarySurface = { nodeId: string; componentId: string; adaptation: 'compound-metrics-1' }
export type RecipeSettings = { geometry: number; compact: boolean; titleStep: number; localSteps: Record<string, number> }
export const initialRecipeSettings = (): RecipeSettings => ({ geometry: 0, compact: false, titleStep: 0, localSteps: {} })
export const recipeSources = {
  headline: ['6:185', '1:2', '6:9', '6:18'],
  'metrics-list': ['19:209', '33:223', '21:700'],
  'audience-feature': ['19:209', '33:223', '21:645', '21:700'],
  'principles-evidence': ['19:209', '33:223', '21:527', '21:645'],
} as const

function metricTemplate(id: string, env: PixelEnvironment) {
  const t = env.input.components.find(t => t.id === id), p = env.input.componentFlows?.[id]
  const slots = t && componentSlots(t)
  if (!t || !p || slots?.length !== 2 || slots.filter(s => s.metric).length !== 1) throw new SemanticValidationError([`qualified-metric-component-required:${id}`])
  return { template: t, profile: p, slots }
}
export function recipeComponents(p: ContentRecipe) {
  return p.recipe === 'headline' ? [] : p.recipe === 'principles-evidence' ? p.evidence.map(m => m.componentId)
    : [...p.metrics.map(m => m.componentId), ...(p.recipe === 'audience-feature' ? [p.feature.componentId] : [])]
}
export function validateContentRecipe(raw: unknown, env: PixelEnvironment, brand: RecipeBrand): ContentRecipe {
  const result = contentRecipeSchema.safeParse(raw)
  if (!result.success) throw new SemanticValidationError(result.error.issues.map(i => `${i.path.join('.')}:${i.message}`))
  const p = result.data
  for (const id of recipeComponents(p)) metricTemplate(id, env)
  for (const token of [brand.headingFont, brand.metricFont, brand.bodyFont]) if (!env.fontTokens.includes(token)) throw new SemanticValidationError([`recipe-font-unavailable:${token}`])
  for (const color of [brand.background, brand.headingColor, brand.bodyColor]) if (!env.input.colors.some(c => c.id === color || c.hex.toLowerCase() === color.toLowerCase())) throw new SemanticValidationError([`recipe-palette-unavailable:${color}`])
  // Reuse exact character coverage, component-field and tree validation.
  validateFreeFlex(compileContentRecipe(p, env, brand, initialRecipeSettings()).plan, env)
  return p
}

export function compileContentRecipe(p: ContentRecipe, env: PixelEnvironment, brand: RecipeBrand, settings: RecipeSettings) {
  const nodes: FreeFlexNode[] = [], surfaces: LibrarySurface[] = [], ownership: Record<string, string> = {}, insets: Record<string, number> = {}
  const gap = settings.compact ? 24 : 40
  const step = (owner: string) => Math.min(2, settings.localSteps[owner] ?? 0)
  const size = (owner: string, values: number[]) => values[step(owner)]
  const add = (n: FreeFlexNode, owner = n.id) => { nodes.push(n); ownership[n.id] = owner; return n.id }
  const group = (id: string, parent: string | null, css: string, owner = id) => add({ id, parent, kind: 'flex', css, refs: [], component: null }, owner)
  const text = (id: string, parent: string, r: FlexRef[], px: number, font = brand.bodyFont, color = brand.bodyColor, css = '', owner = id, role: 'body' | 'heading' | 'metric' = 'body') =>
    add({ id, parent, kind: 'text', css: `font-family:${font};font-size:${px}px;line-height:${role === 'body' ? 1.4 : 1.2};color:${color};${css}`, refs: r, component: null }, owner)
  const card = (id: string, parent: string, m: z.infer<typeof metric>, css = '', horizontal = false, owner = id) => {
    const { slots, profile } = metricTemplate(m.componentId, env)
    const isRow = horizontal && settings.geometry !== 2
    const pad = settings.compact ? 32 : Math.round(profile.padding)
    const fields = slots.map(s => ({ path: s.metric ? 'value' : s.paths[0], refs: s.metric ? m.value : m.caption,
      css: `font-family:${s.metric ? brand.metricFont : brand.bodyFont};font-size:${size(owner, s.metric ? [128, 112, 96] : [36, 34, 32])}px;line-height:${s.metric ? 1.2 : 1.4};${isRow ? `flex:${s.metric ? '0 0 46%' : '1 1 0'};` : ''}` }))
    const n: FreeFlexNode = { id, parent, kind: 'component', refs: [], component: { id: m.componentId, mode: 'free-flow', fields },
      css: `flex-direction:${isRow ? 'row' : 'column'};align-items:${isRow ? 'center' : 'stretch'};justify-content:center;padding:${pad}px;gap:${settings.compact ? 16 : 24}px;${css}` }
    add(n, owner); for (const f of fields) ownership[`${id}:${f.path}`] = owner
    insets[id] = pad
  }
  const listBlock = (id: string, parent: string, data: z.infer<typeof list>, css = '') => {
    group(id, parent, `flex-direction:column;gap:${gap}px;${css}`)
    text(`${id}-heading`, id, data.heading, size(id, [48, 44, 40]), brand.headingFont, brand.headingColor, '', id, 'heading')
    group(`${id}-items`, id, `flex-direction:column;gap:${settings.compact ? 14 : 22}px;`, id)
    data.items.forEach((r, i) => text(`${id}-item-${i}`, `${id}-items`, r, size(id, [40, 36, 32]), brand.bodyFont, brand.bodyColor, '', id))
  }
  group('root', null, `width:1920px;height:1080px;flex-direction:column;padding:48px 64px;background-color:${brand.background};gap:${gap}px;`)
  if (p.recipe === 'headline') {
    // Existing authored title sizes are the source of this family, not a new ramp.
    const sizes = [stateById('title-1')!.primary.fontSize!, stateById('title-extreme')!.primary.fontSize!]
    nodes[0].css += 'justify-content:flex-end;'
    text('title', 'root', p.title, sizes[Math.min(1, settings.titleStep)], brand.headingFont, brand.headingColor, '', 'title', 'heading')
    if (p.support.length) text('support', 'root', p.support, size('support', [64, 56, 48]), brand.bodyFont, brand.bodyColor)
  } else {
    text('title', 'root', p.title, [96, 88, 80, 72][Math.min(3, settings.titleStep)], brand.headingFont, brand.headingColor, '', 'title', 'heading')
    group('body', 'root', `flex:1 1 0;flex-direction:row;gap:${gap}px;align-items:stretch;`)
    if (p.recipe === 'metrics-list') {
      const ratios = [[1.4, 1], [1.2, 1], [1.6, 1]][settings.geometry]
      group('metrics', 'body', `flex:${ratios[0]} 1 0;flex-direction:column;gap:24px;justify-content:center;`)
      p.metrics.forEach((m, i) => card(`metric-${i}`, 'metrics', m, 'flex:1 1 0;', true))
      listBlock('list', 'body', p.list, `flex:${ratios[1]} 1 0;justify-content:center;`)
    } else if (p.recipe === 'audience-feature') {
      const ratios = [[1.7, 1], [1.45, 1], [1.9, 1]][settings.geometry]
      group('audience', 'body', `flex:${ratios[0]} 1 0;flex-direction:column;gap:${gap}px;`)
      group('metrics', 'audience', 'flex-direction:row;gap:24px;')
      p.metrics.forEach((m, i) => card(`metric-${i}`, 'metrics', m, 'flex:1 1 0;'))
      listBlock('list', 'audience', p.list, 'flex:1 1 0;justify-content:flex-end;')
      // An explicit new compound execution, not a claimed native seven-slot card.
      // Reuses the qualified component's artwork and exact field inks, allowing
      // heading + repeated value/caption fields under a fixed recipe contract.
      const { template, profile } = metricTemplate(p.feature.componentId, env)
      group('feature', 'body', `flex:${ratios[1]} 1 0;flex-direction:column;gap:${gap}px;padding:${settings.compact ? 32 : Math.round(profile.padding)}px;justify-content:space-between;`)
      surfaces.push({ nodeId: 'feature', componentId: template.id, adaptation: 'compound-metrics-1' })
      insets.feature = settings.compact ? 32 : Math.round(profile.padding)
      const valueInk = sourceInk(template, profile.metric, env.input).color, captionInk = sourceInk(template, profile.caption, env.input).color
      text('feature-heading', 'feature', p.feature.heading, size('feature', [36, 34, 32]), brand.headingFont, captionInk, '', 'feature', 'heading')
      p.feature.metrics.forEach((m, i) => {
        const id = `feature-metric-${i}`; group(id, 'feature', 'flex-direction:column;gap:8px;', 'feature')
        text(`${id}-value`, id, m.value, size('feature', [96, 88, 80]), brand.metricFont, valueInk, '', 'feature', 'metric')
        text(`${id}-caption`, id, m.caption, size('feature', [36, 34, 32]), brand.bodyFont, captionInk, '', 'feature')
      })
    } else {
      const ratios = [[1.65, 1], [1.4, 1], [1.9, 1]][settings.geometry]
      group('principles', 'body', `flex:${ratios[0]} 1 0;flex-direction:column;gap:${gap}px;justify-content:center;`)
      p.principles.forEach((v, i) => {
        const id = `principle-${i}`; group(id, 'principles', 'flex-direction:column;gap:16px;')
        text(`${id}-heading`, id, v.heading, size(id, [48, 44, 40]), brand.headingFont, brand.headingColor, '', id, 'heading')
        text(`${id}-body`, id, v.body, size(id, [40, 36, 32]), brand.bodyFont, brand.bodyColor, '', id)
      })
      group('evidence', 'body', `flex:${ratios[1]} 1 0;flex-direction:column;gap:24px;justify-content:center;`)
      p.evidence.forEach((m, i) => card(`evidence-${i}`, 'evidence', m, 'flex:1 1 0;'))
    }
  }
  if (p.footer.length) text('footer', 'root', p.footer, 24)
  const plan: FreeFlexPlan = { version: FREE_FLEX_VERSION, rationale: `Fixed recipe ${p.recipe}; source Figma ${recipeSources[p.recipe].join(', ')}; library bindings are mandatory.`,
    emphasis: [{ fragmentId: p.title[0].fragmentId, importance: 1, reason: 'Главный тезис; масштаб задаёт проверяемый рецепт.' }], nodes }
  return { plan, surfaces, ownership, insets }
}
