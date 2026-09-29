import { pixelComponentCatalog, type PixelBrief, type PixelEnvironment } from '../lib/presentations/pixel-contract'
import type { PixelTextEvidence } from '../lib/presentations/fast-two-qwen-task'

/** Intrinsic text measurements only. Does not choose a slide layout or mutate a plan. */
export async function measurePixelTextEvidence(env: PixelEnvironment, brief: PixelBrief): Promise<PixelTextEvidence> {
  await document.fonts.ready
  const font = env.input.fonts.find(f => f.id === brief.fontToken)
  if (!font || !env.fontTokens.includes(font.id)) throw Error('Evidence font is unavailable')
  const widths = [320, 400, 480, 560, 640, 800, 960, 1120, 1440, 1792]
  const rows: PixelTextEvidence['rows'] = [], catalog = pixelComponentCatalog(env)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-22000px;top:0;pointer-events:none;visibility:hidden;'
  document.body.appendChild(host)
  const text = document.createElement('div'); host.appendChild(text)
  text.style.cssText = 'box-sizing:border-box;padding:0;margin:0;border:0;height:auto;white-space:pre-wrap;overflow-wrap:normal;word-break:normal;letter-spacing:0;'
  text.style.fontFamily = JSON.stringify(font.family)
  const seen = new Set<string>()
  const measure = (fragments: string[], sizes: number[], weights: number[]) => {
    text.textContent = fragments.map(id => env.input.content.find(f => f.id === id)!.text).join('\n')
    for (const fontSize of [...new Set(sizes)]) for (const weight of weights) {
      const key = JSON.stringify([fragments, fontSize, weight]); if (seen.has(key)) continue; seen.add(key)
      const lineHeight = Math.ceil(fontSize * 1.2)
      Object.assign(text.style, { fontSize: `${fontSize}px`, fontWeight: String(weight), lineHeight: `${lineHeight}px` })
      const lines = widths.map(width => { text.style.width = `${width}px`; return Math.round(text.getBoundingClientRect().height / lineHeight) })
      rows.push({ fragments, fontSize, weight, lineHeight, lines })
    }
  }
  try {
    measure(brief.title, [60, 72, 84], [600])
    for (const group of brief.groups) {
      if (!group.component) { for (const id of group.fragments) measure([id], [24, 28, 32, 36, 40], [400, 600]); continue }
      const component = catalog.find(c => c.id === group.component!.id)!
      for (const field of group.component.fields) {
        const slot = component.fields.find(s => s.paths.includes(field.path))!
        const sizes = component.flow
          ? [0, 1, 2, 3, 4].map(step => Math.round(Math.max(slot.metric ? 48 : 24, slot.fontSize * component.flow!.fontScale * (1 - step / 16)) * 10) / 10)
          : slot.metric ? [48, 64, 80, 96, 112, 128] : [24, 28, 32, 36, 40]
        measure(field.fragments, sizes, slot.metric ? [600] : [400])
      }
    }
    return { version: 'pixel-text-evidence-1', fontToken: font.id, widths, rows }
  } finally { host.remove() }
}
