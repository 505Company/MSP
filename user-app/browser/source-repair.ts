import { loadPresentationReader } from '../lib/digital-designer/browser-loader'
import type { SourceRepairPatch, SourceRepairStatus } from '../lib/uploads/source-repair-contract'

/** Reread only incomplete pages with the current importer. Used by the normal
 * background job before any model call; new assets are sent once by hash. */
export async function repairIncompleteSource(uploadId: string, signal: AbortSignal, report: (message: string) => void) {
  const endpoint = `/api/uploads/${uploadId}/source-repair`, statusResponse = await fetch(endpoint,{signal,cache:'no-store'})
  if (!statusResponse.ok) throw Error('Не удалось проверить исходные слайды')
  const status = await statusResponse.json() as SourceRepairStatus | null
  if (!status?.needed) return null
  report(`Повторно читаем исходные слайды: ${status.slides.join(', ')}`)
  const response = await fetch(`/api/uploads/${uploadId}/source`,{signal,cache:'no-store'})
  if (!response.ok) throw Error('Не удалось прочитать сохранённый PPTX')
  const reader = await loadPresentationReader(), bytes = new Uint8Array(await response.arrayBuffer())
  const reread = await reader.rereadSourceSlides(bytes,status.name,status.slides,signal)
  signal.throwIfAborted()
  const known = new Set(status.knownAssetIds)
  const encode = (bytes: Uint8Array) => { let binary = ''; for(let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(binary) }
  const patch: SourceRepairPatch = { version:status.version, revision:status.revision, snapshot:reread.snapshot,
    assets:reread.assets.filter(a=>!known.has(a.id)).map(a=>({id:a.id,base64:encode(a.bytes)})), previews:reread.previews }
  const saved = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal})
  const result = await saved.json() as { repaired:number[];remaining:number[];error?:string }
  if (!saved.ok) throw Error(result.error??'Не удалось сохранить восстановленные слайды')
  report(result.remaining.length ? `Восстановлено слайдов: ${result.repaired.length}. Остальные отмечены как пропущенные; продолжаем анализ.` : `Исходные слайды восстановлены: ${result.repaired.length}`)
  return result
}
