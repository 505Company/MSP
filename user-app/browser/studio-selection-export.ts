import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { toPng } from 'html-to-image'
import { portableStudioAssets } from './studio-background'
import { studioDataInstance } from './studio-data'
import { exportEditableTemplatePptx, supportsNativePptx } from '../lib/design-system/editable-pptx'
import { appendPptxObject, combinePptxSlides, writeEditablePptx } from '../lib/slides/pptx-package'
import {collectPptxFonts, type ExportFontCache} from './pptx-fonts'
import type { StudioRun } from '../lib/presentations/studio/contract'
import type { ElementIR, TextElementIR, ColorIR } from '../vendor/drag/src/core/model'

export type SelectedStudioSlide = { run: StudioRun; slideId: string }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const emu = (n: number) => Math.round(n * 9525)
const bytes = (uri: string) => Uint8Array.from(atob(uri.split(',')[1]), c => c.charCodeAt(0))
function color(value: string): ColorIR {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
  ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 }
}
const hex = (value: string) => { const c = color(value); return [c.r, c.g, c.b].map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('') }
const fill = (value: string) => `<a:solidFill><a:srgbClr val="${hex(value)}"/></a:solidFill>`
const font = (value: string) => value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
function boxOf(element: Element, root: HTMLElement) {
  const a = element.getBoundingClientRect(), b = root.getBoundingClientRect()
  return { x: a.x - b.x, y: a.y - b.y, width: a.width, height: a.height }
}
function scaleOf(element: Element, root: HTMLElement) {
  if (element instanceof SVGGraphicsElement) { const m = element.getScreenCTM(); if (m) return Math.hypot(m.a, m.b) }
  let scale = 1
  for (let e: Element | null = element; e && e !== root; e = e.parentElement) {
    const transform = getComputedStyle(e).transform
    if (transform !== 'none') { const m = new DOMMatrixReadOnly(transform); scale *= Math.hypot(m.a, m.b) }
  }
  return scale
}

/** Preserve measured line breaks and local rich-text runs. Each exported line
 * is editable; the source artwork stays in an independent background image. */
function editableText(root: HTMLElement, omitted: Set<Element>): TextElementIR[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = [], result: TextElementIR[] = [], hide: (() => void)[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (p?.closest('[data-block], [data-studio-chrome]') && !p.closest('style,script') && ![...omitted].some(e => e.contains(p)) && n.textContent?.trim()) nodes.push(n as Text)
  }
  const origin = root.getBoundingClientRect()
  for (const node of nodes) {
    const parent = node.parentElement!, style = getComputedStyle(parent), scale = scaleOf(parent, root), size = parseFloat(style.fontSize) * scale
    const ink = color(parent.namespaceURI?.includes('svg') ? style.fill : style.color)
    if (!ink.a || style.visibility === 'hidden' || !size) continue
    const lines: { value: string; x: number; y: number; right: number; height: number }[] = []
    for (let i = 0; i < node.length; i++) {
      const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect(), char = node.data[i]
      if (!r.height || char === '\n') continue
      let line = lines.at(-1)
      if (!line || Math.abs(line.y - r.y) > 1) { line = { value: '', x: r.x, y: r.y, right: r.right, height: r.height }; lines.push(line) }
      line.value += char; line.right = Math.max(line.right, r.right)
    }
    for (const line of lines) {
      if (!line.value.trim()) continue
      const id = `text-${result.length + 1}`
      result.push({ id, name: line.value.slice(0, 80), kind: 'text', text: line.value, fontFamily: font(style.fontFamily), fontSize: size,
        fontStyle: Number(style.fontWeight) >= 600 ? style.fontStyle === 'italic' ? 'Bold Italic' : 'Bold' : style.fontStyle === 'italic' ? 'Italic' : 'Regular',
        rotation: 0, opacity: 1, visible: true, zIndex: result.length + 1,
        bounds: { x: line.x - origin.x, y: line.y - origin.y, width: Math.min(1920 - (line.x - origin.x), line.right - line.x + 6), height: Math.max(line.height, size * 1.3) },
        paragraphs: [{start:0,end:line.value.length,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,fontSize:size,lineHeight:{unit:'PERCENT',value:100}}],
        textBox: { wrap: false, align: 'LEFT', vertical: 'TOP' }, colorRuns: [{ start: 0, end: line.value.length, fill: { type: 'solid', color: ink } }],
      })
    }
    // Keep layout and decoration unchanged while removing only these glyphs.
    if (parent.namespaceURI?.includes('svg')) hide.push(() => { parent.style.fill = 'transparent'; parent.style.stroke = 'none' })
    else hide.push(() => { const span = document.createElement('span'); span.style.setProperty('color', 'transparent', 'important'); span.style.setProperty('-webkit-text-fill-color', 'transparent', 'important'); node.replaceWith(span); span.appendChild(node) })
  }
  hide.forEach(apply => apply())
  return result
}

