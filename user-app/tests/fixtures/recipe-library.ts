import { compileTemplateRecipe, type TemplateRecipe } from '../../lib/presentations/recipes/template-contract'
import { contentHash } from '../../lib/design-system/catalog'
import { readRecipeRegistry, registerRecipeVersion, decideRecipe } from '../../lib/presentations/recipes/library'
import { templateRecipeFixture } from './template-recipe'
import { memoryBucket } from '../helpers/memory-bucket'
import { layoutInput } from './layout'
import { createProject, addBankStyle } from '../../lib/workspace/storage'
import type { LayoutContext } from '../../lib/presentations/layout-context'
import type { RecipeMaterial } from '../../lib/presentations/recipes/pilot-cases'
import type { TemplatePlan } from '../../lib/presentations/recipes/template-plan'
import type { TemplateRenderReport } from '../../lib/presentations/recipes/template-measurement'

export async function libraryFixture() {
  const store = memoryBucket(), source = templateRecipeFixture(), input = layoutInput()
  input.content = structuredClone(source.material.fragments)
  const recipe = await compileTemplateRecipe(source.proposal, source.snapshot, input.uploadId, 'synthetic-extraction')
  await store.bucket.put(`visual/${input.uploadId}/manifest.json`, JSON.stringify({ snapshot: source.snapshot, previews: [{ id: 's01', mime: 'image/png' }] }))
  await store.bucket.put(`visual/${input.uploadId}/preview-s01`, new Uint8Array([1, 2, 3]))
  const style = { id: input.uploadId, name: 'Synthetic recipe style', fileName: 'fixture.pptx', sourceId: source.snapshot.sourceId, createdAt: new Date().toISOString(), slideCount: 1, componentCount: 0, styleCount: 1, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Recipe tests only', uploadId: style.id, text: 'Synthetic material' }, style)
  const context: LayoutContext = { projectId: project.id, uploadId: input.uploadId, sourceRevision: project.revision, materialId: 'material', inputId: 'b'.repeat(64), prefix: `presentation-layouts/${project.id}/fixture`, inputs: [input] }
  const register = async (candidate = recipe, technical: 'passed' | 'failed' = 'passed') => {
    const root = `recipe-pilots/${input.uploadId}/synthetic/${candidate.passport.version}`
    await store.bucket.put(`${root}/receipt.json`, JSON.stringify({ recipeVersion: candidate.passport.version, sourceHash: candidate.sourceSnapshotHash, technical, scope: 'synthetic-protocol-test-not-visual-evidence' }))
    await store.bucket.put(`${root}/evidence.json`, JSON.stringify({ test: true }))
    return registerRecipeVersion(store.bucket, candidate, `${root}/receipt.json`, [`${root}/evidence.json`], (await readRecipeRegistry(store.bucket, input.uploadId)).revision)
  }
  const decide = async (action: 'accept' | 'reject' | 'enable' | 'disable', candidate = recipe) => decideRecipe(store.bucket, input.uploadId, {
    action, expectedRevision: (await readRecipeRegistry(store.bucket, input.uploadId)).revision, recipeId: candidate.passport.id, version: candidate.passport.version, reason: 'Synthetic test decision, never user acceptance',
  })
  return { ...store, source, recipe, input, project, context, register, decide,
    reply: { recipeId: recipe.passport.id, recipeVersion: recipe.passport.version, itemCount: 4, plan: source.plan, reason: 'Synthetic provider response' } }
}

/** Protocol fixture only. Browser tests supply real native-renderer pixels. */
export async function protocolReport(recipe: TemplateRecipe, material: RecipeMaterial, plan: TemplatePlan, passed = true): Promise<TemplateRenderReport> {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  bytes.writeUInt32BE(1024, 16); bytes.writeUInt32BE(576, 20)
  const stateId = passed ? 'observed' : recipe.passport.states.at(-1)!.id, issues = passed ? [] : ['overflow:body-1']
  return { recipeVersion: recipe.passport.version, materialHash: await contentHash(material), stateId, passed, issues, fontWarnings: [],
    trials: passed ? [{ stateId, issues }] : recipe.passport.states.map(s => ({ stateId: s.id, issues })),
    measurements: plan.bindings.map(b => ({ sourceId: b.sourceId, text: b.fragments.map(id => material.fragments.find(f => f.id === id)!.text).join('\n'),
      fontSize: b.sourceId === 'primary' ? 36 : b.sourceId.startsWith('note-') ? 18 : 22, box: recipe.stateBounds[stateId][b.sourceId], ink: { left: 0, top: 0, right: 100, bottom: 20 }, pixels: 100 })),
    preview: `data:image/png;base64,${bytes.toString('base64')}` }
}
