import { contentRecipeFixture } from './content-recipe'
import { familyById, frames, walk } from '../../lib/presentations/recipes/figma-catalog-v2/catalog'
import { FIGMA_RECIPE_VERSION, type FigmaRecipe } from '../../lib/presentations/recipes/figma-catalog-v2/contract'

export function figmaRecipeFixture(familyId = 'intro', index = 0) {
  const { env, brand } = contentRecipeFixture(), family = familyById(familyId)!, variant = family.variants[index]
  const lookup = new Map(walk(frames.find(f => f.id === variant.frame)!).map(n => [n.id, n]))
  env.input.content = Object.entries(variant.fields).map(([id, node]) => ({ id, text: lookup.get(node)!.text! }))
  const recipe: FigmaRecipe = { version: FIGMA_RECIPE_VERSION, recipe: 'figma', family: familyId,
    fields: env.input.content.map(f => ({ slot: f.id, refs: [{ fragmentId: f.id, start: 0, end: null }] })),
    panels: Object.keys(variant.panels).map(slot => ({ slot, componentId: 'native-metric' })),
    visuals: Object.keys(variant.visuals).map(slot => ({ slot, graphicId: 'fixture-graphic', fit: 'contain' })) }
  return { env, brand, recipe, variant }
}