function nativeTable(table: HTMLTableElement, root: HTMLElement, index: number) {
  const box = boxOf(table, root), rows = [...table.rows]
  if (!rows.length) throw Error('Таблица пуста.')
  const columns = [...rows[0].cells].map(cell => cell.getBoundingClientRect().width)
  const body = rows.map(row => `<a:tr h="${emu(row.getBoundingClientRect().height)}">${[...row.cells].map(cell => {
    const s = getComputedStyle(cell), size = parseFloat(s.fontSize), text = cell.textContent ?? '', ink = fill(s.color)
    const bg = [cell, row, table].map(e => getComputedStyle(e).backgroundColor).find(c => color(c).a > 0) ?? '#ffffff'
    const line = (side: string) => { const w = parseFloat(s.getPropertyValue(`border-${side}-width`)); return `<a:ln${{ left: 'L', right: 'R', top: 'T', bottom: 'B' }[side]} w="${emu(w)}">${w ? fill(s.getPropertyValue(`border-${side}-color`)) : '<a:noFill/>'}<a:prstDash val="solid"/></a:ln${{ left: 'L', right: 'R', top: 'T', bottom: 'B' }[side]}>` }
    const paragraphs = text.split('\n').map(value => `<a:p><a:pPr algn="${s.textAlign === 'right' ? 'r' : s.textAlign === 'center' ? 'ctr' : 'l'}"><a:lnSpc><a:spcPts val="${Math.round((parseFloat(s.lineHeight) || size * 1.2) * 75)}"/></a:lnSpc></a:pPr><a:r><a:rPr sz="${Math.round(size * 75)}" b="${Number(s.fontWeight) >= 600 ? 1 : 0}">${ink}<a:latin typeface="${esc(font(s.fontFamily))}"/></a:rPr><a:t xml:space="preserve">${esc(value)}</a:t></a:r></a:p>`).join('')
    return `<a:tc${cell.colSpan > 1 ? ` gridSpan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : ''}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody><a:tcPr marL="${emu(parseFloat(s.paddingLeft))}" marR="${emu(parseFloat(s.paddingRight))}" marT="${emu(parseFloat(s.paddingTop))}" marB="${emu(parseFloat(s.paddingBottom))}" anchor="${s.verticalAlign === 'middle' ? 'ctr' : s.verticalAlign === 'bottom' ? 'b' : 't'}">${['left', 'right', 'top', 'bottom'].map(line).join('')}${fill(bg)}</a:tcPr></a:tc>`
  }).join('')}</a:tr>`).join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${40000 + index}" name="Таблица ${index}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${columns.map(w => `<a:gridCol w="${emu(w)}"/>`).join('')}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

async function exportSlide({ run, slideId }: SelectedStudioSlide, pptx: boolean, fontCache:ExportFontCache) {
  const slide = run.slides.find(s => s.content.id === slideId), receipt = run.results[slideId]
  if(run.deletedSlideIds?.includes(slideId))throw Error('Выбранный слайд удалён из проекта. Обновите список.')
  if (!slide || !receipt?.passed) throw Error('Выбранный слайд ещё не готов.')
  const host = document.createElement('div'); host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, { position: 'fixed', left: '-24000px', top: '0', width: '1920px', height: '1080px', pointerEvents: 'none' })
  host.innerHTML = await portableStudioAssets(receipt.html, run.library.uploadId)
  // A receipt is render data; executable nodes are never part of an export.
  host.querySelectorAll('script,iframe,object').forEach(e => e.remove())
  document.body.appendChild(host)
  try {
    const root = host.querySelector<HTMLElement>('[data-studio-slide]')
    if (!root) throw Error('В сохранённом слайде отсутствует вёрстка для экспорта.')
    await document.fonts.ready
    await Promise.all([...root.querySelectorAll('img')].map(i => i.decode()))
    const fontEmbedCSS = [...host.querySelectorAll('style')].map(s => s.textContent).join('\n')
    const png = bytes(await toPng(root, { pixelRatio: 1, fontEmbedCSS, cacheBust: false }))
    if (!pptx) return { png }
    const omitted = new Set<Element>(), tables: string[] = [], objects: { bytes: Uint8Array; box: ReturnType<typeof boxOf> }[] = []
    for (const block of slide.content.blocks) {
      if (!block.data) continue
      const box = [...root.querySelectorAll<HTMLElement>('[data-block]')].find(e => e.dataset.block === block.id)
      if (!box) throw Error('Не найден блок данных на слайде.')
      const table = box.querySelector('table')
      if (table) { tables.push(nativeTable(table, root, tables.length + 1)); omitted.add(table); continue }
      if (supportsNativePptx(block.data.template)) {
        const chart = box.querySelector('svg[data-editable-chart]')?.parentElement ?? box.firstElementChild ?? box
        const rect = boxOf(chart, root), instance = studioDataInstance(block.data.template, block.data.values, rect.width)
        const b = await exportEditableTemplatePptx({ ...instance.template, width: rect.width, height: rect.height }, instance.data)
        objects.push({ bytes: b, box: rect }); omitted.add(chart)
      }
      // Unsupported source graphics retain their exact rendered appearance.
      else omitted.add(box)
    }
    const text = editableText(root, omitted)
    for (const el of omitted) {
      if (el.tagName === 'TABLE' || objects.some(o => { const b = boxOf(el, root); return b.x === o.box.x && b.y === o.box.y })) (el as HTMLElement).style.visibility = 'hidden'
    }
    const background = bytes(await toPng(root, { pixelRatio: 1, fontEmbedCSS, cacheBust: false }))
    const elements: ElementIR[] = [{ id: 'artwork', name: 'Графика дизайн-системы', kind: 'raster', assetId: 'artwork', reason: 'Исходная графика дизайн-системы', rotation: 0, opacity: 1, visible: true, zIndex: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, ...text]
    const native = await writeEditablePptx({ id: slideId, name: slide.content.title, kind: 'compound', source: { slide: 1, rootId: slideId, elementIds: [], ancestorIds: [], assetIds: ['artwork'] }, scene: { width: 1920, height: 1080, elements }, slots: [], fixedTextIds: [], issues: [], semantics: [] }, [{ id: 'artwork', bytes: background }])
    const zip = await JSZip.loadAsync(native)
    zip.file('ppt/slides/slide1.xml', (await zip.file('ppt/slides/slide1.xml')!.async('string')).replace('</p:spTree>', tables.join('') + '</p:spTree>'))
    for (const [i, object] of objects.entries()) await appendPptxObject(zip, object.bytes, i + 1, object.box)
    const fonts=await collectPptxFonts(zip,host,run.library.uploadId,fontCache)
    return { png, fonts, pptx: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) }
  } finally { host.remove() }
}

export async function exportSelectedSlides(name: string, selection: SelectedStudioSlide[], format: 'pdf' | 'pptx' | 'both') {
  if (!selection.length) throw Error('Выберите хотя бы один слайд.')
  const pages: Awaited<ReturnType<typeof exportSlide>>[] = []
  const fontCache:ExportFontCache=new Map()
  let loaded: StudioRun | undefined
  for (const slide of selection) {
    if (slide.run.previewOnly) {
      if (loaded?.revision !== slide.run.revision || loaded.projectId !== slide.run.projectId) {
        const response = await fetch(`/api/projects/${slide.run.projectId}/compose?revision=${slide.run.revision}`, { cache: 'no-store' }), data = await response.json() as { run: StudioRun; error?: string }
        if (!response.ok || !data.run) throw Error(data.error ?? 'Не удалось открыть сохранённые слайды для экспорта.')
        loaded = data.run
      }
      pages.push(await exportSlide({ ...slide, run: loaded }, format !== 'pdf',fontCache))
    } else pages.push(await exportSlide(slide, format !== 'pdf',fontCache))
  }
  let pdf: Uint8Array | undefined, pptx: Uint8Array | undefined
  if (format !== 'pptx') {
    const doc = await PDFDocument.create(); doc.setTitle(name); doc.setCreator('MSP')
    for (const page of pages) { const image = await doc.embedPng(page.png); doc.addPage([1440, 810]).drawImage(image, { x: 0, y: 0, width: 1440, height: 810 }) }
    pdf = await doc.save()
  }
  if (format !== 'pdf') pptx = await combinePptxSlides(pages.map(p => p.pptx!), name,pages.flatMap(p=>p.fonts??[]))
  return { pdf, pptx }
}

export async function downloadSelectedSlides(name: string, selection: SelectedStudioSlide[], format: 'pdf' | 'pptx' | 'both') {
  const result = await exportSelectedSlides(name, selection, format), safeName = (name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'MSP').slice(0, 100)
  let data: Uint8Array, extension: string, mime: string
  if (format === 'both') { const zip = new JSZip(); zip.file(`${safeName}.pdf`, result.pdf!); zip.file(`${safeName}.pptx`, result.pptx!); data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); extension = 'zip'; mime = 'application/zip' }
  else { data = result[format]!; extension = format; mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mime })), link = document.createElement('a')
  link.href = url; link.download = `${safeName}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
}
