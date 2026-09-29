import { instantiateComponent } from '@/lib/design-system/compiler'
import {ensureUploadFonts} from '@/browser/fonts'
import { loadPresentationReader } from '@/lib/digital-designer/browser-loader'
import type { CatalogComponent } from '@/lib/design-system/catalog-types'
import type { RenderReport } from '@/lib/design-system/types'

export type ComponentPreview = { definition: CatalogComponent; report: RenderReport }

/** A cache scoped to this catalog view. Render at most three visible tiles
 * together, and cancel pending I/O when the user leaves the view. */
export function createComponentPreviews(uploadId: string, catalogId?: string) {
  const controller = new AbortController()
  const previews = new Map<string, Promise<ComponentPreview>>()
  const assets = new Map<string, Promise<{ id: string; bytes: Uint8Array }>>()
  const waiting: (() => void)[] = []
  let running = 0, users = 0
  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= 3) await new Promise<void>(resolve => waiting.push(resolve))
    else running++
    try { controller.signal.throwIfAborted(); return await task() }
    finally { const next = waiting.shift(); if (next) next(); else running-- }
  }
  async function load(id: string) {
    const response = await fetch('/api/uploads/' + uploadId + '/catalog/' + id, { signal: controller.signal })
    if (!response.ok) throw new Error('Не удалось загрузить компонент')
    const definition = await response.json() as CatalogComponent
    if (catalogId && definition.catalogId !== catalogId) throw new Error('Каталог обновился. Откройте страницу заново.')
    const resources = await Promise.all(definition.component.source.assetIds.map(id => {
      let pending = assets.get(id)
      if (!pending) {
        pending = fetch('/api/uploads/' + uploadId + '/assets/' + id, { signal: controller.signal }).then(async response => {
          if (!response.ok) throw new Error('Исходное изображение недоступно')
          return { id, bytes: new Uint8Array(await response.arrayBuffer()) }
        }).catch(error => { assets.delete(id); throw error })
        assets.set(id, pending)
      }
      return pending
    }))
    controller.signal.throwIfAborted()
    return { definition, resources }
  }
  async function render(id: string, values: Record<string, string> = {}): Promise<ComponentPreview> {
    await ensureUploadFonts(uploadId)
    const { definition, resources } = await load(id), reader = await loadPresentationReader()
    return { definition, report: await reader.renderComponent(definition.component, values, resources) }
  }
  return {
    render(id: string, values: Record<string, string>) { return run(() => render(id, values)) },
    async exportPptx(id: string, values: Record<string, string>) {
      const { definition, resources } = await load(id), reader = await loadPresentationReader()
      return reader.exportNewSlide({ ...definition.component, scene: instantiateComponent(definition.component, values) }, resources)
    },
    get(id: string) {
      let pending = previews.get(id)
      if (!pending) {
        pending = run(() => render(id)).catch(error => { previews.delete(id); throw error })
        previews.set(id, pending)
        if (previews.size > 48) previews.delete(previews.keys().next().value!)
      }
      return pending
    },
    retain() {
      users++
      return () => { users--; queueMicrotask(() => { if (!users) controller.abort() }) }
    },
  }
}
export type ComponentPreviews = ReturnType<typeof createComponentPreviews>
