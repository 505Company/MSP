import type { ElementIR,TextElementIR } from '../vendor/drag/src/core/model'
import type { ComponentIssue } from '../lib/design-system/types'

const loaded=new Map<string,Promise<boolean>>()
const captureSources=new Map<string,{family:string;style:string;source:string|Uint8Array;unicodeRange?:string}>()
type Face={family:string;style:string}
export async function registerEmbeddedFont(family:string,style:string,source:string|Uint8Array,substitution?:string,unicodeRange?:string){
  const face=new FontFace(family,typeof source==='string'?`url(${JSON.stringify(source)})`:new Uint8Array(source),{weight:style.includes('Bold')?'700':'400',style:style.includes('Italic')?'italic':'normal',...(unicodeRange?{unicodeRange}:{})})
  if(substitution)(face as FontFace & {mspSubstitution?:string}).mspSubstitution=substitution
  await face.load();document.fonts.add(face);loaded.delete(`${family}:${style}`)
  captureSources.set(`${family}:${style}:${unicodeRange??''}`,{family,style,source,unicodeRange})
}
/** Embed the same resolved faces when an audit captures the actual HTML.
 * FontFace registrations alone are absent from cloned SVG/foreignObject CSS. */
export async function captureSourceFontCss(signal?:AbortSignal){
  const css:string[]=[]
  for(const f of captureSources.values()){
    signal?.throwIfAborted()
    let bytes:Uint8Array
    if(typeof f.source==='string'){const r=await fetch(f.source,{signal});if(!r.ok)throw Error('Не удалось встроить шрифт превью аудита');bytes=new Uint8Array(await r.arrayBuffer())}
    else bytes=f.source
    let data='';for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192))
    css.push(`@font-face{font-family:${JSON.stringify(f.family)};font-weight:${f.style.includes('Bold')?'700':'400'};font-style:${f.style.includes('Italic')?'italic':'normal'};src:url(data:font/woff2;base64,${btoa(data)});${f.unicodeRange?`unicode-range:${f.unicodeRange};`:''}}`)
  }
  return css.join('\n')
}
const uploads=new Map<string,Promise<string[]>>()
type FontSource=Face&{url?:string;bytes?:Uint8Array}
const googleLoads=new Map<string,Promise<boolean>>()
async function loadGoogleFont(face:Face,family=face.family){
 const key=`${face.family}:${face.style}:${family}`;let pending=googleLoads.get(key)
 if(!pending){pending=(async()=>{
  const query=new URLSearchParams({family,style:face.style}),r=await fetch(`/api/fonts/google?${query}`);if(!r.ok)return false
  const font=await r.json() as {files:{url:string;unicodeRange?:string}[]};if(!font.files.length)return false
  if(family!==face.family)await Promise.all(font.files.map(f=>registerEmbeddedFont(family,face.style,f.url,undefined,f.unicodeRange)))
  await Promise.all(font.files.map(f=>registerEmbeddedFont(face.family,face.style,f.url,family===face.family?undefined:`${family} (Google Fonts)`,f.unicodeRange)))
  return true
 })().catch(()=>false);googleLoads.set(key,pending)}
 return pending
}
const category=(s:string)=>/mono|courier|consolas|menlo/i.test(s)?'mono':/sans|arial|calibri|helvetica/i.test(s)?'sans':/serif|times|georgia/i.test(s)?'serif':null
/** Prefer the original face. Substitutions use the same broad font category,
 * with template fonts ahead of generic choices; layout qualification is still
 * required. This is a fallback policy, not a claim of identical typography. */
