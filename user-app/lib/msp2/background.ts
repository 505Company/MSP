import { assembleBackground } from '../design-system/backgrounds'
import {masterContentArea} from '../design-system/slide-masters'
import type { ContentSlide, DesignLibrary, SlidePlan } from './types'

const luminance = (hex: string) => [1, 3, 5].reduce((sum, at, i) => {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255
  return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i]
}, 0)
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)

/** Reuse an observed cover background without moving, stretching or covering
 * its artwork. Other slides keep the design system's plain surface. */
export function chooseBackground(content: ContentSlide, library: DesignLibrary): SlidePlan['background'] {
  if (content.id !== 'slide-1' || content.blocks.length > 3 || content.blocks.some(b => b.kind !== 'text' || b.data)) return
  const catalog = library.backgrounds
  if (!catalog) return
  for (const preset of catalog.presets) {
    const fill = catalog.fills.find(f => f.id === preset.selection.fillId)?.element
    if (!fill?.fill?.color || fill.gradient || fill.pattern || !preset.selection.layers.length) continue
    const c = fill.fill.color, color = '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
    const ink = library.tokens.colors.map(c => c.hex).filter(c => /^#[\da-f]{6}$/i.test(c)).sort((a, b) => contrast(b, color) - contrast(a, color))[0]
    if (!ink || contrast(ink, color) < 4.5) continue
    const art = assembleBackground(catalog, {...preset.selection,masterId:undefined}, { width: 1920, height: 1080 }).elements[0].children.slice(1)
    let x = 0, end = 12
    if (art.every(a => a.bounds.x >= 800)) end = Math.min(12, Math.floor((Math.min(...art.map(a => a.bounds.x)) - 48) / 154))
    else if (art.every(a => a.bounds.x + a.bounds.width <= 1120)) x = Math.max(0, Math.ceil((Math.max(...art.map(a => a.bounds.x + a.bounds.width)) + 24 - 48) / 154))
    else continue
    const safe=catalog.masters?.[0]?masterContentArea(catalog.masters[0]):undefined
    if (end - x >= 5) return { id: preset.id, area: { x, y: 0, w: end - x, h: safe?Math.min(48,Math.floor(safe.h/(984/48))):48 }, color, ink }
  }
}
