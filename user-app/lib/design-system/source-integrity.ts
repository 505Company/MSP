import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { SourceSnapshot } from '../digital-designer/source-types'
import { unavailableSourceSlides } from './source-availability'
import type { SourceIntegrity } from './quality-audit-contract'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const resolve = (part: string, target: string) => {
  const segments = (target.startsWith('/') ? target.slice(1) : part.slice(0, part.lastIndexOf('/') + 1) + target).split('/'), result: string[] = []
  for (const p of segments) { if (p === '..') result.pop(); else if (p && p !== '.') result.push(p) }
  return result.join('/')
}
/** Compare the ZIP's actually referenced media, including shape fills and
 * inherited layers. An inventory made from imported assets cannot detect loss. */
export async function auditSourceIntegrity(bytes: Uint8Array, snapshot: SourceSnapshot): Promise<SourceIntegrity> {
  const incompleteSlides = unavailableSourceSlides(snapshot).map(s => s.number)
  if (!/\.pptx$/i.test(snapshot.name)) return { status: 'unavailable', resources: 0, missing: [], incompleteSlides, reason: 'Для этого формата нет независимой проверки ресурсов PPTX' }
  const zip = await JSZip.loadAsync(bytes), media = new Map<string, Set<number>>()
  for (const slide of snapshot.slides) {
    const queue = [slide.part], visited = new Set<string>()
    while (queue.length) {
      const part = queue.shift()!
      if (visited.has(part)) continue
      visited.add(part)
      const entry = zip.file(part)
      if (!entry) continue
      const xml = await entry.async('string')
      if (xml.length > 8_000_000 || visited.size > 256) throw Error('Слишком большой пакет для независимой проверки ресурсов')
      const slash = part.lastIndexOf('/'), relationships = zip.file(part.slice(0, slash + 1) + '_rels/' + part.slice(slash + 1) + '.rels')
      if (!relationships) continue
      const value = parser.parse(await relationships.async('string'))?.Relationships?.Relationship
      const refs = new Set([...xml.matchAll(/\br:(?:embed|link|id)\s*=\s*["']([^"']+)["']/g)].map(m => m[1]))
      for (const r of (Array.isArray(value) ? value : value ? [value] : []) as Record<string,string>[]) {
        if (r['@_TargetMode'] === 'External') continue
        const type = r['@_Type'] ?? '', target = resolve(part, r['@_Target'] ?? '')
        if (/\/(slideLayout|slideMaster)$/.test(type)) { queue.push(target); continue }
        if (!refs.has(r['@_Id'])) continue
        if (/\/image$/.test(type)) { const slides = media.get(target) ?? new Set<number>(); slides.add(slide.number); media.set(target, slides) }
        else if (/\/(chart|diagramData|diagramDrawing|diagramLayout)$/.test(type) && target.endsWith('.xml')) queue.push(target)
      }
    }
  }
  const imported = new Set(snapshot.assets.flatMap(a => a.origins))
  return { status: 'checked', resources: media.size, incompleteSlides, missing: [...media].filter(([path]) => !imported.has(path)).map(([path, slides]) => ({ path, slides: [...slides] })) }
}
