import { z } from 'zod'
import type { AcceptedRecipeVariant } from './recipes/catalog'
import type { RecipeBrand } from './recipe-brand'
import type { ComponentDefinition } from '../design-system/types'
import { SemanticValidationError } from '../design-system/semantic-contract'

export const DECK_VERSION = 'web-deck-7'
export const DECK_RENDERER = 'web-deck-renderer-3'
export const MAX_SCENE_ATTEMPTS = 3
export type RecipeElement = AcceptedRecipeVariant['recipe']['elements'][number]
export function textOffsetLimit(recipeId: string, slot: RecipeElement) {
  return slot.after || recipeId === 'minimal-center-38' || recipeId === 'advantage-rows-53' ? 0 : 96
}
export type SceneContent = { id: string; text: string; kind: string; role: string; blockId?: string }
export type SceneInput = {
  slideId: string; title: string; content: SceneContent[]; directions: string[]
  variant: AcceptedRecipeVariant; brand: RecipeBrand; resources: ComponentDefinition[]
}
const name = z.string().min(1).max(160), hex = z.string().regex(/^#[A-Fa-f0-9]{6}$/)
export const sceneSchema = z.object({
  variantId: name, fontFamily: name, background: hex,
  colors: z.array(z.object({ role: name, hex }).strict()).min(1).max(24),
  resources: z.array(z.object({ role: name, componentId: name }).strict()).max(12),
  texts: z.array(z.object({ id: name, yOffset: z.number().finite().min(-96).max(96),
    separator: z.enum(['space', 'newline']),
    parts: z.array(z.object({ fragmentId: name, start: z.number().int().min(0), end: z.number().int().min(1) }).strict()).min(1).max(100),
  }).strict()).min(1).max(80),
  designRationale: z.string().min(1).max(1000),
}).strict()
export type BoundScene = z.infer<typeof sceneSchema>
export type TextMeasurement = { id: string; x: number; y: number; width: number; height: number; lines: number }
export type DeckIssue = { code: string; elementId?: string; message: string; alternatives?: string[] }
export type DeckReport = { renderer: typeof DECK_RENDERER; sceneHash: string; texts: TextMeasurement[]; issues: DeckIssue[] }
export type DeckEvidence = { renderer: typeof DECK_RENDERER; fonts: string[]; resourceIds: string[]; sheet: string | null }
export type RenderedDeckSlide = { report: DeckReport; preview: string; component: ComponentDefinition }
export class SceneValidationError extends SemanticValidationError {
  constructor(issues: string[]) { super(issues); this.message = 'Не удалось разместить всё содержание в выбранном оформлении. Исходный текст сохранён.' }
}
export function supportsRecipeRole(resource: RecipeBrand['resources'][number] | undefined, role: string) {
  const use = role === 'panel' || role === 'circle' ? role : 'art'
  return Boolean(resource?.uses.includes(use) && (use !== 'art' || Math.min(resource.width, resource.height) >= 100))
}
export function boundText(text: BoundScene['texts'][number], input: SceneInput) {
  return text.parts.map(p => input.content.find(f => f.id === p.fragmentId)!.text.slice(p.start, p.end)).join(text.separator === 'space' ? ' ' : '\n')
}
export function slotContent(slotId: string, input: SceneInput) {
  if (['badge', 'label', 'eyebrow'].includes(slotId)) return input.content.filter(c => c.kind === 'badge')
  if (/^number\d+$/.test(slotId)) return [] // No fabricated list numerals.
  const heading = input.content.filter(c => c.kind === 'heading')
  if (['title', 'heading'].includes(slotId) && heading.length) return heading
  if (input.variant.recipe.id === 'editorial-insight-04') {
    // Q2 has already determined the ordered semantic blocks. A marked argument
    // cannot steal another argument's source or duplicate it into an intro.
    const prose = input.content.filter(c => c.kind !== 'heading' && !['badge', 'cta', 'hub'].includes(c.kind))
    const groups = [...new Set(prose.map(c => c.blockId ?? c.id))].map(id => prose.filter(c => (c.blockId ?? c.id) === id))
    const count = input.variant.recipe.elements.filter(e => /^point\d+$/.test(e.id)).length
    const primary = groups.filter(g => g[0].role === 'primary'), arguments_ = (primary.length >= count ? primary : groups).slice(0, count)
    if (/^point\d+$/.test(slotId)) return arguments_[Number(slotId.slice(5)) - 1] ?? []
    if (['body', 'footer'].includes(slotId)) return input.content.filter(c => c.kind !== 'heading' && !arguments_.some(g => g.includes(c)))
  }
  return input.content.filter(c => c.kind !== 'heading' || /^(leftTitle|rightTitle)$/.test(slotId))
}
/** Omitted optional text removes its complete decorative module. */
export function activeRecipeElements(scene: BoundScene, input: SceneInput) {
  const present = new Set(scene.texts.map(t => t.id))
  const optional: Record<string, string> = { 'footer-rule': input.variant.recipe.id === 'dense-four-context-24' ? 'note' : 'footer',
    badgePanel: 'badge', 'cta-bg': 'cta', leftActionPanel: 'leftAction', rightActionPanel: 'rightAction',
    'footer-circle': 'footer-label', 'footer-arrow': 'footer-label', 'footer-arrow-up': 'footer-label', 'footer-arrow-down': 'footer-label' }
  return input.variant.recipe.elements.filter(e => e.kind === 'text' ? present.has(e.id) : !optional[e.id] || present.has(optional[e.id]))
}
export function validateScene(raw: unknown, input: SceneInput, evidence: DeckEvidence): BoundScene {
  const parsed = sceneSchema.safeParse(raw)
  if (!parsed.success) throw new SceneValidationError(parsed.error.issues.slice(0, 12).map(i => `${i.path.join('.')}: ${i.message}`))
  const scene = parsed.data, issues: string[] = [], recipe = input.variant.recipe
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) issues.push(`duplicate-${label}`) }
  unique(scene.texts.map(t => t.id), 'text'); unique(scene.colors.map(c => c.role), 'color-role'); unique(scene.resources.map(r => r.role), 'resource-role')
  if (scene.variantId !== input.variant.id) issues.push('wrong-variant')
  if (!input.brand.tokens.fonts.some(f => f.family === scene.fontFamily) || !evidence.fonts.includes(scene.fontFamily)) issues.push('font-not-available')
  const palette = new Set(input.brand.tokens.colors.map(c => c.hex.toUpperCase()))
  if ([scene.background, ...scene.colors.map(c => c.hex)].some(c => !palette.has(c.toUpperCase()))) issues.push('color-outside-brand-palette')
  const intervals = new Map(input.content.map(c => [c.id, [] as { start: number; end: number }[]]))
  for (const text of scene.texts) {
    const slot = recipe.elements.find(e => e.id === text.id && e.kind === 'text')
    if (!slot) { issues.push(`unknown-text-slot:${text.id}`); continue }
    const eligible = new Set(slotContent(text.id, input).map(c => c.id))
    for (const part of text.parts) {
      if (!eligible.has(part.fragmentId)) issues.push(`incompatible-slot-content:${text.id}:${part.fragmentId}`)
      const original = input.content.find(c => c.id === part.fragmentId)
      if (!original || part.end > original.text.length || part.start >= part.end) issues.push(`invalid-content-range:${text.id}:${part.fragmentId}`)
      else {
        // No cuts inside a word or UTF-16 surrogate pair. Whitespace belongs to the source too.
        for (const at of [part.start, part.end]) if (at > 0 && at < original.text.length) {
          const left = original.text[at - 1], right = original.text[at]
          if (/[\p{L}\p{N}]/u.test(left) && /[\p{L}\p{N}]/u.test(right) || /[\uD800-\uDBFF]/.test(left) && /[\uDC00-\uDFFF]/.test(right) || /[\p{M}\u200D\uFE0F]/u.test(right) || left === '\u200D') issues.push(`word-or-glyph-split:${text.id}:${part.fragmentId}:${at}`)
        }
        intervals.get(part.fragmentId)!.push(part)
      }
    }
    if (text.yOffset && !textOffsetLimit(recipe.id, slot)) issues.push(`fixed-alignment:${text.id}:yOffset-must-be-0`)
  }
  for (const c of input.content) {
    let cursor = 0
    for (const p of intervals.get(c.id)!) { if (p.start !== cursor) issues.push(`content-gap-or-duplicate:${c.id}:${cursor}. Фрагмент «${c.text.slice(0, 100)}» должен появиться один раз. Сейчас диапазон ${p.start}–${p.end} идёт после ${cursor}; исправь пропуск или повтор.`); cursor = p.end }
    if (cursor !== c.text.length) issues.push(`content-not-complete:${c.id}:${cursor}/${c.text.length}`)
    if (c.kind === 'heading' && scene.texts.some(t => t.parts.some(p => p.fragmentId === c.id) && !/^(title|heading|leftTitle|rightTitle)$/.test(t.id))) issues.push(`heading-must-use-title-slot:${c.id}`)
  }
  for (const text of scene.texts) {
    if (text.id === 'badge' && text.parts.some(p => input.content.find(c => c.id === p.fragmentId)?.kind !== 'badge')) issues.push('badge-requires-explicit-badge-content:use-subtitle-for-supporting-prose')
    if (text.parts.every(p => input.content.find(c => c.id === p.fragmentId)?.text.slice(p.start, p.end).trim() === '')) issues.push(`empty-text:${text.id}`)
  }
  // Defining modules cannot be deleted to make an incompatible recipe pass.
  const required = recipe.elements.filter(e => e.kind === 'text' && /^(title|heading|leftTitle|rightTitle|quote|point\d+|question-\d+|item\d+|heading\d+|a-value|b-value|value-\d+)$/.test(e.id))
  for (const e of required) if (!scene.texts.some(t => t.id === e.id)) issues.push(`missing-required-slot:${e.id}`)
  for (const binding of scene.resources) if (!input.resources.some(r => r.id === binding.componentId) || !evidence.resourceIds.includes(binding.componentId) || !recipe.elements.some(e => e.resourceRole === binding.role)) issues.push(`unknown-resource-binding:${binding.role}`)
  const elements = activeRecipeElements(scene, input), colors = new Set(scene.colors.map(c => c.role))
  for (const e of elements) {
    for (const role of [e.colorRole, e.strokeRole, ...e.gradient?.stops.map(s => s.colorRole) ?? []].filter(Boolean) as string[]) if (!colors.has(role)) issues.push(`missing-color-role:${role}`)
    if (!e.resourceRole) continue
    const binding = scene.resources.find(r => r.role === e.resourceRole), resource = input.brand.resources.find(r => r.id === binding?.componentId)
    if (!resource || !supportsRecipeRole(resource, e.resourceRole) || !evidence.resourceIds.includes(resource.id) || !input.resources.some(r => r.id === resource.id)) issues.push(`unavailable-resource:${e.resourceRole}`)
  }
  if (issues.length) throw new SceneValidationError([...new Set(issues)])
  return scene
}
