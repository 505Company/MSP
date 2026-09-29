import type { ComponentProfile } from '../../lib/component-lab/contract'
import { assetReferences, safeGraphic } from '../../lib/component-lab/artwork'
import { digest } from '../../lib/component-lab/source'

export type ArtworkResource = { hash: string; url: string; assets: { url: string; hash: string }[] }
const encode = (bytes: Uint8Array) => { let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary) }
const cache = new Map<string, Promise<ArtworkResource>>()
/** Freeze the exact original artwork bytes before the first measurement. The
 * containing SVG is scaled uniformly; embedded masks/crops remain untouched. */
export async function loadComponentArtwork(p: ComponentProfile): Promise<ArtworkResource | undefined> {
  if (!p.artwork) return
  const art = p.artwork
  if (!safeGraphic(art.svg) || await digest(art.svg) !== art.hash) throw Error('component-artwork-invalid')
  let pending = cache.get(art.hash)
  if (!pending) {
    pending = (async () => {
      let svg = art.svg
      const assets: ArtworkResource['assets'] = []
      for (const url of assetReferences(svg)) {
        const response = await fetch(url)
        if (!response.ok) throw Error('component-image-unavailable')
        const bytes = new Uint8Array(await response.arrayBuffer()), mime = response.headers.get('content-type')?.split(';')[0]
        if (!bytes.length || bytes.length > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(mime ?? '')) throw Error('component-image-format')
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
        assets.push({ url, hash }); svg = svg.split(`href="${url}"`).join(`href="data:${mime};base64,${encode(bytes)}"`)
      }
      const url = `data:image/svg+xml;base64,${encode(new TextEncoder().encode(svg))}`, image = new Image(); image.src = url; await image.decode()
      return { hash: art.hash, url, assets }
    })()
    cache.set(art.hash, pending)
  }
  try { return await pending } catch (e) { cache.delete(art.hash); throw e }
}
