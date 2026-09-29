import { flowGeometry } from '../lib/design-system/component-flow-layout'
import { pixelComponentCatalog, type PixelBrief, type PixelEnvironment } from '../lib/presentations/pixel-contract'

/** Measure possible component sizes; never choose placement or mutate a model plan. */
export async function measurePixelComponentEvidence(env: PixelEnvironment, brief: PixelBrief) {
  await document.fonts.ready
  const family = env.input.fonts.find(f => f.id === brief.fontToken)!.family
  const node = document.createElement('div')
  node.style.cssText = 'position:fixed;left:-22000px;top:0;visibility:hidden;margin:0;padding:0;border:0;white-space:pre-wrap;overflow-wrap:normal;word-break:normal;letter-spacing:0;height:auto;'
  node.style.fontFamily = JSON.stringify(family); document.body.appendChild(node)
  const result = []
  try {
    const catalog = pixelComponentCatalog(env)
    for (const group of brief.groups) {
      if (!group.component) continue
      const c = catalog.find(c => c.id === group.component!.id)!, p = c.flow
      if (!p) continue
      const candidates = []
      for (const width of [400, 480, 560, 640, 800, 960]) for (const step of [0, 2, 4]) {
        if (width < p.minWidth || width > p.maxWidth) continue
        for (const direction of ['stack', 'row'] as const) {
          const initial = flowGeometry(p, width, c.fields.map(() => 0), direction)
          if (initial.direction !== direction) continue
          const fields = c.fields.map((f, i) => {
            const binding = group.component!.fields.find(b => f.paths.includes(b.path))!
            const fontSize = Math.max(f.metric ? 48 : 24, f.fontSize * p.fontScale * (1 - step / 16))
            const lineHeight = Math.ceil(fontSize * 1.2), weight = f.metric ? 600 : 400
            node.textContent = binding.fragments.map(id => env.input.content.find(t => t.id === id)!.text).join('\n')
            Object.assign(node.style, { width: `${initial.boxes[i].width}px`, fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, fontWeight: String(weight) })
            const height = Math.ceil(node.getBoundingClientRect().height) + 2
            return { path: binding.path, fragments: binding.fragments, fontSize, lineHeight, weight, height, color: f.color, opacity: f.opacity }
          })
          const measured = flowGeometry(p, width, fields.map(f => f.height), direction)
          if (measured.height > p.maxHeight) continue
          candidates.push({ width, height: measured.height, step, direction,
            fields: fields.map((f, i) => ({ ...f, box: measured.boxes[i] })) })
        }
      }
      result.push({ regionId: group.id, componentId: c.id, candidates })
    }
    return { version: 'pixel-component-measurements-1', fontToken: brief.fontToken,
      note: 'Each candidate is a measured size of this component with the complete selected text, not a slide layout. Qwen chooses width/step/direction and all global placement; decoder/renderer never pick or correct values.', groups: result }
  } finally { node.remove() }
}
