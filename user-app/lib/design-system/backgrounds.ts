import type { BoundsIR, ElementIR, ShapeElementIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot } from '../digital-designer/source-types'
import type { ComponentLibrary } from './types'
import type { ReconstructionResult } from './reconstruction-contract'
import { readSourceScene } from './source-scene'
import { flatten } from './compiler'
import { scaled } from '../slides/document'
import {buildSlideMasters,assembleSlideMaster,type SlideMasterStyle} from './slide-masters'

export const BACKGROUND_VERSION = 'slide-backgrounds-1'
export type BackgroundPlacement = { id: string; slide: number; width: number; height: number; bounds: BoundsIR; zIndex: number }
export type BackgroundArtwork = {
  id: string; name: string; kind: 'pattern' | 'decoration' | 'panel'
  scene: { width: number; height: number; elements: ElementIR[] }
  sourceIds: string[]; assetIds: string[]; placements: BackgroundPlacement[]
  editableParts: boolean
}
export type BackgroundSelection = { fillId: string | null; layers: { artworkId: string; placementId: string }[]; masterId?:string }
export type BackgroundCatalog = {
  version: typeof BACKGROUND_VERSION; sourceCatalogId: string
  fills: { id: string; name: string; element: ShapeElementIR; slides: number[] }[]
  artworks: BackgroundArtwork[]
  masters?:SlideMasterStyle[]
  presets: { id: string; slides: number[]; width: number; height: number; selection: BackgroundSelection }[]
  notes: string[]
}

// Compare the actual scene, including masks, crop and opacity. An asset ID alone
// is not an appearance: two uses of one bitmap can have different clipping.
function appearance(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6
  if (Array.isArray(value)) {
    const ordered = value.length && value.every(v => v && typeof v === 'object' && 'zIndex' in v) ? [...value].sort((a, b) => a.zIndex - b.zIndex) : value
    return ordered.map(appearance)
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'name', 'sourceRef', 'zIndex'].includes(key)).map(([key, v]) => [key, appearance(v)]))
  return value
}
const hex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

/** A derived view of source evidence. No model call and no source-catalog rewrite.
 * Slide fill and overlaid artwork remain separate reusable layers. */
