import type { Box, Candidate, ContentSlide, StudioLibrary } from './contract'
import { contrast, overlap, paletteColors, slideNumber } from './color-zones'

export const BRAND_ACCENTS_VERSION = 'brand-accents-3' as const
export type AccentPanel = { blockId: string; color: string; rect: Box; emptyRatio: number; minContrast: number }
export type BrandAccents = { version: typeof BRAND_ACCENTS_VERSION; colors: string[]; panel?: AccentPanel }
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
const chroma = (color: string) => Math.max(...channels(color)) - Math.min(...channels(color))
function hueFamily(color: string) {
  const [r, g, b] = channels(color), hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo
  const hue = (((hi === r ? (g - b) / d : hi === g ? 2 + (b - r) / d : 4 + (r - g) / d) * 60) + 360) % 360
  return hue < 15 || hue >= 345 ? 0 : hue < 40 ? 1 : hue < 75 ? 2 : hue < 160 ? 3 : hue < 195 ? 4 : hue < 255 ? 5 : hue < 300 ? 6 : 7
}

/** Use vivid, readable library tokens. Pastels never become background panels.
 * Multiple shades of one hue do not crowd out the library's other accents. */
export function accentPalette(library: StudioLibrary, surface = '#FFFFFF', minimum = 3) {
  const vivid=library.tokens.colors.filter(c=>/^#[\da-f]{6}$/i.test(c.hex)&&chroma(c.hex)>=.45)
  const frequency=Math.max(0,...vivid.map(c=>c.occurrences))
  const colors = paletteColors(library).filter(c => chroma(c) >= .45 && contrast(c, surface) >= minimum&&(!library.backgrounds||!frequency||(vivid.find(t=>t.hex.toUpperCase()===c.toUpperCase())?.occurrences??0)>=frequency*.15))
  const groups = new Map<number, string>()
  for (const color of colors) {
    const family = hueFamily(color), existing = groups.get(family)
    const weight=(hex:string)=>library.tokens.colors.find(c=>c.hex.toUpperCase()===hex.toUpperCase())?.occurrences??0
    if (!existing || (library.backgrounds?weight(color)>weight(existing):chroma(color)>chroma(existing))) groups.set(family, color)
  }
  const distinct = [...groups.values()]
  return distinct.length > 1 ? [...distinct.slice(1), distinct[0]] : distinct
}
export function canApplyBrandAccents(slide: ContentSlide, candidate?: Pick<Candidate, 'backgroundId' | 'authored'>) {
  return slideNumber(slide) !== 1 && !candidate?.backgroundId && candidate?.authored?.surface !== 'slide-inverse'
}
export const textContrastMinimum = (size: number, weight: number) => size >= 24 || size >= 18.67 && weight >= 700 ? 3 : 4.5

/** A panel belongs to an existing sparse block, never a slice of the canvas.
 * Reject small strips, busy blocks and any intersection with adjacent content. */
export function sparsePanelRect(region: Box, ink: Box[], occupied: Box[]): { rect: Box; emptyRatio: number } | undefined {
  if (region.w < 400 || region.h < 360 || region.w * region.h < 1920 * 1080 * .16 || !ink.length) return
  const emptyRatio = 1 - ink.reduce((area, box) => area + overlap(region, box), 0) / (region.w * region.h)
  if (emptyRatio < .7) return
  const rect = { x: Math.max(24, region.x - 24), y: Math.max(24, region.y - 24), w: 0, h: 0 }
  rect.w = Math.min(1896, region.x + region.w + 24) - rect.x
  rect.h = Math.min(1056, region.y + region.h + 24) - rect.y
  if (ink.some(b => overlap(rect, b) < b.w * b.h - 1) || occupied.some(b => overlap(rect, b) > 1)) return
  return { rect, emptyRatio }
}
