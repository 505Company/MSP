import type { BoundsIR, ElementIR } from '../../vendor/drag/src/core/model'
import type { SourceScene } from './source-scene'
import { flatten } from './compiler'
import { validateGraph, type DiagramGraph, type DiagramNode, type DiagramEdge, type GraphPort } from './diagram-graph'

type Record = SourceScene['records'] extends Map<string, infer T> ? T : never
type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const union = (boxes: BoundsIR[]): BoundsIR => {
 const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
 return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y }
}
const moved = (r: Record, origin: Point): ElementIR => ({ ...structuredClone(r.element), bounds: { ...r.bounds, x: r.bounds.x - origin.x, y: r.bounds.y - origin.y } })
const color = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

/** Native timelines have either observed arrows between text/card anchors or
 * dots on one observed axis. A semantic label alone never invents connections.
 * Whole text/shape groups, gradients and source coordinates remain unchanged. */
export function nativeTimelineGraph(scene: SourceScene, sourceIds: string[]): DiagramGraph | null {
 const selected = new Set(sourceIds), members = [...scene.records.values()].filter(r => r.disposition === 'visible' && (selected.has(r.element.id) || r.ancestors.some(id => selected.has(id))))
 const ids = new Set(members.map(r => r.element.id)), roots = members.filter(r => !r.ancestors.some(id => ids.has(id)))
 if (roots.length < 3 || roots.length > 150 || members.some(r => {
  const e = r.element
  return e.rotation || e.centeredTransform?.flipH || e.centeredTransform?.flipV || e.blur || e.effects?.length || e.opacity !== 1 || 'pattern' in e && e.pattern || 'clipBounds' in e && e.clipBounds || 'children' in e && (e.clipPathData || e.clipsContent)
 })) return null
 const segments = roots.flatMap(r => {
  const leaves = flatten([r.element]).filter(e => !('children' in e))
  const lines = leaves.filter(e => e.kind === 'path' && !e.fill && !e.gradient && e.stroke && /^M\s*[\d.e+\-]+[ ,]+[\d.e+\-]+\s*L\s*[\d.e+\-]+[ ,]+[\d.e+\-]+\s*$/.test(e.pathData ?? ''))
  if (lines.length !== 1 || leaves.some(e => e !== lines[0] && e.name !== 'Arrowhead')) return []
  const line = lines[0]; if (line.kind !== 'path' || !line.stroke || line.stroke.paint.color.a !== 1 || line.stroke.dash?.length) return []
  const b = scene.records.get(line.id)!.bounds, n = line.pathData!.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)!.map(Number)
  const a = { x: b.x + n[0], y: b.y + n[1] }, z = { x: b.x + n[2], y: b.y + n[3] }
  const heads = leaves.filter(e => e.name === 'Arrowhead').map(e => { const b = scene.records.get(e.id)!.bounds; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
  const start = heads.some(p => distance(p, a) < distance(p, z)), end = heads.some(p => distance(p, z) < distance(p, a))
  return [{ r, a, z, stroke: line.stroke, arrow: (start && end ? 'both' : start ? 'start' : end ? 'end' : 'none') as DiagramEdge['arrow'] }]
 })
 if (!segments.length) return null
 const horizontal = Math.abs(segments[0].z.y - segments[0].a.y) < .1
 if (!segments.every(s => horizontal ? Math.abs(s.z.y - s.a.y) < .1 && Math.abs(s.z.x - s.a.x) > 20 : Math.abs(s.z.x - s.a.x) < .1 && Math.abs(s.z.y - s.a.y) > 20)) return null
 const along = (p: Point) => horizontal ? p.x : p.y, cross = (p: Point) => horizontal ? p.y : p.x
 const extent = (b: BoundsIR) => horizontal ? b.width : b.height, thickness = (b: BoundsIR) => horizontal ? b.height : b.width
 const texts = roots.filter(r => flatten([r.element]).some(e => e.kind === 'text' && e.text.trim()))
 const spine = segments.length === 1 && segments[0].arrow === 'none'
 let anchors: Record[]
 if (spine) {
  const s = segments[0], lo = Math.min(along(s.a), along(s.z)), hi = Math.max(along(s.a), along(s.z))
  anchors = roots.filter(r => {
   const leaves = flatten([r.element]).filter(e => !('children' in e)), b = r.bounds
   return leaves.length === 1 && leaves[0].kind === 'ellipse' && b.width <= 40 && b.height <= 40 && Math.abs(b.width / b.height - 1) < .1 && along(b) >= lo && along(b) + extent(b) <= hi && Math.abs(cross(b) + thickness(b) / 2 - cross(s.a)) <= thickness(b) / 2
  })
 } else {
  if (segments.some(s => s.arrow === 'none')) return null
  anchors = texts.filter(r => segments.some(s => cross(s.a) >= cross(r.bounds) && cross(s.a) <= cross(r.bounds) + thickness(r.bounds)))
 }
 anchors.sort((a, b) => along(a.bounds) - along(b.bounds))
 if (anchors.length < 2 || anchors.length > 32 || !spine && segments.length !== anchors.length - 1) return null
 if (anchors.some((a, i) => i && along(a.bounds) < along(anchors[i - 1].bounds) + extent(anchors[i - 1].bounds) - .1)) return null
 const groups = anchors.map(a => [a]), assigned = new Set(anchors.map(a => a.element.id)), lines = new Set(segments.map(s => s.r.element.id))
 for (const r of roots.filter(r => !assigned.has(r.element.id) && !lines.has(r.element.id))) {
  const b = r.bounds
  const matches = anchors.map((a, i) => ({ a, i })).filter(({ a }) => {
   const x = along(a.bounds), center = x + extent(a.bounds) / 2, slack = Math.max(2, extent(b) * .08)
   return spine ? center >= along(b) - slack && center <= along(b) + extent(b) + slack : Math.abs(along(b) - x) <= slack || Math.abs(along(b) + extent(b) / 2 - center) <= slack
  })
  if (matches.length !== 1 || !texts.includes(r)) return null
  groups[matches[0].i].push(r); assigned.add(r.element.id)
 }
 if (groups.some(g => !g.some(r => texts.includes(r)))) return null
 const bounds = union(roots.map(r => r.bounds)), nodes: DiagramNode[] = groups.map((group, i) => {
  const box = union(group.map(r => r.bounds))
  return { id: anchors[i].element.id, kind: 'block', bounds: { ...box, x: box.x - bounds.x, y: box.y - bounds.y }, elements: group.map(r => moved(r, box)), sourceIds: group.flatMap(r => flatten([r.element]).map(e => e.id)) }
 })
 const local = (p: Point) => ({ x: p.x - bounds.x, y: p.y - bounds.y })
 const port = (index: number, p: Point): GraphPort => {
  const b = nodes[index].bounds, q = local(p), u = b.width ? Math.max(0, Math.min(1, (q.x - b.x) / b.width)) : 0, v = b.height ? Math.max(0, Math.min(1, (q.y - b.y) / b.height)) : 0
  return { nodeId: nodes[index].id, u, v, dx: q.x - b.x - u * b.width, dy: q.y - b.y - v * b.height }
 }
 const edges: DiagramEdge[] = []
 if (spine) {
  const s = segments[0], ordered = along(s.a) < along(s.z) ? [s.a, s.z] : [s.z, s.a]
  const points = [ordered[0], ...anchors.map(a => horizontal ? { x: a.bounds.x + a.bounds.width / 2, y: s.a.y } : { x: s.a.x, y: a.bounds.y + a.bounds.height / 2 }), ordered[1]]
  const blockCount = nodes.length
  for (const [i, point] of [points[0], points.at(-1)!].entries()) nodes.push({ id: `${s.r.element.id}-endpoint-${i}`, kind: 'junction', bounds: { ...local(point), width: 0, height: 0 }, elements: [], sourceIds: [] })
  const indices = [blockCount, ...anchors.map((_, i) => i), blockCount + 1]
  for (let i = 1; i < points.length; i++) edges.push({ id: `${s.r.element.id}-segment-${i}`, from: port(indices[i - 1], points[i - 1]), to: port(indices[i], points[i]), points: [local(points[i - 1]), local(points[i])], arrow: 'none', color: color(s.stroke.paint.color), width: s.stroke.width, sourceIds: flatten([s.r.element]).map(e => e.id) })
 } else {
  const attachment = (p: Point) => {
   const choices = anchors.map((a, i) => {
    const b = a.bounds, distance = Math.max(along(b) - along(p), 0, along(p) - along(b) - extent(b))
    return { i, distance, sameRow: cross(p) >= cross(b) && cross(p) <= cross(b) + thickness(b) }
   }).filter(c => c.sameRow).sort((a, b) => a.distance - b.distance)
   return choices[0]?.distance <= 35 && (!choices[1] || choices[1].distance - choices[0].distance > 1) ? choices[0].i : -1
  }
  const pairs = new Set<string>()
  for (const s of segments) {
   const a = attachment(s.a), b = attachment(s.z), pair = [a, b].sort((a, b) => a - b).join(':')
   if (a < 0 || b < 0 || Math.abs(a - b) !== 1 || pairs.has(pair)) return null
   pairs.add(pair)
   edges.push({ id: `${s.r.element.id}-edge`, from: port(a, s.a), to: port(b, s.z), points: [local(s.a), local(s.z)], arrow: s.arrow, color: color(s.stroke.paint.color), width: s.stroke.width, sourceIds: flatten([s.r.element]).map(e => e.id), original: [moved(s.r, bounds)] })
  }
 }
 // Keep the observed slide surface as preview context, separate from the
 // reusable transparent graph. Light source labels need their dark backdrop.
 const slide = scene.slides.find(s => s.number === roots[0].source.slide)
 const background = [...scene.records.values()].find(r => r.source.slide === slide?.number && !r.ancestors.length && r.disposition === 'visible' && r.element.name === 'Slide background' && r.element.kind === 'rectangle' && !r.element.gradient && !r.element.pattern && r.element.fill?.color.a === 1 && r.element.opacity === 1 && Math.abs(r.bounds.x) < .5 && Math.abs(r.bounds.y) < .5 && Math.abs(r.bounds.width - slide!.width) < .5 && Math.abs(r.bounds.height - slide!.height) < .5)?.element
 const sourceSurface = background && 'fill' in background && background.fill ? color(background.fill.color) : undefined
 try { return validateGraph({ width: bounds.width, height: bounds.height, ...(sourceSurface ? { sourceSurface } : {}), origin: 'native', sourceIds: members.map(r => r.element.id), nodes, edges, decoration: [], sourceElements: roots.map(r => moved(r, bounds)), warnings: ['Связи таймлайна восстановлены по наблюдаемым соединениям; исходные линии сохранены.'] }) } catch { return null }
}