export function buildBackgroundCatalog(snapshot: SourceSnapshot, library: ComponentLibrary, sourceCatalogId: string, results: ReconstructionResult[] = [], contentIds: string[] = []): BackgroundCatalog {
  const scene = readSourceScene(snapshot), catalog: BackgroundCatalog = { version: BACKGROUND_VERSION, sourceCatalogId, fills: [], artworks: [], presets: [], notes: [] }
  const content=new Set([...contentIds,...library.components.filter(c=>c.slots.length||c.fixedTextIds.length).flatMap(c=>c.source.elementIds)])
  const contentMember=(id:string)=>content.has(id)||scene.records.get(id)?.ancestors.some(id=>content.has(id))
  const backgroundIds = new Set(library.components.filter(c => c.semantics.some(s => s.role === 'background')).flatMap(c => c.source.elementIds))
  const fillBySlide = new Map<number, string>(), fillKeys = new Map<string, BackgroundCatalog['fills'][number]>(), baseIds = new Set<string>()
  for (const slide of snapshot.slides) {
    const record = [...scene.records.values()].filter(r => {
      const e = r.element, b = r.bounds
      return r.source.slide === slide.number && !r.source.parentId && r.disposition === 'visible' && e.kind === 'rectangle' && !e.rotation && (e.name === 'Slide background' || backgroundIds.has(e.id)) && Math.abs(b.x) < .5 && Math.abs(b.y) < .5 && Math.abs(b.width - slide.width) < .5 && Math.abs(b.height - slide.height) < .5 && (e.fill || e.gradient || e.pattern)
    }).sort((a, b) => a.element.zIndex - b.element.zIndex)[0]
    if (!record) continue
    const element = structuredClone(record.element) as ShapeElementIR
    baseIds.add(element.id)
    const key = JSON.stringify(appearance({ ...element, bounds: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0 }))
    let fill = fillKeys.get(key)
    if (!fill) {
      fill = { id: `fill-${element.id}`, name: element.gradient ? 'Градиент' : element.pattern ? 'Узорная заливка' : hex(element.fill!.color), element, slides: [] }
      catalog.fills.push(fill); fillKeys.set(key, fill)
    }
    fill.slides.push(slide.number); fillBySlide.set(slide.number, fill.id)
  }
  const artKeys = new Map<string, BackgroundArtwork>(), covered = new Set<string>()
  const paintOrder = new Map<string, number>()
  const visit = (elements: ElementIR[]) => { for (const e of [...elements].sort((a, b) => a.zIndex - b.zIndex)) { paintOrder.set(e.id, paintOrder.size); if ('children' in e) visit(e.children) } }
  visit(scene.roots)
  // Prefer the whole graphic to its descendants; never include text or charts.
  // Read raster decorations first, then admit only masks painted over them.
  const candidates = [...library.components].sort((a, b) => Number(!!b.source.assetIds.length) - Number(!!a.source.assetIds.length) || b.source.elementIds.length - a.source.elementIds.length)
  const prepared = candidates.flatMap(c => {
    const slide = snapshot.slides.find(s => s.number === c.source.slide), root = scene.records.get(c.source.rootId)
    const records = c.source.elementIds.flatMap(id => scene.records.get(id) ?? []), viewport = c.scene.elements.find(e => e.id === c.source.rootId)
    // Semantic components spanning several source roots have a translation-only
    // viewport. Its inverse offset is the observed placement, not a new layout.
    const placement = root?.bounds ?? (viewport?.kind === 'group' && !viewport.rotation && !viewport.centeredTransform?.flipH && !viewport.centeredTransform?.flipV ? { x: 0 - viewport.bounds.x, y: 0 - viewport.bounds.y, width: c.scene.width, height: c.scene.height } : null)
    if (!slide || !placement || !records.length || records.every(r => r.disposition !== 'visible') || root && root.disposition !== 'visible' || c.slots.length || c.fixedTextIds.length || c.source.elementIds.some(id => baseIds.has(id))) return []
    const nodes = flatten(c.scene.elements)
    if (nodes.some(e => ['text', 'table', 'chart'].includes(e.kind))) return []
    const recovery = results.find(r => r.candidate.componentIds.includes(c.id) && r.pattern)
    const roles = c.semantics.map(s => s.role), explicit = roles.some(role => ['pattern', 'background'].includes(role))
    const rasterDecoration = roles.includes('decoration') && !roles.some(r => ['photo', 'icon', 'logo'].includes(r)) && c.source.assetIds.length > 0
    // Native decoration is artwork too. A separate text field inside a shape
    // makes it a content panel, not a background layer.
    const vectorDecoration = roles.includes('decoration') && !roles.some(r=>['photo','icon','logo','chart'].includes(r)) && !c.source.assetIds.length
      && !c.source.elementIds.some(contentMember) && !nodes.some(e=>e.name==='Arrowhead') && placement.width*placement.height>=slide.width*slide.height*.001
      && nodes.filter(e=>!('children'in e)).every(e=>['rectangle','ellipse','path'].includes(e.kind))
      && nodes.filter(e=>!('children'in e)).every(e=>{const source=scene.records.get(e.id)?.element;return source&&'fill'in source&&'fill'in e&&JSON.stringify(source.fill)===JSON.stringify(e.fill)})
      && nodes.some(e=>'fill'in e&&(e.gradient||e.pattern||e.stroke||JSON.stringify(e.fill?.color)!==JSON.stringify(catalog.fills.find(f=>f.slides.includes(slide.number))?.element.fill?.color)))
      && ![...scene.records.values()].some(r=>r.source.slide===slide.number&&r.disposition==='visible'&&(r.element.kind==='raster'||r.element.kind==='text'&&r.element.text.trim())&&r.bounds.x+r.bounds.width/2>placement.x&&r.bounds.x+r.bounds.width/2<placement.x+placement.width&&r.bounds.y+r.bounds.height/2>placement.y&&r.bounds.y+r.bounds.height/2<placement.y+placement.height)
    const largeRasterDecoration = rasterDecoration && c.scene.width * c.scene.height >= slide.width * slide.height * .15
    // Thin bands and cropped corner motifs occupy little area. Their observed
    // edge placement and substantial span distinguish them from inset icons.
    // Retaining them as source artwork does not claim editable vector parts.
    const atEdge = Math.min(Math.abs(placement.x), Math.abs(placement.y), Math.abs(slide.width - placement.x - placement.width), Math.abs(slide.height - placement.y - placement.height)) <= 2
    const edgeDecoration = rasterDecoration && atEdge && (c.scene.width >= slide.width * .2 || c.scene.height >= slide.height * .2) && c.scene.width * c.scene.height >= slide.width * slide.height * .005
    const ref = root?.element.sourceRef
    // A bitmap may be a photo in one placement and a background in another.
    // Share evidence only for the SAME inherited object and exact appearance,
    // including its viewport, crop, flip, opacity and original canvas size.
    const inheritedKey = ref && /^ppt\/(slideLayouts|slideMasters)\//.test(ref.part) && !roles.some(r => ['icon', 'logo', 'chart'].includes(r))
      ? JSON.stringify([ref.part, ref.shapeId, slide.width, slide.height, appearance(c.scene)]) : null
    return [{ c, slide, placement, nodes, roles, recovery, eligible: !!recovery || explicit || vectorDecoration || largeRasterDecoration || edgeDecoration, inheritedKey }]
  })
  const inheritedBackgrounds = new Set(prepared.filter(p => p.eligible && p.inheritedKey).map(p => p.inheritedKey))
  for (const { c, slide, placement, nodes, roles, recovery, eligible, inheritedKey } of prepared) {
    if (c.source.elementIds.every(id => covered.has(id))) continue
    const baseFill = catalog.fills.find(f => f.slides.includes(slide.number))?.element
    const order = Math.min(...c.source.elementIds.map(id => paintOrder.get(id) ?? Infinity))
    const leaves = nodes.filter(e => !('children' in e))
    const mask = roles.includes('decoration') && !c.source.assetIds.length && baseFill?.fill?.color.a === 1 && !baseFill.gradient && !baseFill.pattern && leaves.length > 0 && nodes.every(e => e.opacity === 1 && !e.blur && !e.effects?.length) && leaves.every(e => (e.kind === 'rectangle' || e.kind === 'path') && !e.gradient && !e.pattern && !e.stroke && JSON.stringify(e.fill?.color) === JSON.stringify(baseFill.fill?.color)) && catalog.artworks.some(a => a.assetIds.length && a.placements.some(p => p.slide === slide.number && p.zIndex < order && Math.min(p.bounds.x + p.bounds.width, placement.x + placement.width) - Math.max(p.bounds.x, placement.x) > 1 && Math.min(p.bounds.y + p.bounds.height, placement.y + placement.height) - Math.max(p.bounds.y, placement.y) > 1))
    if (!eligible && !(inheritedKey && inheritedBackgrounds.has(inheritedKey)) && !mask) continue
    const key = JSON.stringify(appearance(c.scene))
    let art = artKeys.get(key)
    if (!art) {
      art = { id: `art-${c.id}`, name: c.name, kind: recovery || roles.includes('pattern') ? 'pattern' : roles.includes('background') || mask ? 'panel' : 'decoration', scene: structuredClone(c.scene), sourceIds: [], assetIds: [...c.source.assetIds], placements: [], editableParts: !!recovery?.partsQualification?.checks.some(c => c.passed && c.changed && !c.issues.length) }
      catalog.artworks.push(art); artKeys.set(key, art)
    }
    art.sourceIds.push(...c.source.elementIds.filter(id => !art!.sourceIds.includes(id)))
    art.placements.push({ id: c.id, slide: slide.number, width: slide.width, height: slide.height, bounds: { ...placement }, zIndex: Number.isFinite(order) ? order : 0 })
    c.source.elementIds.forEach(id => covered.add(id))
  }
  catalog.artworks.sort((a, b) => a.placements[0].slide - b.placements[0].slide)
  catalog.masters=buildSlideMasters(snapshot,library)
  const presets = new Map<string, BackgroundCatalog['presets'][number]>()
  for (const slide of snapshot.slides) {
    const layers = catalog.artworks.flatMap(a => a.placements.filter(p => p.slide === slide.number).map(p => ({ artworkId: a.id, placementId: p.id, p }))).sort((a, b) => a.p.zIndex - b.p.zIndex)
    const master=catalog.masters[0]
    const selection: BackgroundSelection = { fillId: fillBySlide.get(slide.number) ?? null, layers: layers.map(({ artworkId, placementId }) => ({ artworkId, placementId })),...(master?{masterId:master.id}:{}) }
    if (!selection.fillId && !layers.length&&!master) continue
    const key = JSON.stringify(appearance({ fill: selection.fillId, master:selection.masterId, width: slide.width, height: slide.height, layers: layers.map(l => ({ artworkId: l.artworkId, bounds: l.p.bounds })) }))
    const existing = presets.get(key)
    if (existing) existing.slides.push(slide.number)
    else { const preset = { id: `background-${slide.id}`, slides: [slide.number], width: slide.width, height: slide.height, selection }; catalog.presets.push(preset); presets.set(key, preset) }
  }
  if (fillBySlide.size < snapshot.slides.length) catalog.notes.push('У части слайдов нет явной заливки: прозрачность сохранена.')
  return catalog
}

