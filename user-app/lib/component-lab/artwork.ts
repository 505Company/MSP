import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'

type XmlNode = { [tag: string]: XmlNode[] | Record<string, string> }
export type GraphicPart = { x: number; y: number; width: number; height: number; svg: string; ids: string[]; tags: string[] }
const options = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', processEntities: false, parseTagValue: false, trimValues: false }
const attrs = (node: XmlNode) => (node[':@'] ?? {}) as Record<string, string>
const tag = (node: XmlNode) => Object.keys(node).find(k => k !== ':@')!
const children = (node: XmlNode) => node[tag(node)] as XmlNode[]
const numbers = (text: string) => text.trim().split(/[ ,]+/).map(Number)
const tags = new Set(['svg', 'g', 'rect', 'path', 'ellipse', 'circle', 'image', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop'])
const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'preserveAspectRatio', 'overflow', 'aria-hidden', 'data-source-object', 'href', 'id', 'clip-path', 'clipPathUnits', 'gradientUnits', 'gradientTransform', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color', 'stop-opacity'])
const assetPattern = /^\/api\/uploads\/[a-f\d-]{36}\/assets\/[a-zA-Z\d_-]+$/
export function assetReferences(svg: string) { return [...new Set([...svg.matchAll(/\bhref="([^"]+)"/g)].map(m => m[1]))] }

/** Only the declarative subset emitted by the native compiler is accepted.
 * No scripts, event handlers, CSS, external documents or entity expansion. */
export function safeGraphic(svg: string) {
  if (!svg || svg.length > 800000 || /<!|<\?|&|\bon\w+\s*=|\bstyle\s*=/i.test(svg) || XMLValidator.validate(svg) !== true) return false
  try {
    const roots = new XMLParser(options).parse(svg) as XmlNode[]
    if (roots.length !== 1 || tag(roots[0]) !== 'svg') return false
    const visit = (node: XmlNode): boolean => {
      if (!tags.has(tag(node)) || !Array.isArray(children(node))) return false
      for (const [key, value] of Object.entries(attrs(node))) {
        if (!attributes.has(key) || key === 'href' && !assetPattern.test(value) || /url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value)) return false
        if (['fill', 'stroke', 'stop-color'].includes(key) && !/^(?:none|transparent|#[\da-f]{3,8}|url\(#[\w-]+\))$/i.test(value)) return false
      }
      return children(node).every(visit)
    }
    return visit(roots[0])
  } catch { return false }
}

/** Recover the independent top-level object boxes already emitted by the
 * native compiler. Empty text placeholders carry no decorative artwork. */
export function graphicParts(svg: string): GraphicPart[] | undefined {
  if (!safeGraphic(svg)) return
  const root = (new XMLParser(options).parse(svg) as XmlNode[])[0], parts: GraphicPart[] = []
  for (const group of children(root)) {
    const translate = /^translate\(([^)]+)\)$/.exec(attrs(group).transform ?? '')
    if (tag(group) !== 'g' || !translate || children(group).length !== 1 || tag(children(group)[0]) !== 'svg') return
    const node = children(group)[0], a = attrs(node), [x, y] = numbers(translate[1]), width = Number(a.width), height = Number(a.height), view = numbers(a.viewBox ?? '')
    if (![x, y, width, height, ...view].every(Number.isFinite) || width <= 0 || height <= 0 || view.length !== 4 || view[0] !== 0 || view[1] !== 0 || Math.abs(view[2] - width) > .1 || Math.abs(view[3] - height) > .1) return
    const ids: string[] = [], painted: string[] = []
    const visit = (n: XmlNode) => { if (attrs(n)['data-source-object']) ids.push(attrs(n)['data-source-object']); if (['rect', 'path', 'ellipse', 'circle', 'image'].includes(tag(n))) painted.push(tag(n)); children(n).forEach(visit) }
    visit(node)
    if (painted.length) parts.push({ x, y, width, height, ids, tags: painted, svg: new XMLBuilder(options).build([node]) })
  }
  return parts
}
export function simpleRoundBadge(part: GraphicPart) {
  if (part.tags.length !== 1 || !['ellipse', 'circle'].includes(part.tags[0]) || Math.abs(part.width / part.height - 1) > .01 || /rotate\((?!0\))/.test(part.svg)) return false
  // The circle must fill the object box. An offset ellipse is not a badge.
  const shape = /<(?:ellipse|circle)\b([^>]+)>/.exec(part.svg)?.[1]
  if (!shape) return false
  const value = (name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(shape)?.[1])
  const rx = part.tags[0] === 'circle' ? value('r') : value('rx'), ry = part.tags[0] === 'circle' ? value('r') : value('ry')
  return Math.abs(value('cx') - part.width / 2) < .1 && Math.abs(value('cy') - part.height / 2) < .1 && Math.abs(rx - part.width / 2) < .1 && Math.abs(ry - part.height / 2) < .1
}

export function combinedGraphic(parts: GraphicPart[]) {
  const x = Math.min(...parts.map(p => p.x)), y = Math.min(...parts.map(p => p.y))
  const width = Math.max(...parts.map(p => p.x + p.width)) - x, height = Math.max(...parts.map(p => p.y + p.height)) - y
  return { x, y, width, height, ids: [...new Set(parts.flatMap(p => p.ids))], svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.map(p => `<g transform="translate(${p.x - x} ${p.y - y})">${p.svg}</g>`).join('')}</svg>` }
}
