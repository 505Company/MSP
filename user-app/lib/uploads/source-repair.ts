import { z } from 'zod'
import { contentHash } from '../design-system/catalog'
import { unavailableSourceSlides } from '../design-system/source-availability'
import { decodeDataUrl, parseSourceSnapshot, validateImageSignature, validateVisualManifest, type VisualManifest } from '../digital-designer/visual-package'
import { sha256 } from './pptx-profiler'
import { assertUploadActive } from './cancellation-server'
import { SOURCE_REPAIR_VERSION, type SourceRepairStatus } from './source-repair-contract'
import type { PublicProcessingJob } from './processing-jobs'
import {prepareSourceRefresh,publishSourceRefresh,assertSourceRefreshIdle} from './source-refresh'

const json = { httpMetadata: { contentType: 'application/json' } }
const manifestKey = (id: string) => `visual/${id}/manifest.json`
const repairPrefix = (id: string, revision: string) => `source-repairs/${id}/${SOURCE_REPAIR_VERSION}/${revision}`
const patchSchema = z.object({ version: z.literal(SOURCE_REPAIR_VERSION), revision: z.string().regex(/^[a-f0-9]{64}$/), snapshot: z.unknown(),
  refresh:z.boolean().optional(),
  assets: z.array(z.object({ id: z.string().regex(/^asset-[a-f0-9]{24}$/), base64: z.string().max(12000000).regex(/^[A-Za-z0-9+/]+=*$/) })).max(2000),
  previews: z.array(z.object({ id: z.string(), dataUrl: z.string().max(3000000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/) })).max(100) })

export async function readSourceRepairStatus(bucket: R2Bucket, id: string, refresh=false): Promise<SourceRepairStatus | null> {
  const file = await bucket.get(manifestKey(id)); if (!file) return null
  const manifest = await file.json<VisualManifest>(), revision = await contentHash(manifest.snapshot)
  if(refresh){
    const pendingFile=await bucket.get(`source-repairs/${id}/refresh-pending.json`),pending=pendingFile?await pendingFile.json<{revision:string;afterRevision:string}>():null
    if(pending?.afterRevision===revision&&!await bucket.head(`${repairPrefix(id,pending.revision)}/receipt.json`))return {version:SOURCE_REPAIR_VERSION,revision:pending.revision,name:manifest.snapshot.name,slides:manifest.snapshot.slides.map(s=>s.number),knownAssetIds:manifest.assets.map(a=>a.id),needed:true}
  }
  const slides = refresh?manifest.snapshot.slides.map(s=>s.number):unavailableSourceSlides(manifest.snapshot).map(s => s.number)
  return { version: SOURCE_REPAIR_VERSION, revision, name: manifest.snapshot.name, slides, knownAssetIds: manifest.assets.map(a => a.id),
    needed: /\.pptx$/i.test(manifest.snapshot.name) && slides.length > 0 && (refresh?manifest.renderer!=='msp-web-2026-09-29':!await bucket.head(`${repairPrefix(id, revision)}/receipt.json`)) }
}

/** Display the resolved blocker without restarting a paused, billable job or
 * overwriting its historical failure. Used by both progress endpoints. */
export async function sourceRecoveryView(bucket: R2Bucket, view: PublicProcessingJob): Promise<PublicProcessingJob> {
  if (view.status !== 'blocked' || view.error !== 'Сначала требуется завершить чтение исходных слайдов.') return view
  const source = await readSourceRepairStatus(bucket,view.id)
  if (!source || source.slides.length) return view
  const file = await bucket.get(`${repairPrefix(view.id,source.revision)}/receipt.json`)
  if (!file) return view
  const receipt = await file.json<{at:number}>()
  return { ...view, updatedAt:Math.max(view.updatedAt,receipt.at),error:'Исходные слайды восстановлены. Продолжите сборку с сохранённого этапа.',
    progress:{step:'analysis',scope:'source-repaired',detail:'Чтение исходника завершено. Можно продолжить анализ.'} }
}

/** Only formerly incomplete pages can change. Successful pages and original
 * model replies remain untouched. A rejected/failed reread keeps old evidence. */
