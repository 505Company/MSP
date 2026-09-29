import type { EditableTemplate } from '../../lib/design-system/editable-contract'
import type { CatalogComponent } from '../../lib/design-system/catalog-types'
import type { ReconstructionState } from '../../lib/design-system/reconstruction-contract'
import { renderEditableHtml } from '../../lib/design-system/editable-render'
import { hydrateEditableHtml } from '../../lib/design-system/editable-hydrate'
import { buildGraphicSystem } from '../../lib/design-system/graphic-components'
import { graphicHtml } from '../../lib/design-system/diagram-graph'
import { loadPresentationReader } from '../../lib/digital-designer/browser-loader'
import { ensureUploadFonts } from '../fonts'

export type OriginalPreview = { id: string; name: string; slide: number; node: HTMLElement; warnings: string[]; reconstructed?: boolean }

async function htmlPreview(upload: string, html: string) {
  await ensureUploadFonts(upload)
  const node = document.createElement('div')
  node.dataset.originalPreview = 'true'; node.style.width = '800px'; node.innerHTML = html
  const issues = await hydrateEditableHtml(node)
  const warnings = JSON.parse(node.dataset.fontWarnings ?? '[]') as string[]
  return { node, warnings: [...issues, ...warnings] }
}

/** Original geometry is a viewable source, never an adaptive profile or a proof. */
export async function editableOriginal(upload: string, template: EditableTemplate): Promise<OriginalPreview> {
  const preview = await htmlPreview(upload, renderEditableHtml(template))
  if (template.dataStatus === 'estimated') preview.warnings.push('Числа в этом образце восстановлены по изображению приблизительно.')
  return { id: template.id, name: template.name, slide: template.slide, reconstructed: !template.sourceLayout && !template.sourceInline, ...preview }
}

/** Older native and reconstructed cards use the same entry screen. Resolve the
 * exact ID; never substitute a neighbouring card when a stale link is opened. */
export async function otherOriginal(upload: string, id: string, signal: AbortSignal): Promise<OriginalPreview | undefined> {
  const base = `/api/uploads/${encodeURIComponent(upload)}`
  const reconstruction = await fetch(`${base}/reconstruction`, { signal })
  if (reconstruction.ok) {
    const state = await reconstruction.json() as ReconstructionState
    const part = buildGraphicSystem({ results: state.results ?? [] }).components.find(c => c.id === id)
    if (part) return { id, name: part.name, slide: part.source.slide, reconstructed: true, ...await htmlPreview(upload, graphicHtml(part.scene.elements, part.scene.width, part.scene.height, upload)) }
  }
  const response = await fetch(`${base}/catalog/${encodeURIComponent(id)}`, { signal })
  if (!response.ok) return undefined
  const { component } = await response.json() as CatalogComponent
  if (component.id !== id) return undefined
  await ensureUploadFonts(upload)
  const resources = await Promise.all(component.source.assetIds.map(async id => {
    const response = await fetch(`${base}/assets/${encodeURIComponent(id)}`, { signal })
    if (!response.ok) throw Error('Исходное изображение недоступно')
    return { id, bytes: new Uint8Array(await response.arrayBuffer()) }
  }))
  signal.throwIfAborted()
  const reader = await loadPresentationReader(), report = await reader.renderComponent(component, {}, resources)
  if (!report.dataUrl) throw Error('Не удалось показать исходный компонент')
  const node = document.createElement('div'), img = document.createElement('img')
  node.dataset.originalPreview = 'true'; node.style.width = '800px'
  img.src = report.dataUrl; img.alt = component.name; img.style.width = '100%'; img.style.display = 'block'
  await img.decode(); node.appendChild(img)
  return { id, name: component.name, slide: component.source.slide, node, warnings: report.issues.map(i => i.message) }
}
