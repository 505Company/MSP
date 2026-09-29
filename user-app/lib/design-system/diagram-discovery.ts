import { flatten } from './compiler'
import { nativeDiagramGraph } from './diagram-native'
import type { SourceScene } from './source-scene'
import type { ComponentLibrary } from './types'
import type { DiagramGraph } from './diagram-graph'

/** Recover a whole native graph even when semantic recognition split its blocks
 * into cards. Only observed connectors establish relationships; proximity alone
 * never turns a row of cards into a diagram. */
export function discoverNativeDiagrams(scene: SourceScene, library: ComponentLibrary, existing: DiagramGraph[], instructionIds: string[] = []) {
  const omitted = new Set([...instructionIds, ...library.components.filter(c => c.semantics.some(s => ['background', 'title', 'logo', 'footer', 'page-number'].includes(s.role))).flatMap(c => c.source.elementIds)])
  const covered = new Set(existing.flatMap(g => g.sourceIds)), found: { slide: number; graph: DiagramGraph }[] = []
  for (const slide of scene.slides) {
    const roots = [...scene.records.values()].filter(r => {
      if (r.source.slide !== slide.number || r.ancestors.length || r.disposition !== 'visible' || r.element.name === 'Slide background') return false
      const leaves = flatten([r.element]).filter(e => !('children' in e))
      return !leaves.some(e => omitted.has(e.id) || covered.has(e.id))
    })
    if (roots.length < 3 || roots.length > 250) continue
    const graph = nativeDiagramGraph(scene, roots.map(r => r.element.id))
    if (!graph || !graph.edges.some(e => e.arrow !== 'none')) continue
    const connected = new Set(graph.edges.flatMap(e => [e.from.nodeId, e.to.nodeId]))
    if (graph.nodes.some(n => n.kind === 'block' && !connected.has(n.id))) continue
    found.push({ slide: slide.number, graph })
  }
  return found
}
