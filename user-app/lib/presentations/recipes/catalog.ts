import raw from './archive/accepted-10-v1/accepted-10-v1.json' with { type: 'json' }
import provenance from './archive/accepted-10-v1/provenance.json' with { type: 'json' }
import qualifiedOptions from './archive/accepted-10-v1/qualified-options.json' with { type: 'json' }
import { contentHash } from '../../design-system/catalog'

export type AcceptedRecipeVariant = {
  id: string; preview: string; dark: boolean; humanAcceptance: 'accepted'; evidence: string
  recipe: { id: string; name: string; variantId: string; intent: string; adaptation: string[]
    canvas: { width: number; height: number }; requiredResourceRoles: string[]; backgroundRole?: string
    capacity: Record<string, unknown>; designRules: Record<string, unknown>
    elements: Array<{ id: string; kind: string; slot?: string; resourceRole?: string; x: number; y: number; width: number; height: number
      fontSize?: number; fontStyle?: string; lineHeight?: number; maxLines?: number | number[]; maxChars?: number
      colorRole?: string; strokeRole?: string; strokeWidth?: number; endX?: number; endY?: number; opacity?: number
      shape?: string; radius?: number; cornerRadii?: number[]; align?: 'LEFT' | 'CENTER' | 'RIGHT'
      fit?: 'cover' | 'contain'; imageFit?: 'cover' | 'contain'; focusX?: number; focusY?: number
      after?: { target: string; axis: 'y'; gap: number }
      gradient?: { type: 'linear'; direction: 'horizontal' | 'vertical'; stops: { position: number; colorRole: string }[] } }>
  }
}
// Keep the full authored contract for Q4; Q3 reads the same definitions. The
// outer humanAcceptance records the user's decision, not the historical inner
// native/review statuses. Those do not claim web render verification.
const overrides = qualifiedOptions as unknown as Record<string, AcceptedRecipeVariant['recipe']>
export const acceptedVariants = (raw as unknown as { entries: AcceptedRecipeVariant[] }).entries.map(e => ({ ...e, recipe: overrides[e.id] ?? e.recipe }))
if (raw.version !== 'accepted-10-v1' || acceptedVariants.length !== 30 || new Set(acceptedVariants.map(e => e.id)).size !== 30 ||
    new Set(acceptedVariants.map(e => e.recipe.id)).size !== 10 || acceptedVariants.some(e => e.humanAcceptance !== 'accepted' || !/^[a-z0-9-]+\.png$/.test(e.preview))) {
  throw new Error('Нарушен принятый каталог рецептов')
}
const names = ['Мозаика показателей', 'Карточки кейсов', 'Разделённая обложка с карточкой', 'Редакционный тезис', 'Финал с двумя сценариями',
  'Тезис с цитатой', 'Центральный тезис', 'Четыре блока с контекстом', 'Пять строк преимуществ', 'Акцентная полоса и три преимущества']
export const recipeFamilies = [...new Set(acceptedVariants.map(e => e.recipe.id))].map((id, index) => ({ id, name: names[index],
  variants: acceptedVariants.filter(e => e.recipe.id === id) }))
export const recipeCatalogIdentity = () => contentHash({ definitions: raw, qualifiedOptions, names, provenance })
export const recipePreview = (entry: AcceptedRecipeVariant) => `/recipes/accepted-10-v1/${entry.preview}`
export function selectorCatalog() {
  return recipeFamilies.map(family => ({ id: family.id, name: family.name, variants: family.variants.map(({ id, dark, recipe: r }) => ({ id, name: r.name, option: r.variantId, dark,
    intent: r.intent, adaptation: r.adaptation, capacity: r.capacity, rules: r.designRules,
    slots: r.elements.filter(e => e.kind === 'text').map(({ slot, width, height, fontSize, fontStyle, maxLines, maxChars }) =>
      ({ slot, width, height, fontSize, fontStyle, maxLines, maxChars })) })) }))
}
