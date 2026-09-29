import { z } from 'zod'
import { flexRefSchema, validateFreeFlex, FREE_FLEX_VERSION, type FreeFlexNode, type FreeFlexPlan } from '../../free-flex'
import { sourceInk, type PixelEnvironment } from '../../pixel-contract'
import { SemanticValidationError } from '../../../design-system/semantic-contract'
import type { LibrarySurface, RecipeBrand } from '../content-recipe'
import { familyById, frames, walk, type FigmaNode, type RecipeVariant } from './catalog'

export const FIGMA_RECIPE_VERSION = 'figma-recipes-2'
export const figmaRecipeSchema = z.object({ version: z.literal(FIGMA_RECIPE_VERSION), recipe: z.literal('figma'), family: z.string().min(1),
  fields: z.array(z.object({ slot: z.string().min(1), refs: z.array(flexRefSchema).min(1).max(100) }).strict()).min(1).max(50),
  panels: z.array(z.object({ slot: z.string().min(1), componentId: z.string().min(1) }).strict()).max(8),
  visuals: z.array(z.object({ slot: z.string().min(1), graphicId: z.string().min(1), fit: z.enum(['contain', 'cover']) }).strict()).max(3),
}).strict()
export type FigmaRecipe = z.infer<typeof figmaRecipeSchema>
export type FigmaSettings = { variant: number; compact: boolean; steps: Record<string, number> }
export type RecipeVisual = { nodeId: string; graphicId: string; fit: 'contain' | 'cover' }
const fail = (issue: string): never => { throw new SemanticValidationError([issue]) }
export function eligibleVariants(p: FigmaRecipe) {
  return familyById(p.family)!.variants.filter(v => !v.aliasOf && p.fields.every(f => v.fields[f.slot]))
}
export function validateFigmaRecipe(raw: unknown, env: PixelEnvironment, brand: RecipeBrand) {
  const parsed = figmaRecipeSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}:${i.message}`))
  const p = parsed.data, family = familyById(p.family)
  if (!family) return fail(`unknown-figma-family:${p.family}`)
  for (const [name, rows] of [['fields', p.fields], ['panels', p.panels], ['visuals', p.visuals]] as const) {
    if (new Set(rows.map(r => r.slot)).size !== rows.length) fail(`duplicate-${name}`)
  }
  const allowed = new Set(family.variants.flatMap(v => Object.keys(v.fields)))
  for (const f of p.fields) if (!allowed.has(f.slot)) fail(`unknown-figma-slot:${f.slot}`)
  for (const required of family.required) if (!p.fields.some(f => f.slot === required)) fail(`required-figma-slot:${required}`)
  if (!eligibleVariants(p).length) fail('no-compatible-figma-state')
  const expected = family.variants[0]
  for (const [name, rows] of [['panels', p.panels], ['visuals', p.visuals]] as const) {
    if (rows.map(v => v.slot).sort().join('|') !== Object.keys(expected[name]).sort().join('|')) fail(`figma-${name}-must-match-recipe`)
  }
  for (const panel of p.panels) {
    const template = env.input.components.find(t => t.id === panel.componentId), profile = env.input.componentFlows?.[panel.componentId]
    if (!template?.sourceLayout || !profile) fail(`qualified-panel-component-required:${panel.componentId}`)
  }
  for (const v of p.visuals) if (!env.input.graphics.some(g => g.id === v.graphicId)) fail(`unknown-recipe-graphic:${v.graphicId}`)
  for (const token of [brand.headingFont, brand.bodyFont, brand.metricFont]) if (!env.fontTokens.includes(token)) fail(`recipe-font-unavailable:${token}`)
  const compiled = compileFigmaRecipe(p, env, brand, { variant: 0, compact: false, steps: {} })
  validateFreeFlex(compiled.plan, env, compiled.visuals)
  return p
}

/** The source tree is trusted, frozen Figma data. A model may only bind slots.
 * Auto-layout rows become weighted flex tracks; captured wrapping becomes rows.
 * Absolute title studies use explicitly authored equivalent flex structures. */
export function compileFigmaRecipe(p: FigmaRecipe, env: PixelEnvironment, brand: RecipeBrand, settings: FigmaSettings, exactVariant?: RecipeVariant) {
  const family = familyById(p.family)!, variant = exactVariant ?? eligibleVariants(p)[settings.variant]
  const frame = frames.find(f => f.id === variant.frame)!, lookup = new Map(walk(frame).map(n => [n.id, n]))
  const binding = new Map(p.fields.map(f => [variant.fields[f.slot], f]))
  const panel = new Map(p.panels.map(f => [variant.panels[f.slot], f]))
  const media = new Map(p.visuals.map(f => [variant.visuals[f.slot], f]))
  const nodes: FreeFlexNode[] = [], surfaces: LibrarySurface[] = [], visuals: RecipeVisual[] = []
  const ownership: Record<string, string> = {}, insets: Record<string, number> = {}, floors: Record<string, number> = {}
  const cssId = (id: string) => 'f-' + id.replace(':', '-')
  const add = (id: string, parent: string | null, css: string) => { nodes.push({ id, parent, kind: 'flex', css, refs: [], component: null }); return id }
  const gap = (n: number) => settings.compact ? Math.round(n * .75) : n
  const invert = p.family === 'visual-mosaic'
  const defaultInk = invert ? brand.background : brand.headingColor
  const text = (sourceId: string, parent: string, css = '', ink?: string) => {
    const b = binding.get(sourceId), source = lookup.get(sourceId)!
    if (!b) return
    const heading = /title|heading|fact/u.test(b.slot), metric = /value/u.test(b.slot), display = heading || metric || /quote|support|lead/u.test(b.slot)
    const floor = Math.min(source.size!, display ? 40 : 24)
    const px = Math.max(floor, Math.round(source.size! * [1, .92, .84, .76][Math.min(3, settings.steps[b.slot] ?? 0)]))
    const id = b.slot, font = metric ? brand.metricFont : heading && source.size! >= 38 ? brand.headingFont : brand.bodyFont
    // Figma's tight Inter leading is adjusted to actual brand-font ink; size
    // steps remain explicit in the receipt, never an unreported scale transform.
    const leading = Math.max(display ? 1.15 : 1.3, source.line?.unit === 'PERCENT' ? source.line.value! / 100 : source.line?.unit === 'PIXELS' ? source.line.value! / source.size! : 1.2)
    nodes.push({ id, parent, kind: 'text', css: `font-family:${font};font-size:${px}px;line-height:${leading};color:${ink ?? (invert ? brand.background : heading || metric ? brand.headingColor : brand.bodyColor)};${css}`, refs: b.refs, component: null })
    floors[id] = floor; ownership[id] = id
  }
  const visible = (n: FigmaNode): boolean => binding.has(n.id) || media.has(n.id) || (n.children ?? []).some(visible)
  const paint = (n: FigmaNode, id: string) => {
    const b = panel.get(n.id)
    if (!b) return undefined
    const template = env.input.components.find(t => t.id === b.componentId)!, profile = env.input.componentFlows![b.componentId]
    surfaces.push({ nodeId: id, componentId: b.componentId, adaptation: 'compound-metrics-1' })
    return sourceInk(template, profile.caption, env.input).color
  }
  const mediaNode = (id: string, parent: string, sourceId: string, css: string) => {
    const m = media.get(sourceId)!
    add(id, parent, css); visuals.push({ nodeId: id, graphicId: m.graphicId, fit: m.fit })
  }
  const emit = (n: FigmaNode, parent: string, sizing: string, inheritedInk?: string): void => {
    if (!visible(n)) return
    if (binding.has(n.id)) { text(n.id, parent, sizing, inheritedInk); return }
    if (media.has(n.id)) { mediaNode(cssId(n.id), parent, n.id, sizing); return }
    if (!n.children) return
    const id = cssId(n.id), pad = n.pad ?? [0, 0, 0, 0], isPanel = panel.has(n.id), isTag = n.name === 'Метка'
    const padding = pad.map(gap), ink = paint(n, id) ?? (isTag ? brand.background : inheritedInk)
    const children = n.children.filter(visible), row = n.layout === 'HORIZONTAL'
    if (!children.length) return
    // Two captured HORIZONTAL frames wrap into a 2×2 grid. Explicit row groups
    // preserve both shared column axes and equal row space without absolute CSS.
    const wrap = row && children.length === 4 && Math.abs(children[0].x - children[2].x) < 1 && children[2].y > children[0].y + children[0].h && children.every(c => c.w > n.w * .4)
    const direction = wrap ? 'column' : row ? 'row' : 'column'
    const align = n.counter === 'MAX' ? 'flex-end' : n.counter === 'CENTER' ? 'center' : 'stretch'
    const justify = n.primary === 'SPACE_BETWEEN' ? children.length === 1 && n.children.length > 1 ? 'flex-end' : 'space-between' : n.primary === 'MAX' ? 'flex-end' : n.primary === 'CENTER' ? 'center' : 'flex-start'
    add(id, parent, `flex-direction:${direction};align-items:${align};justify-content:${justify};gap:${gap(n.gap ?? 0)}px;padding:${padding.map(x => `${x}px`).join(' ')};${isTag ? `background-color:${brand.headingColor};border-radius:${n.radius ?? 0}px;` : ''}${sizing}`)
    if (isPanel) insets[id] = Math.min(...padding)
    const innerW = n.w - pad[1] - pad[3], innerH = n.h - pad[0] - pad[2]
    const fillRows = !row && /height:100%|flex:1 1 0/u.test(sizing) && children.length > 1 && children.every(c => c.type === 'FRAME' && c.name !== 'Метка') && children.reduce((sum, c) => sum + c.h, 0) + (n.gap ?? 0) * (children.length - 1) >= innerH * .95
    if (wrap) {
      const ys = [...new Set(children.map(c => Math.round(c.y)))].sort((a, b) => a - b)
      ys.forEach((y, i) => {
        const r = add(`${id}-row${i}`, id, `flex:1 1 0;flex-direction:row;gap:${gap(n.gap ?? 16)}px;`)
        children.filter(c => Math.round(c.y) === y).forEach(c => emit(c, r, 'flex:1 1 0;', ink))
      })
    } else for (const child of children) {
      let size = row ? `flex:${Math.round(child.w)} 1 0;` : `width:${Math.min(100, child.w / innerW * 100).toFixed(4)}%;`
      if (row && child.type === 'FRAME' && child.h >= innerH * .9) size += 'height:100%;'
      // Small labels are source HUG text, not narrow fixed editorial columns.
      if (!row && child.type === 'TEXT' && child.size! <= 32) size = 'width:100%;'
      // Metadata is intrinsic text. Stretching these text boxes prevents the
      // original right/space-between alignment from taking effect.
      if (n.name === 'Служебная строка') size = child.name === 'Формат' ? 'flex:1 1 0;' : 'flex:0 0 auto;'
      if (n.name === 'Формат' || n.name === 'Подвал') size = `flex:0 1 auto;max-width:${Math.min(100, child.w / innerW * 100 + 10).toFixed(4)}%;`
      // Fill the main/cell height; other vertical children keep intrinsic height.
      if (fillRows) size += `flex:${child.h} 1 0;`
      else if (!row && (child.name === 'Содержание' || child.h >= innerH * .72 && child.type !== 'TEXT')) size += 'flex:1 1 0;'
      if (media.has(child.id) && !row) size += 'flex:1 1 0;'
      emit(child, id, size, ink)
    }
  }
  add('root', null, `width:1920px;height:1080px;flex-direction:column;padding:${family.manualFlow ? '49px 46px' : '44px 46px 34px'};gap:${gap(24)}px;background-color:${invert ? brand.headingColor : brand.background};`)
  if (!family.manualFlow) {
    for (const child of frame.children ?? []) if (visible(child)) emit(child, 'root', child.name === 'Содержание' ? 'width:100%;flex:1 1 0;' : 'width:100%;')
  } else {
    // Title studies are not auto-layout in Figma. These structures encode their
    // reading order, anchors and size states, keeping every content box in flex.
    const fields = new Map(p.fields.map(f => [f.slot, variant.fields[f.slot]]))
    const t = (slot: string, parent: string, css = '') => { if (fields.has(slot)) text(fields.get(slot)!, parent, css) }
    const contextRow = (parent: string) => {
      if (!fields.has('context') && !fields.has('year')) return
      const row = add('context-row', parent, 'flex-direction:row;gap:80px;')
      t('context', row); t('year', row)
    }
    const tags = (parent: string) => {
      const all = ['tag1', 'tag2', 'tag3'].filter(k => fields.has(k))
      if (!all.length) return
      const row = add('tags', parent, `flex-direction:row;gap:${gap(32)}px;flex-wrap:wrap;`)
      for (const slot of all) {
        const group = add(`${slot}-box`, row, `padding:12px 32px;border:2px solid ${defaultInk};border-radius:24px;`)
        t(slot, group)
      }
    }
    if (p.family === 'single-visual' || p.family === 'visual-mosaic') {
      const row = add('columns', 'root', `flex:1 1 0;flex-direction:row;gap:${gap(48)}px;`)
      const left = add('editorial', row, 'flex:1.08 1 0;flex-direction:column;gap:24px;justify-content:space-between;')
      contextRow(left); tags(left); t('title', left); t('support', left); t('footer', left)
      if (p.family === 'single-visual') mediaNode('visual', row, variant.visuals.visual, 'flex:1 1 0;')
      else {
        const art = add('mosaic', row, 'flex:1 1 0;flex-direction:row;gap:32px;')
        mediaNode('visual1', art, variant.visuals.visual1, 'flex:1 1 0;')
        const col = add('mosaic-right', art, 'flex:1 1 0;flex-direction:column;gap:32px;')
        mediaNode('visual2', col, variant.visuals.visual2, 'flex:1.4 1 0;'); mediaNode('visual3', col, variant.visuals.visual3, 'flex:1 1 0;')
      }
    } else {
      contextRow('root')
      const body = add('editorial', 'root', `flex:1 1 0;flex-direction:column;justify-content:flex-end;gap:${gap(32)}px;`)
      if (p.family === 'semantic-graphic') mediaNode('visual', body, variant.visuals.visual, 'height:360px;width:72%;flex:0 0 auto;')
      tags(body); t('title', body)
      if (p.family === 'dense-editorial') {
        const row = add('body-columns', body, `flex-direction:row;gap:${gap(32)}px;`)
        t('body1', row, 'flex:1 1 0;'); t('body2', row, 'flex:1 1 0;')
      }
      t('support', body); t('footer', 'root')
    }
  }
  const plan: FreeFlexPlan = { version: FREE_FLEX_VERSION, rationale: `Executable Figma ${p.family}, source ${variant.frame}; brand-adapted flex, no model geometry.`,
    emphasis: [{ fragmentId: p.fields.find(f => /title|quote|value|fact/u.test(f.slot))?.refs[0].fragmentId ?? p.fields[0].refs[0].fragmentId, importance: 1, reason: 'Иерархия выбранного авторского рецепта.' }], nodes }
  return { plan, surfaces, visuals, ownership, insets, floors, sourceFrame: variant.frame }
}
