import { renderContentRecipe } from './content-recipe'
import { renderFigmaRecipe } from './figma-recipe'
import type { RecipeDirection } from '../lib/presentations/recipes/content-recipe-task'
import type { PixelEnvironment } from '../lib/presentations/pixel-contract'
import type { RecipeBrand } from '../lib/presentations/recipes/content-recipe'

export function renderSelectedRecipe(env: PixelEnvironment, recipe: RecipeDirection['selection'], brand: RecipeBrand, fontCss = '') {
  return recipe.recipe === 'figma' ? renderFigmaRecipe(env, recipe, brand, fontCss) : renderContentRecipe(env, recipe, brand, fontCss)
}
