import type { LayoutInput } from '../lib/presentations/layout-contract'

type Loaded = { available: boolean; css: string }
const loaded = new Map<string, Promise<Loaded>>()
type FontFile = { family: string; style: string; url: string; unicodeRange?: string }
const weight = (style: string) => /semibold|semi bold|demi/i.test(style) ? '600' : /bold/i.test(style) ? '700' : '400'
const base64 = (bytes: Uint8Array) => { let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary) }

/** Recipe fonts never invoke the importer's substitution policy. */
export async function prepareLayoutFonts(input: Pick<LayoutInput, 'uploadId' | 'fonts'>) {
  // An immutable run reuses its loaded faces across every candidate and slide.
  // Read the manifest only when an actual font load is needed.
  let manifest: {fonts:FontFile[]}|undefined
  const fontTokens: string[] = [], css: Record<string, string> = {}
  for (const token of input.fonts) {
    const key = `${input.uploadId}:${token.family}`
    let pending = loaded.get(key)
    if (!pending) {
      if(!manifest){const response=await fetch(`/api/uploads/${input.uploadId}/fonts`);if(!response.ok)throw Error('FONT_TOKEN_UNAVAILABLE: не удалось прочитать шрифты дизайн-системы.');manifest=await response.json() as {fonts:FontFile[]}}
      const files=manifest.fonts
      pending = (async () => {
        const rules: string[] = [], weights = new Set<string>()
        const install = async (file: FontFile) => {
          const r = await fetch(file.url); if (!r.ok) return
          const bytes = new Uint8Array(await r.arrayBuffer()), w = weight(file.style)
          const face = new FontFace(token.family, bytes, { weight: w, ...(file.unicodeRange ? { unicodeRange: file.unicodeRange } : {}) })
          await face.load(); document.fonts.add(face); weights.add(w)
          rules.push(`@font-face{font-family:${JSON.stringify(token.family)};font-weight:${w};font-style:normal;src:url("data:${r.headers.get('Content-Type') ?? 'font/woff2'};base64,${base64(bytes)}");${file.unicodeRange ? `unicode-range:${file.unicodeRange};` : ''}}`)
        }
        for (const file of files.filter(f => f.family === token.family && !/italic/i.test(f.style))) { try { await install(file) } catch { /* Try the exact family from the public font cache next. */ } }
        if (token.family === 'Play') for (const style of ['Regular', 'Bold']) if (!weights.has(weight(style))) await install({ family: 'Play', style, url: `/fonts/play/Play-${style}.ttf` })
        if (!weights.size) {
          try {
            const face = new FontFace(token.family, `local(${JSON.stringify(token.family)})`, { weight: '400' })
            await face.load(); document.fonts.add(face); weights.add('400')
            rules.push(`@font-face{font-family:${JSON.stringify(token.family)};src:local(${JSON.stringify(token.family)});font-weight:400;}`)
          } catch { /* A missing original is not permission to choose a different family. */ }
        }
        if (!weights.size || !weights.has('600') && !weights.has('700')) for (const style of ['Regular', 'SemiBold']) {
          if (weights.has(weight(style))) continue
          const q = new URLSearchParams({ family: token.family, style })
          const r = await fetch(`/api/fonts/google?${q}`); if (!r.ok) continue
          const data = await r.json() as { files: Array<{ url: string; unicodeRange?: string }> }
          for (const file of data.files) await install({ ...file, family: token.family, style })
        }
        return { available: weights.size > 0, css: rules.join('\n') }
      })().catch(() => ({ available: false, css: '' }))
      loaded.set(key, pending)
    }
    const result = await pending
    if (result.available) { fontTokens.push(token.id); css[token.id] = result.css }
    else loaded.delete(key)
  }
  await document.fonts.ready
  if (!fontTokens.length) throw Error('FONT_TOKEN_UNAVAILABLE: исходные шрифты недоступны. Выберите другой стиль или установите шрифт шаблона.')
  return { fontTokens, css }
}
