import type { DesignLibrary, SlidePlan } from './types'
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const luminance = (hex: string) => rgb(hex).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0)
const light = (hex: string) => rgb(hex).reduce((sum, byte, i) => { const v = byte / 255; return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i] }, 0)
const contrast = (a: string, b: string) => (Math.max(light(a), light(b)) + .05) / (Math.min(light(a), light(b)) + .05)
export function designTokens(library: DesignLibrary, plan?: SlidePlan) {
  const colors = library.tokens.colors.map(c => c.hex).filter(c => /^#[\da-f]{6}$/i.test(c))
  const fields = Object.values(library.prepared).flatMap(p => p.profile.fields)
  const fonts = [...library.tokens.fonts].sort((a, b) => fields.filter(f => f.font === b.family).length - fields.filter(f => f.font === a.family).length || Number(b.sizes.some(s => s >= 48)) - Number(a.sizes.some(s => s >= 48)))
  if (!colors.length || !fonts.length) throw Error('В дизайн-системе ещё нет палитры и шрифтов. Завершите импорт.')
  const ordered = [...colors].sort((a, b) => luminance(b) - luminance(a))
  const observed = [...library.backgrounds?.fills ?? []].filter(f => f.element.fill?.color && !f.element.gradient && !f.element.pattern).sort((a, b) => b.slides.length - a.slides.length)[0]?.element.fill?.color
  const background = observed ? '#' + [observed.r, observed.g, observed.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : ordered[0]
  const ink = [...colors].sort((a, b) => contrast(b, background) - contrast(a, background))[0]
  const declared = library.rules.flatMap(r => /основной цвет|brand|primary/iu.test(r) ? r.match(/#[\da-f]{6}/ig) ?? [] : [])
  const accent = declared.find(c => colors.some(x => c.toLowerCase() === x.toLowerCase()) && contrast(c, background) >= 4.5) ?? colors.find(c => Math.max(...rgb(c)) - Math.min(...rgb(c)) > 65 && contrast(c, background) >= 4.5) ?? ink
  return { font: fonts[0].family, background: plan?.background?.color ?? background, ink: plan?.background?.ink ?? ink, accent: plan?.background?.ink ?? accent, palette: colors, body: 36, title: 72 }
}
