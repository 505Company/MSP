import type { EditableTemplate } from '../design-system/editable-contract'
import { nativeBoundText } from '../design-system/editable-native-layout'
import type { ComponentContent, ComponentProfile } from './contract'
import { assetReferences, combinedGraphic } from './artwork'
import { digest, sourceGraphicLayers } from './source'
import { sourceUnitScale } from './metric-unit'

export type AssetIdentity = { url: string; hash: string }
export type SourceFidelity = { version: 'source-properties-1'; status: 'preserved' | 'failed'; sourceHash: string; issues: string[]; changes: string[]; artistic: 'not-reviewed' }
export async function originalAssets(bucket: R2Bucket, upload: string, p: ComponentProfile): Promise<AssetIdentity[]> {
  return Promise.all(assetReferences(p.artwork?.svg ?? '').map(async url => {
    const prefix = `/api/uploads/${upload}/assets/`
    if (!url.startsWith(prefix)) throw Error('Иллюстрация относится к другой библиотеке.')
    const file = await bucket.get(`visual/${upload}/${url.slice(prefix.length)}`)
    if (!file) throw Error('Исходное изображение недоступно.')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
    return { url, hash }
  }))
}
const hex = (color: { r: number; g: number; b: number }) => '#' + [color.r, color.g, color.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

/** Property fidelity allows reflow, padding and bounded type normalization. It
 * is deliberately separate from artistic review and pixel-identical copying.
 * Checks use native source runs/artwork, not the browser's claimed result. */
export async function auditSourceFidelity(template: EditableTemplate, p: ComponentProfile, content: ComponentContent): Promise<SourceFidelity> {
  const issues: string[] = [], changes: string[] = [], sizes: { source: number; adapted: number; id: string }[] = []
  const native = template.sourceLayout?.text.map(s => nativeBoundText(s, template.data)) ?? []
  const assigned = new Map<string, string[]>()
  for (const f of p.fields) {
    const e = native.find(e => f.id === e.id || f.id.startsWith(`${e.id}--paragraph-`)), value = content[f.id]
    if (!e || !value) { issues.push(`missing-native-field:${f.id}`); continue }
    const start = e.text.indexOf(value)
    if (start < 0 || e.text.indexOf(value, start + 1) >= 0) { issues.push(`ambiguous-source-range:${f.id}`); continue }
    const run = e.styleRuns?.find(r => r.start <= start && r.end > start), paint = e.colorRuns?.find(r => r.start <= start && r.end > start)?.fill.color
    const font = run?.fontFamily ?? e.fontFamily, style = run?.fontStyle ?? e.fontStyle ?? 'Regular', size = run?.fontSize ?? e.fontSize
    const replacement = p.fontReplacements?.find(r => r.source === font && r.family === f.font)
    if (f.font !== font && !replacement || f.weight !== (/bold/i.test(style) ? 700 : 400) || f.italic !== /italic|oblique/i.test(style)) issues.push(`source-typeface:${f.id}`)
    if (!paint || f.color.toLowerCase() !== hex(paint)) issues.push(`source-color:${f.id}`)
    if (f.role === 'number' && f.unitScale !== sourceUnitScale(e)) issues.push(`source-unit-scale:${f.id}`)
    if (replacement) changes.push(`font:${font}→${f.font}`)
    sizes.push({ source: size, adapted: f.size, id: f.id }); assigned.set(e.id, [...assigned.get(e.id) ?? [], value])
  }
  for (const e of native) if ((assigned.get(e.id) ?? []).join('').replace(/\s/g, '') !== e.text.replace(/\s/g, '')) issues.push(`source-text-coverage:${e.id}`)
  for (let i = 0; i < sizes.length; i++) for (let j = i + 1; j < sizes.length; j++) {
    const a = sizes[i], b = sizes[j]
    if (Math.abs(a.source - b.source) > .1 && Math.sign(a.source - b.source) !== Math.sign(a.adapted - b.adapted)) issues.push(`source-hierarchy:${a.id}/${b.id}`)
    if (Math.abs(a.adapted / b.adapted / (a.source / b.source) - 1) > .1) changes.push(`type-ratio:${a.id}/${b.id}`)
  }
  const { panel, parts } = template.sourceLayout ? sourceGraphicLayers(template) : { panel: '', parts: undefined }
  if (p.source.graphic !== panel) issues.push('source-panel')
  if (parts?.length) {
    const expected = combinedGraphic(parts)
    if (!p.artwork || p.artwork.svg !== expected.svg || p.artwork.width !== expected.width || p.artwork.height !== expected.height || p.artwork.hash !== await digest(expected.svg) || JSON.stringify(p.artwork.ids) !== JSON.stringify(expected.ids)) issues.push('source-artwork')
  } else if (!parts && !panel || p.artwork) issues.push('unaccounted-source-artwork')
  const bg = template.style.background
  if (!p.source.graphic && bg && /^#[\da-f]{6}$/i.test(bg) && bg.toLowerCase() !== '#ffffff' && p.source.background?.toLowerCase() !== bg.toLowerCase()) issues.push('source-background')
  return { version: 'source-properties-1', status: issues.length ? 'failed' : 'preserved', sourceHash: await digest(template), issues, changes: [...new Set(changes)], artistic: 'not-reviewed' }
}