export async function resolveSourceFonts(fonts:FontSource[],requested:Face[]){
 const faces=[...new Map(requested.map(f=>[`${f.family}:${f.style}`,f])).values()]
 await Promise.all(faces.map(async face=>{
  if(await ensureFace(face)||await loadGoogleFont(face))return
  const kind=category(face.family);if(!kind)return
  const alternative=fonts.find(f=>category(f.family)===kind&&f.style===face.style)
  const template=fonts.find(f=>category(f.family)===kind&&f.style==='Regular')?.family
  const fallback=template??({sans:'Noto Sans',serif:'Noto Serif',mono:'Roboto Mono'}[kind])
  if(await loadGoogleFont(face,fallback))return
  if(alternative&&(alternative.url||alternative.bytes))try{await registerEmbeddedFont(face.family,face.style,alternative.url??alternative.bytes!,alternative.family)}catch{/* Qualification reports the missing face. */}
 }))
 return [...new Set(faces.flatMap(face=>{const f=registeredFace(face);return f?.mspSubstitution?[`«${face.family}» → «${f.mspSubstitution}»`]:[]}))]
}
export async function ensureUploadFonts(uploadId:string){
 let pending=uploads.get(uploadId)
 if(!pending){pending=(async()=>{
  const r=await fetch(`/api/uploads/${uploadId}/fonts`);if(!r.ok)throw Error('Не удалось загрузить шрифты исходной презентации')
  const data=await r.json() as {fonts:FontSource[];requested?:Face[]}
  await Promise.allSettled(data.fonts.map(f=>registerEmbeddedFont(f.family,f.style,f.url!)))
  return resolveSourceFonts(data.fonts,data.requested??[])
 })().catch(e=>{uploads.delete(uploadId);throw e});uploads.set(uploadId,pending)}
 return pending
}
function registeredFace(face:Face){return [...document.fonts].find(f=>f.family.replace(/^['"]|['"]$/g,'')===face.family&&f.status==='loaded'&&f.weight===(face.style.includes('Bold')?'700':'400')&&f.style===(face.style.includes('Italic')?'italic':'normal')) as (FontFace&{mspSubstitution?:string})|undefined}
async function ensureFace({family,style}:Face){
  if(/^(serif|sans-serif|monospace|system-ui)$/i.test(family))return true
  if(registeredFace({family,style}))return true
  const key=`${family}:${style}`
  let pending=loaded.get(key)
  if(!pending){
    const weight=style.includes('Bold')?'700':'400',italic=style.includes('Italic')
    pending=(async()=>{
      if(family==='Play'&&!italic){
        await registerEmbeddedFont('Play',style,`/fonts/play/Play-${weight==='700'?'Bold':'Regular'}.ttf`);return true
      }
      // Probe the requested face, not a generic fallback that document.fonts.check accepts.
      const full=style==='Regular'?family:`${family} ${style}`
      // PPTX/Figma family names may be full native face names that CSS does not
      // resolve on its own. Register the face under the name used by the scene;
      // a successful probe without registration still painted a fallback font.
      const face=new FontFace(family,`local(${JSON.stringify(full)})`,{weight,style:italic?'italic':'normal'})
      await face.load();document.fonts.add(face);return true
    })().catch(()=>false)
    loaded.set(key,pending)
  }
  return pending
}

export async function ensureSceneFonts(elements:ElementIR[]):Promise<ComponentIssue[]>{
  const faces=new Map<string,Face>()
  const visit=(items:ElementIR[])=>{for(const e of items){
    if(!e.visible)continue
    if(e.kind==='text')for(const r of [e,...e.styleRuns??[]] as Array<Pick<TextElementIR,'fontFamily'|'fontStyle'>>){const face={family:r.fontFamily,style:r.fontStyle??'Regular'};faces.set(`${face.family}:${face.style}`,face)}
    if('children' in e)visit(e.children)
  }}
  visit(elements)
  const issues:ComponentIssue[]=[]
  for(const face of faces.values()){
    if(!await ensureFace(face))issues.push({code:'font-unavailable',message:`Шрифт «${face.family}» (${face.style}) недоступен. Для точного оформления нужен этот шрифт; сейчас используется замена.`})
    else {const actual=registeredFace(face)
      if(actual?.mspSubstitution)issues.push({code:'font-substitution',severity:'warning',message:`Шрифт «${face.family}» (${face.style}) заменён на «${actual.mspSubstitution}».`})
    }
  }
  await document.fonts.ready
  return issues
}

/** Export the resolved face name, while leaving the imported source immutable. */
export function materializeFontSubstitutions<T extends {scene:{elements:ElementIR[]}}>(source:T):T{
 const result=structuredClone(source)
 const visit=(elements:ElementIR[])=>{for(const e of elements){
  if(e.kind==='text')for(const r of [e,...e.styleRuns??[]]){const replacement=registeredFace({family:r.fontFamily,style:r.fontStyle??'Regular'})?.mspSubstitution;if(replacement)r.fontFamily=replacement.replace(/ \(Google Fonts\)$/,'')}
  if('children' in e)visit(e.children)
 }}
 visit(result.scene.elements);return result
}
