import { rulesSchema, type ComponentProfile, type ComponentRules } from '../../lib/component-lab/contract'
import { applyRules } from '../../lib/component-lab/rules'
import { digest } from '../../lib/component-lab/source'
import { googleFontAlternative } from '../../lib/component-lab/font-policy'
import type { FontEvidence } from './measure'
import { loadComponentArtwork } from './artwork'

type FontFile = { family: string; style: string; url: string; unicodeRange?: string }
type LoadedFace = { css: string; hash: string }
const loaded = new Map<string, Promise<LoadedFace | undefined>>()
const weight = (style: string) => /bold/i.test(style) ? 700 : 400
const base64 = (bytes: Uint8Array) => { let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary) }

async function install(family: string, w: number, files: Pick<FontFile, 'url' | 'unicodeRange'>[]): Promise<LoadedFace | undefined> {
  if (!files.length || files.length > 40) return undefined
  // Register a weight only after every advertised subset has loaded.
  const parts = await Promise.all(files.map(async file => {
    const url = new URL(file.url, location.origin)
    if (url.origin !== location.origin) throw Error('Unexpected font origin')
    const response = await fetch(url); if (!response.ok) throw Error('Font file unavailable')
    const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > 8 * 1024 * 1024) throw Error('Font file too large')
    const face = new FontFace(family, bytes, { weight: String(w), style: 'normal', ...(file.unicodeRange ? { unicodeRange: file.unicodeRange } : {}) })
    await face.load()
    const data = base64(bytes), mime = response.headers.get('Content-Type')?.split(';')[0] ?? 'font/woff2'
    return { face, css: `@font-face{font-family:${JSON.stringify(family)};font-weight:${w};font-style:normal;src:url("data:${mime};base64,${data}");${file.unicodeRange ? `unicode-range:${file.unicodeRange};` : ''}}` }
  }))
  parts.forEach(p => document.fonts.add(p.face))
  const css = parts.map(p => p.css).join('\n'); return { css, hash: await digest(css) }
}
async function exactFace(upload: string, family: string, w: number, manifest: FontFile[], googleOnly: boolean, portable: boolean) {
  const key = `${upload}:${family}:${w}:${googleOnly}:${portable}`
  let pending = loaded.get(key)
  if (!pending) {
    pending = (async () => {
      if (!googleOnly) {
        try { const embedded = await install(family, w, manifest.filter(f => f.family === family && !/italic/i.test(f.style) && weight(f.style) === w)); if (embedded) return embedded } catch { /* Try another exact source. */ }
        if (family === 'Play') try { return await install(family, w, [{ url: `/fonts/play/Play-${w === 700 ? 'Bold' : 'Regular'}.ttf` }]) } catch { /* Try the same family from Google. */ }
        if (!portable) try {
          const name = w === 700 ? `${family} Bold` : family, face = new FontFace(family, `local(${JSON.stringify(name)})`, { weight: String(w), style: 'normal' })
          await face.load(); document.fonts.add(face)
          const css = `@font-face{font-family:${JSON.stringify(family)};font-weight:${w};font-style:normal;src:local(${JSON.stringify(name)});}`
          return { css, hash: await digest(css) }
        } catch { /* Probe the exact family before replacing it. */ }
      }
      const query = new URLSearchParams({ family, style: w === 700 ? 'Bold' : 'Regular' }), response = await fetch(`/api/fonts/google?${query}`)
      if (!response.ok) return undefined
      const data = await response.json() as { files: Pick<FontFile, 'url' | 'unicodeRange'>[] }
      return install(family, w, data.files)
    })().catch(() => undefined)
    loaded.set(key, pending)
  }
  const result = await pending
  if (!result) loaded.delete(key)
  return result
}

/** Exact loading for the effective profile. Replacements keep their real names. */
export async function sourceFonts(uploadId: string, p: ComponentProfile, portable = false): Promise<FontEvidence> {
  let manifest: FontFile[] = []
  try { const response = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/fonts`); if (response.ok) manifest = (await response.json() as { fonts: FontFile[] }).fonts } catch { /* Public exact families may still be available. */ }
  const available: string[] = [], css: string[] = [], faces: NonNullable<FontEvidence['faces']> = []
  for (const family of [...new Set(p.fields.map(f => f.font))]) {
    const weights = [...new Set(p.fields.filter(f => f.font === family).map(f => f.weight))]
    const results = await Promise.all(weights.map(w => exactFace(uploadId, family, w, manifest, !!p.fontReplacements?.some(r => r.family === family), portable)))
    if (results.some(r => !r)) continue
    available.push(family)
    results.forEach((r, i) => { css.push(r!.css); faces.push({ family, weight: weights[i], hash: r!.hash }) })
  }
  // The app may also declare the same family in its stylesheet. A loaded
  // binary face alone does not settle those lazy CSS faces: FontFaceSet.check
  // remains false until every matching face has been requested explicitly.
  await Promise.all(p.fields.filter(f => available.includes(f.font)).map(f =>
    document.fonts.load(`${f.weight} ${f.size}px ${JSON.stringify(f.font)}`, 'ABC абв 012').catch(() => []),
  ))
  await document.fonts.ready
  return { css: css.join('\n'), available, faces, ...(p.artwork ? { artwork: await loadComponentArtwork(p) } : {}) }
}

/** Resolve once and persist the explicit mapping. A saved replacement does not
 * silently change back if an original font appears on another computer. */
export async function resolveComponentFonts(upload: string, source: ComponentProfile, input: ComponentRules, options: { portable?: boolean } = {}) {
  let rules = rulesSchema.parse(input), profile = await applyRules(source, rules), fonts = await sourceFonts(upload, profile, options.portable)
  const replacements = [...rules.fontReplacements ?? []]
  for (const family of [...new Set(source.fields.map(f => f.font))]) {
    if (replacements.some(r => r.source === family) || fonts.available.includes(family)) continue
    const replacement = googleFontAlternative(family); if (!replacement || replacement === family) continue
    const next = { ...rules, fontReplacements: [...replacements, { source: family, family: replacement }] }, candidate = await applyRules(source, next), loaded = await sourceFonts(upload, candidate, options.portable)
    if (!loaded.available.includes(replacement)) continue
    replacements.push({ source: family, family: replacement }); rules = next; profile = candidate; fonts = loaded
  }
  return { rules, profile, fonts }
}
