import { toPng } from 'html-to-image'
import { LAB_VERSION, MINIMUM_TEXT_CONTRAST, behaviorFor, constraintsSchema, contentIssues, measurementIssues, profileSchema, type Box, type BoxConstraints, type ComponentContent, type ComponentMeasurement, type ComponentProfile, type ComponentState, type LayoutTrial } from '../../lib/component-lab/contract'
import { digest, supportedPanel } from '../../lib/component-lab/source'
import { metricParts } from '../../lib/component-lab/metric-unit'
import { safeGraphic } from '../../lib/component-lab/artwork'
import type { ArtworkResource } from './artwork'

export type ComponentResources = { css: string; available: string[]; faces?: { family: string; weight: number; hash: string }[]; artwork?: ArtworkResource }
export type FontEvidence = ComponentResources
const bounds = (rect: DOMRect, origin: DOMRect): Box => ({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height })
function visibleTextRects(el: HTMLElement) {
  const range = document.createRange(), rects: DOMRect[] = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  // Pre-wrap retains spaces at soft line endings. Those spaces have selection
  // boxes outside centered text but paint no glyphs. Measure the words without
  // altering the original string or its whitespace in the rendered component.
  for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const word of (node.textContent ?? '').matchAll(/\S+/gu)) {
      range.setStart(node, word.index!); range.setEnd(node, word.index! + word[0].length)
      rects.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0))
    }
  return rects
}
function union(rects: DOMRect[]) {
  if (!rects.length) return new DOMRect()
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y))
  return new DOMRect(x, y, Math.max(...rects.map(r => r.right)) - x, Math.max(...rects.map(r => r.bottom)) - y)
}
export function stateOrder(p: ComponentProfile, c: BoxConstraints) {
  const preferred: ComponentState = c.width > 650 && c.maxHeight < 280 ? 'compact' : c.width / c.maxHeight > 1.35 ? 'horizontal' : 'vertical'
  return [...new Set([preferred, p.preferred, ...p.states])].filter(s => p.states.includes(s) && (!c.allowedStates || c.allowedStates.includes(s)))
}
function background(root: HTMLElement, p: ComponentProfile) {
  if (p.source.background) root.style.background = p.source.background
  if (!p.source.graphic) return
  const { width, height, graphic } = p.source
  // SVG strokes are centred on the path. Image rasterisation clips overflow
  // even when the imported SVG says overflow="visible", cutting straight
  // edges in half while keeping the inset curves at their full thickness.
  const stroke = Math.max(0, ...[...graphic.matchAll(/\bstroke-width="([\d.e+-]+)"/g)].map(m => Number(m[1])).filter(Number.isFinite))
  const inset = stroke / 2, imageWidth = width + stroke, imageHeight = height + stroke
  const cut = Math.min(imageWidth / 3, imageHeight / 3, p.padding)
  const layer = document.createElement('div'); layer.setAttribute('aria-hidden', 'true')
  const sized = graphic.replace('width="100%" height="100%"', `width="${imageWidth}" height="${imageHeight}"`).replace(/viewBox="[^"]+"/, `viewBox="${-inset} ${-inset} ${imageWidth} ${imageHeight}"`)
  const svg = /<svg\b[^>]*\bxmlns=/.test(sized) ? sized : sized.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  // One border image keeps the nine regions joined even at fractional preview
  // scales. Separate SVG tiles leave antialiased seams between their clips.
  Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', borderStyle: 'solid', borderColor: 'transparent', borderWidth: `${cut}px`, borderImageSource: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, borderImageSlice: `${cut} fill`, borderImageWidth: '1', borderImageRepeat: 'stretch' })
  root.appendChild(layer)
}
/** Browser flex performs internal flow. The outer slide never participates. */
function draw(host: HTMLElement, p: ComponentProfile, content: ComponentContent, c: BoxConstraints, state: ComponentState, step: number, resources: ComponentResources): { node: HTMLElement; trial: LayoutTrial } {
  host.replaceChildren()
  const behavior = behaviorFor(p, state), { padding, gap } = behavior, flowWidth = (c.width - padding * 2) * behavior.contentWidth / 100
  const node = document.createElement('div'); node.dataset.componentBox = p.id
  Object.assign(node.style, { position: 'relative', boxSizing: 'border-box', width: `${c.width}px`, padding: `${padding}px`, minWidth: '0', overflow: 'visible' })
  background(node, p)
  if (!p.source.background) node.style.backgroundColor = c.background ?? '#ffffff'
  const flow = document.createElement('div'); flow.dataset.componentContent = ''
  Object.assign(flow.style, { display: 'flex', position: 'relative', flexDirection: state === 'vertical' ? 'column' : 'row', alignItems: state === 'vertical' ? 'stretch' : 'center', gap: `${gap}px`, minWidth: '0', width: `${flowWidth}px`, marginInline: 'auto' })
  const group = document.createElement('div')
  Object.assign(group.style, { display: 'flex', flexDirection: 'column', gap: `${gap}px`, minWidth: '0', flex: '1 1 0' })
  const visible = p.fields.filter(f => content[f.id]?.trim()).sort((a, b) => a.order - b.order)
  let art: HTMLElement | undefined
  if (p.artwork) {
    art = document.createElement('div'); art.dataset.componentArtwork = p.artwork.kind
    const width = Math.min(p.artwork.size, flowWidth * (state === 'vertical' ? 1 : .32))
    Object.assign(art.style, { position: 'relative', flex: '0 0 auto', display: 'grid', placeItems: 'center', width: `${width}px`, height: `${width * p.artwork.height / p.artwork.width}px`, alignSelf: state === 'vertical' ? ({ left: 'start', center: 'center', right: 'end', source: p.fields[0].align === 'center' ? 'center' : 'start' }[behavior.textAlign]) : 'center' })
    const image = document.createElement('img'); image.src = resources.artwork!.url; image.alt = ''; image.setAttribute('aria-hidden', 'true')
    Object.assign(image.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' }); art.appendChild(image)
    flow.appendChild(art)
  }
  for (const field of visible) {
    const el = document.createElement('div'); el.dataset.componentField = field.id
    const lead = ['number', 'ordinal'].includes(field.role), size = Math.max(field.minimum, field.size * (1 - step * .05))
    if (field.unitScale !== undefined) for (const [i, text] of metricParts(content[field.id])!.entries()) {
      const part = document.createElement('span'); part.dataset.metricPart = i ? 'unit' : 'value'; part.textContent = text
      part.style.fontSize = `${size * (i ? field.unitScale : 1)}px`; el.appendChild(part)
    }
    else el.textContent = content[field.id]
    Object.assign(el.style, { fontFamily: JSON.stringify(field.font), fontSize: `${size}px`, fontWeight: String(field.weight), fontStyle: field.italic ? 'italic' : 'normal', fontSynthesis: 'none', lineHeight: String(field.leading), letterSpacing: `${field.letterSpacing}px`, color: field.color, textAlign: behavior.textAlign === 'source' ? field.align : behavior.textAlign,
      // Keep normal words intact. A thin column must fail containment so the
      // planner can try another state/size instead of hiding it with letter wraps.
      whiteSpace: lead ? 'pre' : 'pre-wrap', overflowWrap: 'normal', wordBreak: 'normal', minWidth: '0', flexShrink: '0', margin: '0', padding: '0', boxSizing: 'border-box' })
    if (p.artwork?.kind === 'badge' && p.artwork.field === field.id) {
      Object.assign(el.style, { position: 'relative', textAlign: 'center', width: '100%' }); art!.appendChild(el)
    } else if (state !== 'vertical' && lead) {
      // The source proportion is a minimum, not a clipping box. A value and its
      // unit stay together; flex reserves their intrinsic width before wrapping
      // the caption into the remaining space. Impossible rows still fail QA.
      Object.assign(el.style, { flex: '0 0 auto', width: 'max-content', minWidth: `${Math.max(0, flowWidth - gap) * (state === 'compact' ? .24 : .36)}px` })
      flow.appendChild(el)
    }
    else if (state !== 'vertical') group.appendChild(el)
    else flow.appendChild(el)
  }
  if (state !== 'vertical') flow.appendChild(group)
  node.appendChild(flow); host.appendChild(node)
  // Font ascent/descent can extend beyond the source's tight line-height.
  // Reserve that measured space in the flow instead of relaxing containment.
  for (const field of flow.querySelectorAll<HTMLElement>('[data-component-field]')) {
    const box = field.getBoundingClientRect(), ink = union(visibleTextRects(field))
    field.style.paddingTop = `${Math.ceil(Math.max(0, box.top - ink.top))}px`
    field.style.paddingBottom = `${Math.ceil(Math.max(0, ink.bottom - box.bottom))}px`
  }
  const requiredHeight = flow.getBoundingClientRect().height + padding * 2
  const height = c.heightMode === 'fill' ? c.maxHeight : requiredHeight
  node.style.height = `${height}px`
  // Shift the whole measured group only into available space. Hug stays natural.
  flow.style.marginTop = `${Math.max(0, height - requiredHeight) * ({ top: 0, center: .5, bottom: 1 }[behavior.position])}px`
  const origin = node.getBoundingClientRect()
  const fields = visible.map(field => {
    const el = [...node.querySelectorAll<HTMLElement>('[data-component-field]')].find(el => el.dataset.componentField === field.id)!
    const lines = visibleTextRects(el)
    const parts = field.unitScale === undefined ? undefined : [...el.querySelectorAll<HTMLElement>('[data-metric-part]')].map(part => ({ text: part.textContent!, fontSize: parseFloat(getComputedStyle(part).fontSize), box: bounds(union(visibleTextRects(part)), origin) }))
    return { id: field.id, role: field.role, text: el.textContent!, font: field.font, align: getComputedStyle(el).textAlign as typeof field.align, fontSize: parseFloat(getComputedStyle(el).fontSize), lineCount: field.unitScale !== undefined ? 1 : new Set(lines.map(r => Math.round(r.y))).size, box: bounds(el.getBoundingClientRect(), origin), ink: bounds(union(lines), origin), ...(parts ? { parts } : {}) }
  })
  const trial: LayoutTrial = { state, step, width: c.width, height, requiredHeight, fields, ...(art ? { artwork: { kind: p.artwork!.kind, hash: resources.artwork!.hash, box: bounds(art.getBoundingClientRect(), origin) } } : {}), fits: false, issues: [] }
  trial.issues = measurementIssues(p, content, trial, c); trial.fits = !trial.issues.length
  return { node, trial }
}
export async function measureComponent(profile: ComponentProfile, content: ComponentContent, rawConstraints: BoxConstraints, fonts: FontEvidence, options: { signal?: AbortSignal; target?: HTMLElement;maxTypeStep?:number;preferredState?:ComponentState } = {}): Promise<ComponentMeasurement> {
  const p = profileSchema.parse(profile), c = constraintsSchema.parse(rawConstraints)
  const result: ComponentMeasurement = { version: LAB_VERSION, fingerprint: p.fingerprint, inputHash: await digest({ version: LAB_VERSION, profile: p, content, constraints: c, fonts }), status: 'incompatible', constraints: c, trials: [], feasibleSizes: [], issues: contentIssues(p, content), artistic: 'not-reviewed' }
  if (p.source.graphic && !supportedPanel(p.source.graphic) || p.artwork && (!safeGraphic(p.artwork.svg) || p.artwork.hash !== await digest(p.artwork.svg) || p.artwork.hash !== fonts.artwork?.hash)) result.issues.push('unsupported-artwork')
  if (!stateOrder(p, c).length) result.issues.push('no-compatible-state')
  if (result.issues.length) { options.target?.replaceChildren(); return result }
  await document.fonts.ready
  const missing = p.fields.filter(f => content[f.id]?.trim() && (!fonts.available.includes(f.font) || !document.fonts.check(`${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${JSON.stringify(f.font)}`, content[f.id]))).map(f => f.font)
  if (missing.length) { options.target?.replaceChildren(); return { ...result, status: 'unavailable', issues: [...new Set(missing)].map(f => `font-unavailable:${f}`) } }
  const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', pointerEvents: 'none' }); host.setAttribute('aria-hidden', 'true'); document.body.appendChild(host)
  try {
    const states = stateOrder(p, c).sort((a,b)=>Number(b===options.preferredState)-Number(a===options.preferredState)),maxTypeStep=Math.max(0,Math.min(4,options.maxTypeStep??4))
    outer: for (let step = 0; step <= maxTypeStep; step++) for (const state of states) {
      options.signal?.throwIfAborted()
      const { trial } = draw(host, p, content, c, state, step, fonts); result.trials.push(trial)
      if (trial.fits) { result.chosen = trial; result.status = 'fits'; break outer }
    }
    if (!result.chosen) {
      result.status = 'needs-space'
      result.chosen = [...result.trials].sort((a, b) => a.issues.length - b.issues.length || a.requiredHeight - b.requiredHeight)[0]
      result.issues = result.chosen?.issues ?? ['no-compatible-state']
      // Every suggestion is independently rendered with the proposed dimensions.
      const wider = (factor: number) => Math.max(p.minWidth, Math.min(p.maxWidth, Math.ceil(c.width * factor)))
      for (const width of [...new Set([c.width, wider(1.4), wider(2), p.maxWidth])]) {
        alt: for (let step = 0; step <= maxTypeStep; step++) for (const state of states) {
          options.signal?.throwIfAborted()
          const constraints: BoxConstraints = { ...c, width, maxHeight: p.maxHeight, heightMode: 'hug' }
          const { trial } = draw(host, p, content, constraints, state, step, fonts)
          if (trial.fits) { result.feasibleSizes.push({ width, height: Math.ceil(trial.height), state, step }); break alt }
        }
      }
    }
    if (result.status === 'fits' && result.chosen && options.target) { const { node } = draw(host, p, content, c, result.chosen.state, result.chosen.step, fonts); options.target.replaceChildren(node) }
    else options.target?.replaceChildren()
    return result
  } finally { host.remove() }
}
/** Execute the previously measured choice exactly. Suitable for a future
 * pixel-plan renderer: no alternative state, font step or geometry is chosen. */
export async function renderCommittedComponent(target: HTMLElement, rawProfile: ComponentProfile, content: ComponentContent, committed: ComponentMeasurement, fonts: FontEvidence) {
  const p = profileSchema.parse(rawProfile), c = constraintsSchema.parse(committed.constraints)
  if (committed.version !== LAB_VERSION || committed.status !== 'fits' || !committed.chosen || p.fingerprint !== committed.fingerprint || p.source.graphic && !supportedPanel(p.source.graphic) || p.artwork && (!safeGraphic(p.artwork.svg) || await digest(p.artwork.svg) !== p.artwork.hash || p.artwork.hash !== fonts.artwork?.hash) || committed.inputHash !== await digest({ version: LAB_VERSION, profile: p, content, constraints: c, fonts }) || measurementIssues(p, content, committed.chosen, c).length) throw Error('component-plan-mismatch')
  await document.fonts.ready
  if (p.fields.some(f => content[f.id]?.trim() && (!fonts.available.includes(f.font) || !document.fonts.check(`${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${JSON.stringify(f.font)}`, content[f.id])))) throw Error('component-font-unavailable')
  const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0' }); document.body.appendChild(host)
  try {
    const { node, trial } = draw(host, p, content, c, committed.chosen.state, committed.chosen.step, fonts), previous = committed.chosen
    if (!trial.fits || JSON.stringify(trial.artwork) !== JSON.stringify(previous.artwork) || Math.abs(trial.height - previous.height) > .25 || Math.abs(trial.requiredHeight - previous.requiredHeight) > .25 || trial.fields.some((f, i) => f.text !== previous.fields[i]?.text || f.lineCount !== previous.fields[i]?.lineCount || ['box', 'ink'].some(k => (['x', 'y', 'width', 'height'] as const).some(axis => Math.abs(f[k as 'box'][axis] - previous.fields[i][k as 'box'][axis]) > .25)))) throw Error('component-measurement-changed')
    target.replaceChildren(node); return trial
  } finally { host.remove() }
}
async function raster(src: string) { const img = new Image(); img.src = src; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0); return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data } }
export async function pixelEvidence(node: HTMLElement, trial: LayoutTrial, fonts: FontEvidence) {
  const capture = () => toPng(node, { pixelRatio: 1, fontEmbedCSS: fonts.css, cacheBust: false })
  const preview = await capture(), fields = [...node.querySelectorAll<HTMLElement>('[data-component-field]')]
  let hidden: string
  try { fields.forEach(f => { f.style.visibility = 'hidden' }); hidden = await capture() } finally { fields.forEach(f => f.style.removeProperty('visibility')) }
  const a = await raster(preview), b = await raster(hidden)
  if (a.width !== b.width || a.height !== b.height) throw Error('pixel-dimensions')
  const luminance = (rgb: number[]) => rgb.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0)
  const pixels = trial.fields.map(f => { let count = 0, contrast = 21
    const field = fields.find(n => n.dataset.componentField === f.id)!, rgb = getComputedStyle(field).color.match(/[\d.]+/g)!.slice(0, 3).map(Number), foreground = luminance(rgb)
    for (let y = Math.max(0, Math.floor(f.ink.y)); y < Math.min(a.height, Math.ceil(f.ink.y + f.ink.height)); y++) for (let x = Math.max(0, Math.floor(f.ink.x)); x < Math.min(a.width, Math.ceil(f.ink.x + f.ink.width)); x++) { const at = (y * a.width + x) * 4; if ([0, 1, 2].some(c => Math.abs(a.data[at + c] - b.data[at + c]) > 24)) {
      count++; const alpha = b.data[at + 3] / 255, bg = luminance([0, 1, 2].map(c => b.data[at + c] * alpha + 255 * (1 - alpha)))
      contrast = Math.min(contrast, (Math.max(bg, foreground) + .05) / (Math.min(bg, foreground) + .05))
    } }
    return { id: f.id, count, contrast }
  })
  let artwork: { hash: string; count: number } | undefined
  if (trial.artwork) {
    const image = node.querySelector<HTMLElement>('[data-component-artwork] img')!
    let without: string
    try { image.style.visibility = 'hidden'; fields.forEach(f => { f.style.visibility = 'hidden' }); without = await capture() }
    finally { image.style.removeProperty('visibility'); fields.forEach(f => { f.style.removeProperty('visibility') }) }
    const blank = await raster(without); let count = 0
    for (let i = 0; i < b.data.length; i += 4) if ([0, 1, 2, 3].some(c => Math.abs(b.data[i + c] - blank.data[i + c]) > 24)) count++
    artwork = { hash: trial.artwork.hash, count }
  }
  return { preview, pixels, ...(artwork ? { artwork } : {}), minimumContrast: MINIMUM_TEXT_CONTRAST, passed: pixels.every(p => p.count >= 3 && p.contrast >= MINIMUM_TEXT_CONTRAST) && (!trial.artwork || !!artwork && artwork.count >= 3) }
}
