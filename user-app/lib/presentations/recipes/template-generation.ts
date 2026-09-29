import { contentHash } from '../../design-system/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import type { VisualManifest } from '../../digital-designer/visual-package'
import type { LayoutInput } from '../layout-contract'
import { resolveLibraryPlan, type LibraryResolution, type RecipeSnapshot } from './library-selection'
import { TEMPLATE_RENDER_VERSION, type TemplateRenderReport } from './template-measurement'
import type { TemplateRecipe } from './template-contract'
import type { RecipeMaterial } from './pilot-cases'
import type { TemplatePlan } from './template-plan'

export type TemplateGenerationPlan = { recipe: TemplateRecipe; material: RecipeMaterial; plan: TemplatePlan }
export type TemplateGenerationRender = { planHash: string; report: TemplateRenderReport }
export const templateRenderKey = (prefix: string) => `${prefix}/render-${TEMPLATE_RENDER_VERSION}.json`
export const templateReviewPrefix = (prefix: string) => `${prefix}/review-${TEMPLATE_RENDER_VERSION}`
export async function templateGenerationPlan(saved: Extract<LibraryResolution, { kind: 'library-template' }>, snapshot: RecipeSnapshot | null, input: LayoutInput): Promise<TemplateGenerationPlan> {
  if (!snapshot) throw new SemanticValidationError(['missing-recipe-snapshot'])
  const result = resolveLibraryPlan({ recipeId: saved.recipeId, recipeVersion: saved.recipeVersion, itemCount: saved.material.itemCount, plan: saved.plan, reason: 'Revalidation' }, snapshot, input, { fontTokens: [] })
  if (result.kind !== 'library-template' || await contentHash(result.material) !== await contentHash(saved.material)) throw new SemanticValidationError(['stale-template-material'])
  return { recipe: snapshot.recipes.find(r => r.entry.id === saved.recipeId && r.entry.version === saved.recipeVersion)!.bundle.recipe, material: result.material, plan: result.plan }
}
export async function templateSourcePreview(bucket: R2Bucket, recipe: TemplateRecipe) {
  const uploadId = recipe.passport.origin.uploadId!, slideId = recipe.proposal.slideId
  const manifest = await (await bucket.get(`visual/${uploadId}/manifest.json`))?.json<VisualManifest>()
  const ref = manifest?.previews.find(p => p.id === slideId), file = await bucket.get(`visual/${uploadId}/preview-${slideId}`)
  if (!ref || !file || !['image/png', 'image/jpeg'].includes(ref.mime)) throw new SemanticValidationError(['missing-recipe-source-preview'])
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > 2_500_000) throw new SemanticValidationError(['recipe-source-preview-too-large'])
  return `data:${ref.mime};base64,${Buffer.from(bytes).toString('base64')}`
}
