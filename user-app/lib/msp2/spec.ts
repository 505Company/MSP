import { slideCatalog } from '@msp2/runtime/catalog'
import type { Spec } from '@json-render/core'
import type { SlidePlan } from './types'

export function slideSpec(plan: SlidePlan): Spec {
  const ids = plan.content.blocks.map(b => b.id)
  if (!ids.length || ids.length > 14 || ids.some(id => !/^b\d+$/.test(id)) || new Set(ids).size !== ids.length) throw Error('Некорректные ссылки блоков MSP 2.')
  const spec: Spec = {
    root: 'slide',
    elements: {
      slide: { type: 'Slide', props: { title: plan.content.title }, children: plan.content.blocks.map(b => b.id) },
      ...Object.fromEntries(plan.content.blocks.map(b => [b.id, { type: plan.components[b.id] ? 'Component' : b.data ? b.data.template.kind === 'chart' ? 'Chart' : 'Table' : b.kind === 'text' ? 'Text' : b.kind === 'metric' ? 'Metric' : 'Group', props: { id: b.id }, children: [] }])),
    },
  }
  const result = slideCatalog.validate(spec)
  if (!result.success) throw Error('Некорректная спецификация каталога MSP 2.')
  return spec
}
