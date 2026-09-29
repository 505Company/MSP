import { adaptiveComponentFixture } from './adaptive-layout'
import { flowFixture } from './component-flow'
import { proposeComponentFlow } from '../../lib/design-system/component-adaptation'
import { flowGeometry } from '../../lib/design-system/component-flow-layout'
import type { PixelBrief, PixelEnvironment, PixelPlan } from '../../lib/presentations/pixel-contract'

// Synthetic executor fixture, never a user slide or a stored model response.
export function pixelFixture(flow = false) {
  const { input } = adaptiveComponentFixture()
  input.content = input.content.filter(f => ['title', 'heading', 'body', 'value1', 'label1'].includes(f.id))
  input.content.push({ id: 'direction', text: 'Справа одна карточка:' })
  if (flow) {
    input.components = [flowFixture()]
    input.componentFlows = { 'native-metric': proposeComponentFlow(input.components[0])! }
  }
  const env: PixelEnvironment = { input, compositions: [], fontTokens: ['font-1'] }, hash = 'a'.repeat(64)
  const brief: PixelBrief = {
    version: 'qwen-design-brief-1', intent: 'Synthetic contract fixture', authorState: 'test-state', authorAdaptation: 'Test only',
    compositionId: null, compositionUse: 'none', compositionReason: 'No source composition in the synthetic fixture',
    title: ['title'], directions: [{ sourceId: 'direction', reason: 'Explicit placement' }],
    groups: [
      { id: 'argument', role: 'argument', fragments: ['heading', 'body'], placement: 'left', component: null, appearance: 'Plain text' },
      { id: 'metric', role: 'metric', fragments: ['value1', 'label1'], placement: 'right', appearance: 'Native card',
        component: { id: 'native-metric', fields: [{ path: 'value', fragments: ['value1'] }, { path: 'text', fragments: ['label1'] }] } },
    ], fontToken: 'font-1', background: 'white', priorities: ['Preserve all content'], typesettingBrief: 'Synthetic pixel test',
  }
  const base = { fontToken: 'font-1', color: 'black', opacity: 1, align: 'left' as const, wrap: true, weight: 400 }
  const plan: PixelPlan = {
    version: 'qwen-pixel-plan-1', briefHash: hash, canvas: { width: 1920, height: 1080, background: 'white' },
    regions: [
      { id: 'title', box: { x: 64, y: 64, width: 1792, height: 160 }, background: null, radius: 0, mode: 'plain', fontStep: null, flowDirection: null },
      { id: 'argument', box: { x: 64, y: 280, width: 1100, height: 400 }, background: null, radius: 0, mode: 'plain', fontStep: null, flowDirection: null },
      { id: 'metric', box: { x: 1280, y: 280, width: 500, height: 240 }, background: null, radius: 0, mode: 'native', fontStep: 0, flowDirection: null },
    ],
    texts: [
      { ...base, id: 'title-text', regionId: 'title', fragments: ['title'], field: null, box: { x: 0, y: 0, width: 1792, height: 160 }, fontSize: 60, lineHeight: 72, weight: 700 },
      { ...base, id: 'heading', regionId: 'argument', fragments: ['heading'], field: null, box: { x: 0, y: 0, width: 1100, height: 60 }, fontSize: 40, lineHeight: 48, weight: 700 },
      { ...base, id: 'body', regionId: 'argument', fragments: ['body'], field: null, box: { x: 0, y: 80, width: 1100, height: 200 }, fontSize: 32, lineHeight: 40 },
      { ...base, id: 'value', regionId: 'metric', fragments: ['value1'], field: 'value', box: { x: 28, y: 10, width: 444, height: 135 }, fontSize: 90, lineHeight: 108, wrap: false },
      { ...base, id: 'caption', regionId: 'metric', fragments: ['label1'], field: 'text', box: { x: 28, y: 160, width: 444, height: 48 }, fontSize: 32, lineHeight: 38 },
    ], calculationSummary: 'Synthetic fixture with known geometry',
  }
  if (flow) {
    const profile = input.componentFlows!['native-metric'], geometry = flowGeometry(profile, 500, [108, 80], 'stack')
    Object.assign(plan.regions[2], { mode: 'flow', flowDirection: 'stack' })
    plan.regions[2].box.height = geometry.height
    plan.texts[3].box = geometry.boxes[0]; plan.texts[4].box = geometry.boxes[1]
  }
  return { env, brief, plan, hash }
}
