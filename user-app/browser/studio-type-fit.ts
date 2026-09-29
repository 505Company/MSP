import type { ContentBlock } from '../lib/presentations/studio/contract'
import { minimumReadableSize } from '../lib/presentations/studio/readability'
import type {TextElementIR} from '../vendor/drag/src/core/model'
import {textGeometry} from './layout-execution'

/** Fixed source artwork (for example, a short label inside a pill) cannot grow
 * with its text. If it needs severe shrinking, try another library component
 * or the recipe's open text area instead of losing the source hierarchy. */
export function nativeTextKeepsHierarchy(box:HTMLElement){
  for(const field of box.querySelectorAll<SVGSVGElement>('[data-native-source]')){
    const source=JSON.parse(field.dataset.nativeSource!) as TextElementIR
    const original=[source.fontSize,...source.styleRuns?.map(r=>r.fontSize)??[],...source.paragraphs?.map(p=>p.fontSize)??[]].filter((n):n is number=>typeof n==='number'&&n>0)
    const rendered=[...field.querySelectorAll('text')].filter(t=>t.textContent?.trim()).map(t=>parseFloat(getComputedStyle(t).fontSize)).filter(n=>n>0)
    // Both values use local SVG coordinates, independent of component scale.
    if(original.length&&rendered.length&&Math.min(...rendered)<Math.min(...original)*.7)return false
  }
  return true
}

/** The recipe supplies the text area; actual browser line wrapping determines
 * the size. Limits retain hierarchy instead of making a short caption a poster. */
export function maximumTextSize(role: string) {
  return role==='grid-value'?128:role==='grid-label'?56:/display|^title$/.test(role) ? 224 : /metric-value|fact-value|hero-value/.test(role) ? 280
    : /heading|title|quote$/.test(role) ? 112 : /marker|index/.test(role) ? 96
    : /footer|caption|author|metadata|page|source|footnote|note/.test(role) ? 40 : 72
}

/** SVG text is drawn glyph by glyph. A bounding-box test alone accepts
 * a word split across two lines; inspect adjacent glyph baselines too. */
export function nativeWordsFit(box:HTMLElement){
  for(const field of box.querySelectorAll('[data-native-source]')){
    let previous:DOMRect|undefined,cursor=0
    const source=JSON.parse(field.getAttribute('data-native-source')??'{}') as {text?:string}
    for(const glyph of field.querySelectorAll<SVGTextElement>('text')){
      const value=glyph.textContent??'',r=glyph.getBoundingClientRect(),start=source.text?.indexOf(value,cursor)??-1
      // Explicit line breaks need not have a drawn SVG glyph. They remain
      // legitimate word boundaries in the underlying editable source.
      if(start>=cursor){if(/\s/u.test(source.text!.slice(cursor,start)))previous=undefined;cursor=start+value.length}
      if(!value.trim()){previous=undefined;continue}
      if(previous&&!/^[\s—–-]/u.test(value)&&Math.abs(r.bottom-previous.bottom)>Math.max(r.height,previous.height)*.55)return false
      previous=/[\s—–-]$/u.test(value)?undefined:r
    }
  }
  return true
}
export function textFitsBox(box: HTMLElement) {
  if(!nativeWordsFit(box))return false
  const bounds = box.getBoundingClientRect()
  if (box.scrollWidth > bounds.width + 1 || box.scrollHeight > bounds.height + 1) return false
  for (const field of box.querySelectorAll<HTMLElement>('[data-field], [data-source-text]')) {
    // Range includes the font's invisible ascent/descent reserves. Noto Sans
    // can extend above a perfectly fitting line at every size; use the same
    // actual-ink geometry as the authored layout executor.
    const rects=field.namespaceURI==='http://www.w3.org/2000/svg'?[...field.querySelectorAll('text')].map(el=>el.getBoundingClientRect()):textGeometry(field).ink
    for (const r of rects) if (r.width && r.height && (r.left < bounds.left - 1 || r.top < bounds.top - 1 || r.right > bounds.right + 1 || r.bottom > bounds.bottom + 1)) return false
  }
  return true
}

/** Shrink related fields together; grow each up to its own role cap. The largest fitting size
 * wins; source text, recipe areas and four-pixel type steps stay unchanged. */
export function fitRecipeText(box: HTMLElement, block: ContentBlock, headingLimit = Infinity, shrink=true,maximum=Infinity) {
  const fields = [...box.querySelectorAll<HTMLElement>('[data-field]')]
  if (!fields.length) return
  const sizes = fields.map(el => parseFloat(getComputedStyle(el).fontSize))
  const caps = fields.map(el => Math.min(maximum,Math.max(parseFloat(el.style.fontSize), Math.min(maximumTextSize(el.dataset.typeRole ?? 'body'), block.role === 'body' && block.kind !== 'metric' ? headingLimit : Infinity))))
  let low = shrink?0:1000, high = Math.floor(Math.max(...caps.map((cap, i) => cap / sizes[i])) * 1000)
  const apply = (scale: number) => fields.forEach((el, i) => { el.style.fontSize = `${Math.max(minimumReadableSize(block, el.dataset.field!), Math.floor(Math.min(caps[i],sizes[i] * scale / 1000) / 4) * 4)}px` })
  apply(low)
  if (!textFitsBox(box)) { fields.forEach((el,i)=>{el.style.fontSize=`${sizes[i]}px`}); return }
  while (low < high) {
    const mid = Math.ceil((low + high) / 2); apply(mid)
    if (textFitsBox(box)) low = mid; else high = mid - 1
  }
  apply(low)
  // A wide value can hit its width limit before a caption fills its area.
  // Grow each typographic role separately after finding the shared safe fit;
  // repeated list rows still share one size, instead of growing the first row.
  const roles=[...new Set(fields.map(el=>el.dataset.typeRole??'body'))]
  for(const role of roles){
    const indices=fields.flatMap((el,i)=>(el.dataset.typeRole??'body')===role?[i]:[])
    let floor=Math.floor(Math.min(...indices.map(i=>parseFloat(fields[i].style.fontSize)))/4)
    let ceiling=Math.floor(Math.min(...indices.map(i=>caps[i]))/4)
    const paint=(step:number)=>indices.forEach(i=>{fields[i].style.fontSize=`${Math.max(minimumReadableSize(block,fields[i].dataset.field!),step*4)}px`})
    paint(floor)
    while(floor<ceiling){const mid=Math.ceil((floor+ceiling)/2);paint(mid);if(textFitsBox(box))floor=mid;else ceiling=mid-1}
    paint(floor)
  }
}
