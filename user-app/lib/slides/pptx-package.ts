import JSZip from 'jszip'
import { writeEditablePptx } from './pptx'
import { embedPptxFonts, type PptxFont } from './pptx-fonts'

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`
const text = (zip: JSZip, path: string) => zip.file(path)!.async('string')
const escape = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Keep each slide's original theme, master and related parts in its own
 * namespace. Relative relationships continue to resolve inside that namespace. */
export async function combinePptxSlides(slides: Uint8Array[], name: string, fonts: PptxFont[] = []) {
  if (!slides.length) throw Error('Выберите хотя бы один слайд.')
  const zip = new JSZip(), defaults = new Map<string, string>(), overrides: string[] = []
  // Layout IDs share the presentation-wide ID space with masters. Copying the
  // single-slide ID (2147483649) made PowerPoint repair every multi-slide file.
  let nextLayoutId = 2147483648 + slides.length
  const addTypes = (xml: string, prefix: string) => {
    for (const entry of xml.matchAll(/<Default\b[^>]*\/>/g)) defaults.set(entry[0].match(/Extension="([^"]+)"/)![1], entry[0])
    for (const entry of xml.matchAll(/<Override\b[^>]*\/>/g)) {
      if (entry[0].includes('PartName="/ppt/presentation.xml"')) continue
      if (entry[0].includes('PartName="/ppt/')) overrides.push(entry[0].replace('PartName="/ppt/', `PartName="/${prefix}`))
    }
  }
  for (const [i, bytes] of slides.entries()) {
    const source = await JSZip.loadAsync(bytes), prefix = `ppt/decks/s${i + 1}/`
    addTypes(await text(source, '[Content_Types].xml'), prefix)
    for (const file of Object.values(source.files)) {
      if (file.dir || !file.name.startsWith('ppt/') || ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(file.name)) continue
      const path = prefix + file.name.slice(4)
      if (/^ppt\/slideMasters\/[^/]+\.xml$/.test(file.name)) {
        zip.file(path, (await file.async('string')).replace(/(<p:sldLayoutId\b[^>]*\bid=")\d+/g, (_, start) => start + nextLayoutId++))
      } else zip.file(path, file.name.endsWith('.rels') ? (await file.async('string')).replaceAll('Target="/ppt/', `Target="/${prefix}`) : await file.async('uint8array'))
    }
  }
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...defaults.values()].join('')}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides.join('')}</Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rOffice', 'officeDocument', 'ppt/presentation.xml')}</Relationships>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => rel(`s${i + 1}`, 'slide', `decks/s${i + 1}/slides/slide1.xml`) + rel(`m${i + 1}`, 'slideMaster', `decks/s${i + 1}/slideMasters/slideMaster1.xml`)).join('')}</Relationships>`)
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><p:sldMasterIdLst>${slides.map((_, i) => `<p:sldMasterId id="${2147483648 + i}" r:id="m${i + 1}"/>`).join('')}</p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="s${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="18288000" cy="10287000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  // The name is metadata, never interpolated into relationship paths.
  zip.file('docProps/core.xml', `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(name)}</dc:title></cp:coreProperties>`)
  zip.file('[Content_Types].xml', (await text(zip, '[Content_Types].xml')).replace('</Types>', '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'))
  zip.file('_rels/.rels', (await text(zip, '_rels/.rels')).replace('</Relationships>', '<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'))
  await embedPptxFonts(zip, fonts)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** Add a native chart/table and its workbook to an existing slide. */
export async function appendPptxObject(zip: JSZip, bytes: Uint8Array, index: number, box: { x: number; y: number; width: number; height: number }) {
  const source = await JSZip.loadAsync(bytes), prefix = `ppt/objects/o${index}/`, relationPrefix = `object${index}-`
  let graphic = (await text(source, 'ppt/slides/slide1.xml')).match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/)?.[0]
  if (!graphic) throw Error('Не удалось экспортировать редактируемый объект.')
  graphic = graphic.replace(/<p:xfrm>[\s\S]*?<\/p:xfrm>/, `<p:xfrm><a:off x="${Math.round(box.x * 9525)}" y="${Math.round(box.y * 9525)}"/><a:ext cx="${Math.round(box.width * 9525)}" cy="${Math.round(box.height * 9525)}"/></p:xfrm>`).replace(/<p:cNvPr id="\d+"/, `<p:cNvPr id="${50000 + index}"`).replace(/r:(id|dm|lo)="([^"]+)"/g, (_, attr, id) => `r:${attr}="${relationPrefix}${id}"`)
  for (const file of Object.values(source.files)) {
    if (file.dir || !/^ppt\/(charts|embeddings|diagrams)\//.test(file.name)) continue
    zip.file(prefix + file.name.slice(4), await file.async('uint8array'))
  }
  const additions = [...(await text(source, 'ppt/slides/_rels/slide1.xml.rels')).matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).filter(s => !s.includes('/slideLayout"')).map(s => s.replace(/Id="([^"]+)"/, (_, id) => `Id="${relationPrefix}${id}"`).replace('Target="../', `Target="../objects/o${index}/`)).join('')
  zip.file('ppt/slides/_rels/slide1.xml.rels', (await text(zip, 'ppt/slides/_rels/slide1.xml.rels')).replace('</Relationships>', additions + '</Relationships>'))
  const types = [...(await text(source, '[Content_Types].xml')).matchAll(/<Override\b[^>]*\/>/g)].map(m => m[0]).filter(s => /PartName="\/ppt\/(charts|embeddings|diagrams)\//.test(s)).map(s => s.replace('PartName="/ppt/', `PartName="/${prefix}`)).join('')
  zip.file('[Content_Types].xml', (await text(zip, '[Content_Types].xml')).replace('</Types>', types + '</Types>'))
  zip.file('ppt/slides/slide1.xml', (await text(zip, 'ppt/slides/slide1.xml')).replace('</p:spTree>', graphic + '</p:spTree>'))
}

export { writeEditablePptx }