/** Keep source artwork proportional, anchored as observed, and clipped by the
 * slide. Only the base fill expands independently along both axes. */
export function assembleBackground(catalog: BackgroundCatalog, selection: BackgroundSelection, size: { width: number; height: number }) {
  const { width, height } = size
  if (![width, height].every(n => Number.isFinite(n) && n >= 32 && n <= 8000) || selection.layers.length > 64) throw Error('Недопустимый размер или состав фона')
  const children: ElementIR[] = []
  if (selection.fillId !== null) {
    const fill = catalog.fills.find(f => f.id === selection.fillId)
    if (!fill) throw Error('Заливка не найдена в этой дизайн-системе')
    children.push({ ...structuredClone(fill.element), id: 'background-fill', zIndex: 0, bounds: { x: 0, y: 0, width, height } })
  }
  const seen = new Set<string>()
  for (const [index, layer] of selection.layers.entries()) {
    const art = catalog.artworks.find(a => a.id === layer.artworkId), placement = art?.placements.find(p => p.id === layer.placementId)
    const occurrence = `${layer.artworkId}:${layer.placementId}`
    if (!art || !placement || seen.has(occurrence)) throw Error('Графика фона не найдена или повторяется')
    seen.add(occurrence)
    const b = placement.bounds, k = Math.min(width / placement.width, height / placement.height)
    const anchor = (start: number, extent: number, source: number, target: number) => {
      const after = source - start - extent
      if (start <= after && start < source * .1) return start * k
      if (after < start && after < source * .1) return target - (extent + after) * k
      return (start + extent / 2) / source * target - extent * k / 2
    }
    children.push({ id: `background-art-${index}`, name: art.name, kind: 'group', rotation: 0, opacity: 1, visible: true, zIndex: index + 1, bounds: { x: anchor(b.x, b.width, placement.width, width), y: anchor(b.y, b.height, placement.height, height), width: art.scene.width * k, height: art.scene.height * k }, children: scaled(art.scene.elements, k, `background-${index}`) })
  }
  if(selection.masterId){
    const master=catalog.masters?.find(m=>m.id===selection.masterId)
    if(!master)throw Error('Оформление слайда не найдено в этой дизайн-системе')
    const offset=children.length
    children.push(...assembleSlideMaster(master,size).map((e,i)=>({...e,zIndex:offset+i})))
  }
  return { width, height, elements: [{ id: 'slide-background', name: 'Фон слайда', kind: 'group' as const, bounds: { x: 0, y: 0, width, height }, rotation: 0, opacity: 1, visible: true, zIndex: 0, clipsContent: true, children }] }
}
