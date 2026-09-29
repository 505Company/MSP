import { renderEditableHtml } from '../design-system/editable-render'
import { componentData, spanText, type LayoutInput, type LayoutPlan } from './layout-contract'
import { layoutContextBoxes, factBoxes, stateById, type Box } from './recipes/layout-engine-v1/states'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function renderLayoutHtml(plan: LayoutPlan, input: LayoutInput, stateId: string, graphics: Record<string, string> = {}, plainComponents = false, wideContext = false): string {
  const state = stateById(stateId)!
  const colors = Object.fromEntries(Object.entries(plan.colors).map(([role, id]) => [role, input.colors.find(c => c.id === id)!.hex]))
  const family = input.fonts.find(f => f.id === plan.fontToken)!.family
  const position = (b: Box) => `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;box-sizing:border-box;`
  const text = (id: string, value: string, b: Box, role = 'primary', panel = false) => `<div data-layout-block="${id}" data-layout-text data-max-lines="${b.maxLines ?? 0}" style="${position(b)}font-size:${b.fontSize}px;font-weight:${b.weight ?? 400};line-height:${b.lineHeight ? `${b.lineHeight}px` : 'normal'};letter-spacing:0;white-space:${b.nowrap ? 'pre' : 'pre-wrap'};overflow-wrap:normal;word-break:normal;hyphens:none;color:${colors[panel ? 'onSurface' : role]};${panel ? `background:${colors.surface};border-radius:${b.radius ?? 16}px;display:grid;grid-template-columns:minmax(0,${b.paddingX ?? 0}px) max-content minmax(0,${b.paddingX ?? 0}px);justify-content:center;align-items:center;` : ''}"><span style="display:block;text-box-trim:trim-both;text-box-edge:cap alphabetic;${panel ? 'grid-column:2;' : ''}">${esc(value)}</span></div>`
  const visual = (id: string, resourceId: string, b: Box, fit: string) => `<div data-layout-block="${id}" data-layout-visual style="${position(b)}overflow:hidden;border-radius:${b.radius ?? 0}px;"><img data-resource-id="${esc(resourceId)}" alt="" src="${esc(graphics[resourceId] ?? '')}" style="display:block;width:100%;height:100%;object-fit:${fit};"/></div>`
  const parts: string[] = []
  if (state.innerSurface) parts.push(`<div style="${position(state.innerSurface)}background:${colors.surface}"></div>`)
  parts.push(text('primary', spanText(plan.primary, input), state.primary))
  if (state.context) plan.context.forEach((p, i) => parts.push(text(`context-${i}`, spanText(p, input), layoutContextBoxes(wideContext)[i], 'secondary')))
  if (state.context && plan.context.length === 2 && plan.connectorId) parts.push(visual('connector', plan.connectorId, { x: 444, y: 49, width: 118, height: 58 }, 'contain'))
  const facts = state.factsY !== undefined ? factBoxes(state.factsY) : state.wideInfo ? [state.wideInfo] : []
  plan.facts.forEach((p, i) => parts.push(text(`fact-${i}`, spanText(p, input), facts[i], 'primary', true)))
  plan.support.forEach((b, i) => {
    const bounds = state.support![i]
    const template = b.component && input.components.find(t => t.id === b.component!.id)
    if (template && !plainComponents) {
      const filled = structuredClone(template)
      filled.style = { ...filled.style, font: family, headingFont: family, color: colors.primary, background: colors.background, accent: colors.accent, muted: colors.secondary, border: colors.stroke, palette: Object.values(colors) }
      parts.push(`<div data-layout-block="support-${i}" data-layout-component="${esc(template.id)}" data-intrinsic-width="${template.width}" data-intrinsic-height="${template.height}" style="${position(bounds)}"><div style="width:${template.sourceLayout ? template.width : bounds.width}px">${renderEditableHtml(filled, componentData(b.component!, template, input))}</div></div>`)
    } else parts.push(text(`support-${i}`, spanText(b.parts, input), bounds, 'secondary'))
  })
  if (state.footer && plan.footer.length) parts.push(text('footer', spanText(plan.footer, input), state.footer, 'secondary'))
  plan.visuals.forEach((v, i) => parts.push(visual(`visual-${i}`, v.id, state.visuals![i], v.fit)))
  return `<div data-layout-slide data-state="${esc(state.id)}" style="position:relative;box-sizing:border-box;isolation:isolate;width:1920px;height:1080px;overflow:hidden;background:${colors.background};color:${colors.primary};font-family:${esc(JSON.stringify(family))};font-synthesis:none;text-align:left;">${parts.join('')}</div>`
}

export function contrastRatio(a: string, b: string) {
  const luminance = (color: string) => {
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
