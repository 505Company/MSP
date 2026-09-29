import type JSZip from 'jszip'
import {fontBytes} from '../lib/uploads/embedded-fonts'
import {fontKey, powerpointFont, type PptxFont, type PptxFontStyle} from '../lib/slides/pptx-fonts'

type Face = Pick<PptxFont,'family'|'style'>
type Source = Face & {url:string}
export type ExportFontCache = Map<string,Promise<Uint8Array>>
const familyName=(s:string)=>s.trim().replace(/^['"]|['"]$/g,'')
const styleName=(weight:string,style:string):PptxFontStyle=>
  (weight==='bold'||parseInt(weight)>=600) ? style==='italic'?'Bold Italic':'Bold' : style==='italic'?'Italic':'Regular'

/** Read the actual native objects, including table cells and chart labels.
 * Theme defaults and raster artwork don't require an embedded font. */
export async function usedPptxFonts(zip:JSZip):Promise<Face[]> {
  const faces=new Map<string,Face>(),parser=new DOMParser()
  for(const entry of Object.values(zip.files)){
    if(entry.dir||!entry.name.endsWith('.xml')||!/(?:slides|charts|diagrams)\//.test(entry.name))continue
    const doc=parser.parseFromString(await entry.async('string'),'application/xml')
    if(doc.querySelector('parsererror'))throw Error('Не удалось прочитать текст экспортируемого слайда.')
    for(const p of [...doc.getElementsByTagName('*')].filter(e=>['rPr','defRPr','endParaRPr'].includes(e.localName))){
      for(const f of [...p.children].filter(e=>['latin','ea','cs'].includes(e.localName))){
        const family=f.getAttribute('typeface');if(!family||family.startsWith('+'))continue
        const face={family,style:styleName(['1','true'].includes(p.getAttribute('b')??'')?'700':'400',['1','true'].includes(p.getAttribute('i')??'')?'italic':'normal')}
        faces.set(fontKey(face),face)
      }
    }
  }
  return [...faces.values()]
}

function cssSources(host:HTMLElement):Source[] {
  const result:Source[]=[]
  for(const tag of host.querySelectorAll('style')){
    const sheet=new CSSStyleSheet();sheet.replaceSync(tag.textContent??'')
    for(const rule of [...sheet.cssRules]){
      if(!(rule instanceof CSSFontFaceRule))continue
      const s=rule.style,family=familyName(s.getPropertyValue('font-family'))
      if(s.getPropertyValue('unicode-range'))continue
      for(const m of s.getPropertyValue('src').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)){
        result.push({family,style:styleName(s.getPropertyValue('font-weight'),s.getPropertyValue('font-style')),url:m[1]})
      }
    }
  }
  return result
}

async function readSource(url:string,cache:ExportFontCache):Promise<Uint8Array> {
  let pending=cache.get(url)
  if(!pending){pending=(async()=>{
    if(url.startsWith('data:')){
      if(!/^data:[^,]*;base64,/i.test(url)||url.length>12*1024*1024)throw Error('Некорректный файл шрифта.')
      return Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),c=>c.charCodeAt(0))
    }
    const target=new URL(url,location.href)
    if(target.origin!==location.origin)throw Error('Шрифт должен быть сохранён в дизайн-системе.')
    const response=await fetch(target.href);if(!response.ok)throw Error('Не удалось загрузить шрифт для экспорта.')
    const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('Слишком большой файл шрифта.')
    return bytes
  })();cache.set(url,pending)}
  return pending
}

/** Prefer the precise bytes frozen in the receipt, then its source upload.
 * Never replace the font with a similar face merely to make export succeed. */
export async function collectPptxFonts(zip:JSZip,host:HTMLElement,uploadId:string,cache:ExportFontCache):Promise<PptxFont[]> {
  const sources=cssSources(host),faces=await usedPptxFonts(zip),result:PptxFont[]=[]
  let uploaded:Source[]|undefined
  for(const face of faces){
    const match=(source:Source)=>fontKey(source)===fontKey(face)
    const obtain=async(candidates:Source[])=>{
      for(const source of candidates.filter(match)){
        const raw=await readSource(source.url,cache),bytes=fontBytes(raw)
        if(!bytes)continue // Web-only WOFF/WOFF2: request the original sfnt below.
        const font={...face,bytes};powerpointFont(font);return font
      }
    }
    let font=await obtain(sources)
    if(!font){
      if(!uploaded){const r=await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/fonts`);uploaded=r.ok?(await r.json() as {fonts:Source[]}).fonts:[]}
      font=await obtain(uploaded)
    }
    if(!font&&face.family==='Play'&&!face.style.includes('Italic'))font=await obtain([{...face,url:`/fonts/play/Play-${face.style}.ttf`}])
    if(!font){
      const query=new URLSearchParams(face),r=await fetch(`/api/fonts/google?${query}`)
      if(r.ok){const data=await r.json() as {files:{url:string;unicodeRange?:string}[]}
        // A partial web subset cannot stand in for the complete font in Office.
        font=await obtain(data.files.filter(f=>!f.unicodeRange).map(f=>({...face,url:f.url})))
      }
    }
    if(!font)throw Error(`Не удалось встроить шрифт «${face.family}» (${face.style}). Загрузите дизайн-систему со встроенным TTF/OTF. Экспорт в PDF доступен.`)
    result.push(font)
  }
  return result
}
