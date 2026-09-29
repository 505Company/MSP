import { memoryBucket } from '../helpers/memory-bucket'
import { templateRecipeFixture } from './template-recipe'
import { sourceText } from './native-layout'
import { contentHash } from '../../lib/design-system/catalog'
import type { TemplateRecipe } from '../../lib/presentations/recipes/template-contract'
import type { TemplatePlan } from '../../lib/presentations/recipes/template-plan'
import type { RecipeMaterial } from '../../lib/presentations/recipes/pilot-cases'
import type { TemplateRenderReport } from '../../lib/presentations/recipes/template-measurement'
import type { DiscoveryAdvance } from '../../lib/presentations/recipes/discovery-workflow'
import { protocolReport } from './recipe-library'
import type { ElementIR } from '../../vendor/drag/src/core/model'
import { comparisonFixture } from './template-comparison'

export const discoveryConfig = { apiKey: 'test-only', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
export const providerReply = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }))
export async function discoveryFixture(profile: 'repeated-text' | 'paired-percent' = 'repeated-text') {
  const paired = profile === 'paired-percent' ? await comparisonFixture() : null
  const store = memoryBucket(), source = paired ?? templateRecipeFixture(), uploadId = crypto.randomUUID()
  source.snapshot.elements.push(sourceText('context', 'Исходный контекст', 30, 90, 1140, 40, 22, 'Play'))
  source.proposal.slots.push({ sourceId: 'context', role: 'context', item: 0, optional: true, ownerId: null })
  const visual = { snapshot: source.snapshot, assets: [], previews: [{ id: 's01', mime: 'image/png' }] }
  await store.bucket.put(`visual/${uploadId}/manifest.json`, JSON.stringify(visual))
  await store.bucket.put(`visual/${uploadId}/preview-s01`, new Uint8Array([1, 2, 3]))
  let calls = 0
  const fetchModel = async (_url: unknown, init?: RequestInit) => {
    calls++
    const body = JSON.parse(init!.body as string), name = body.response_format.json_schema.name
    if (name === 'recipe_discovery_extraction_v2') return providerReply({ profile, proposal: source.proposal, reason: 'Synthetic transport fixture, not a visual acceptance' })
    if (name === 'template_recipe_binding') {
      const { slots, material } = JSON.parse(body.messages[1].content) as { slots: TemplateRecipe['slots']; material: RecipeMaterial }
      const bindings = material.fragments.map(f => {
        const role = f.id === 'f-title' ? 'primary' : f.id === 'f-context' ? 'context' : f.id.split('-').at(-1)!
        const item = ['primary', 'context'].includes(role) ? 0 : Number(f.id.split('-')[1])
        return { sourceId: role === 'current' || role === 'previous' ? `value-${item}-${role === 'current' ? 0 : 1}` : slots.find(s => s.role === role && s.item === item)!.sourceId, fragments: [f.id] }
      })
      return providerReply({ bindings, rationale: 'Synthetic model binding' } satisfies TemplatePlan)
    }
    if (name === 'template_recipe_review') return providerReply({ verdict: 'pass', issues: [] })
    if (name === 'template_paired_percent_recipe_v2' && paired) return providerReply({ encoding: 'equal-badges', layout: 'source-rows', pairs: paired.comparison.pairs, graphics: [], rationale: 'Synthetic paired semantics' })
    if (name === 'template_recipe_reflow') return providerReply({ columns: 2, header: 'inline', rationale: 'Synthetic structural refinement from measured overflow' })
    throw Error(`Unexpected task ${name}`)
  }
  return { ...store, source, uploadId, visual, fetchModel, calls: () => calls }
}
/** Only tests use these protocol measurements. End-to-end tests use Chromium. */
export async function discoveryProtocolReport(render: NonNullable<DiscoveryAdvance['render']>): Promise<TemplateRenderReport> {
  const { recipe, material, plan } = render
  if (material) return protocolReport(recipe, material, plan!)
  const report = await protocolReport(recipe, { id: 'unused', itemCount: 4, synthetic: true, fragments: [] }, { bindings: [], rationale: 'protocol' })
  report.materialHash = await contentHash({ reconstruction: recipe.sourceSnapshotHash })
  report.stateId = 'reconstruction'; report.trials = [{ stateId: 'reconstruction', issues: [] }]
  const walk = (elements: ElementIR[], x = 0, y = 0) => { for (const e of elements) {
    if ('children' in e) walk(e.children, x + e.bounds.x, y + e.bounds.y)
    else if (e.kind === 'text') report.measurements.push({ sourceId: e.id, text: e.text, fontSize: e.fontSize,
      box: { ...e.bounds, x: x + e.bounds.x, y: y + e.bounds.y }, ink: { left: 0, top: 0, right: 100, bottom: 20 }, pixels: 100 })
  } }
  walk(recipe.originalElements)
  return report
}