export async function repairSourcePages(bucket: R2Bucket, id: string, raw: unknown) {
  await assertUploadActive(bucket, id)
  const patch = patchSchema.parse(raw), parsed = parseSourceSnapshot(patch.snapshot)
  const file = await bucket.get(manifestKey(id)); if (!file) throw Error('Исходные слайды не найдены')
  const current = await file.json<VisualManifest>(), revision = await contentHash(current.snapshot)
  const prefix = repairPrefix(id, patch.revision), previous = await bucket.get(`${prefix}/receipt.json`)
  if (previous) { const receipt = await previous.json<{ repaired: number[]; remaining: number[]; revision: string; catalogs?:Awaited<ReturnType<typeof publishSourceRefresh>> }>(); if (receipt.revision === revision) return receipt }
  if(patch.refresh){
    await assertSourceRefreshIdle(bucket,id)
    const file=await bucket.get(`${prefix}/pending.json`),pending=file?await file.json<{revision:string;patchHash:string;replay:Awaited<ReturnType<typeof prepareSourceRefresh>>;receipt:{version:string;repaired:number[];remaining:number[];revision:string;at:number}}>() : null
    if(pending?.revision===revision){
      if(pending.patchHash!==await contentHash(parsed))throw Error('Повторное чтение не совпадает с сохранённым обновлением')
      const catalogs=await publishSourceRefresh(bucket,id,current.snapshot,pending.replay),receipt={...pending.receipt,catalogs}
      await bucket.put(`${prefix}/receipt.json`,JSON.stringify(receipt),json)
      await bucket.put(`${repairPrefix(id,revision)}/receipt.json`,JSON.stringify(receipt),json)
      return receipt
    }
  }
  if (revision !== patch.revision) throw Error('Исходник изменился. Повторите чтение состояния.')
  const selected = new Set((patch.refresh?current.snapshot.slides:unavailableSourceSlides(current.snapshot)).map(s => s.number))
  if (!selected.size || parsed.sourceId !== current.snapshot.sourceId || parsed.slideCount !== current.snapshot.slideCount || parsed.name !== current.snapshot.name ||
    parsed.slides.length !== selected.size || new Set(parsed.slides.map(s => s.number)).size !== selected.size || parsed.slides.some(s => !selected.has(s.number)) || parsed.elements.some(e => !selected.has(e.slide))) throw Error('Повторное чтение не соответствует исходным слайдам')
  for (const slide of parsed.slides) {
    const old = current.snapshot.slides.find(s => s.number === slide.number)!
    if (['id', 'part', 'text', 'width', 'height'].some(key => slide[key as keyof typeof slide] !== old[key as keyof typeof old])) throw Error('Повторное чтение изменило исходное содержание слайда')
  }
  const incomplete = new Set(unavailableSourceSlides(parsed).map(s => s.number))
  const repaired = parsed.slides.filter(s => !incomplete.has(s.number) && patch.previews.some(p => p.id === s.id)).map(s => s.number), accepted = new Set(repaired)
  const elements = current.snapshot.slides.flatMap(s => (accepted.has(s.number) ? parsed : current.snapshot).elements.filter(e => e.slide === s.number))
  const used = new Set(elements.flatMap(e => typeof e.properties.assetId === 'string' ? [e.properties.assetId] : []))
  const assets = [...current.snapshot.assets]
  for (const asset of parsed.assets.filter(a => used.has(a.id))) {
    const old = assets.find(a => a.id === asset.id)
    if (old && (old.mime !== asset.mime || old.byteLength !== asset.byteLength)) throw Error('Исходный ресурс изменился')
    if (!old) assets.push(asset)
  }
  const metadata = [...current.assets], additions: { id: string; mime: string; bytes: Uint8Array }[] = [], previews: { id: string; mime: string; bytes: Uint8Array }[] = []
  for (const a of assets.filter(a => !current.assets.some(old => old.id === a.id))) {
    const supplied = patch.assets.filter(p => p.id === a.id)
    if (supplied.length !== 1) throw Error('Ресурс повторного чтения не передан')
    const bytes = Uint8Array.from(atob(supplied[0].base64), c => c.charCodeAt(0))
    if (bytes.length !== a.byteLength || `asset-${(await sha256(bytes)).slice(0,24)}` !== a.id) throw Error('Ресурс повторного чтения повреждён')
    validateImageSignature(bytes, a.mime)
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/octet-stream': 'bin' } as Record<string,string>)[a.mime]
    if (!extension) throw Error('Неизвестный формат ресурса')
    metadata.push({ id: a.id, mime: a.mime, extension, origins: a.origins }); additions.push({ id: a.id, mime: a.mime, bytes })
  }
  for (const number of repaired) {
    const slide = parsed.slides.find(s => s.number === number)!, supplied = patch.previews.filter(p => p.id === slide.id)
    if (supplied.length !== 1) throw Error('Неверное превью повторного чтения')
    const decoded = decodeDataUrl(supplied[0].dataUrl); validateImageSignature(decoded.bytes, decoded.mime)
    previews.push({ id: slide.id, ...decoded })
  }
  // The failed reader never completed its style inventory. Recompute measured
  // usage from the merged native records, using the importer's same semantics.
  const colors = new Map<string,number>(), fonts = new Map<string,{sizes:Set<number>;occurrences:number}>()
  const collect = (value: unknown) => { if (!value || typeof value !== 'object') return; const o = value as Record<string,unknown>
    if (['r','g','b'].every(k => typeof o[k] === 'number' && Number(o[k]) >= 0 && Number(o[k]) <= 1)) { const hex = '#' + ['r','g','b'].map(k => Math.round(Number(o[k])*255).toString(16).padStart(2,'0')).join('').toUpperCase(); colors.set(hex,(colors.get(hex)??0)+1) }
    else for (const child of Object.values(o)) collect(child)
  }
  for (const e of elements.filter(e => e.kind !== 'source-picture')) {
    collect(e.properties)
    if (e.kind === 'text') {
      const perElement = new Map<string,Set<number>>()
      for (const r of [e.properties,...Array.isArray(e.properties.styleRuns)?e.properties.styleRuns:[]]) if (typeof r.fontFamily === 'string' && typeof r.fontSize === 'number') { const sizes = perElement.get(r.fontFamily)??new Set<number>(); sizes.add(r.fontSize); perElement.set(r.fontFamily,sizes) }
      for (const [family,sizes] of perElement) { const f = fonts.get(family)??{sizes:new Set<number>(),occurrences:0}; sizes.forEach(size=>f.sizes.add(size)); f.occurrences++; fonts.set(family,f) }
    }
  }
  if(patch.refresh&&(incomplete.size||repaired.length!==selected.size))throw Error('Повторное чтение не завершено; прежняя версия сохранена')
  const merged = repaired.length ? validateVisualManifest({ ...current,...(patch.refresh?{renderer:'msp-web-2026-09-29'}:{}), assets: metadata, previews: [...current.previews.filter(p => !previews.some(n => n.id === p.id)),...previews.map(({id,mime})=>({id,mime}))],
    snapshot: { ...current.snapshot, slides: current.snapshot.slides.map(s => accepted.has(s.number) ? parsed.slides.find(p => p.number === s.number)! : s), elements, assets,
      colors: [...colors].sort((a,b)=>b[1]-a[1]).map(([hex,occurrences])=>({hex,occurrences})), fonts: [...fonts].map(([family,f])=>({family,sizes:[...f.sizes].sort((a,b)=>a-b),occurrences:f.occurrences})) } }, current.snapshot.sourceId) : current
  const replay=patch.refresh?await prepareSourceRefresh(bucket,id,current.snapshot,merged.snapshot):null
  const nextRevision = await contentHash(merged.snapshot), receipt = { version: SOURCE_REPAIR_VERSION, repaired, remaining: [...selected].filter(n => !accepted.has(n)), revision: nextRevision, at: Date.now() }
  await bucket.put(`${prefix}/before.json`,JSON.stringify(current),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  if(replay){
    await bucket.put(`${prefix}/pending.json`,JSON.stringify({revision:nextRevision,patchHash:await contentHash(parsed),replay,receipt}),{...json,onlyIf:{etagDoesNotMatch:'*'}})
    await bucket.put(`source-repairs/${id}/refresh-pending.json`,JSON.stringify({revision,afterRevision:nextRevision}),json)
  }
  for (const a of additions) await bucket.put(`visual/${id}/${a.id}`, a.bytes, { httpMetadata:{contentType:a.mime},onlyIf:{etagDoesNotMatch:'*'} })
  for (const p of previews){
    const before=await bucket.get(`visual/${id}/preview-${p.id}`)
    if(before)await bucket.put(`${prefix}/preview-${p.id}`,new Uint8Array(await before.arrayBuffer()),{httpMetadata:{contentType:current.previews.find(v=>v.id===p.id)?.mime??p.mime},onlyIf:{etagDoesNotMatch:'*'}})
    await bucket.put(`visual/${id}/preview-${p.id}`,p.bytes,{httpMetadata:{contentType:p.mime}})
  }
  await assertUploadActive(bucket,id)
  if (repaired.length && !await bucket.put(manifestKey(id),JSON.stringify(merged),{...json,onlyIf:{etagMatches:file.etag}})) throw Error('Исходник изменился во время восстановления')
  const catalogs=replay?await publishSourceRefresh(bucket,id,merged.snapshot,replay):undefined
  const completed={...receipt,...(catalogs?{catalogs}:{})}
  await bucket.put(`${prefix}/receipt.json`,JSON.stringify(completed),json)
  if (nextRevision !== revision) await bucket.put(`${repairPrefix(id,nextRevision)}/receipt.json`,JSON.stringify(completed),json)
  return completed
}
