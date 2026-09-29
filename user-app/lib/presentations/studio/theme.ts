import type { StudioLibrary } from './contract'
import {contrast} from './color-zones'

const snap=(n:number)=>Math.round(n/4)*4
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))
const lightness=(hex:string)=>rgb(hex).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0)
const chroma=(hex:string)=>Math.max(...rgb(hex))-Math.min(...rgb(hex))
const valid=(hex:string|undefined):hex is string=>!!hex&&/^#[\da-f]{6}$/i.test(hex)

/** A slide's actual canvas is stronger evidence than its palette. Palette
 * frequency also counts chart labels and cannot identify the canvas color. */
export function sourceBackground(library:StudioLibrary){
  const fills=library.backgrounds?.fills.filter(f=>f.element.fill?.color).sort((a,b)=>b.slides.length-a.slides.length)
  const color=fills?.[0]?.element.fill?.color
  return color?'#'+[color.r,color.g,color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase():undefined
}
export function contrastingInk(library:StudioLibrary,background:string,preferred?:string,minimum=4.5){
  if(valid(preferred)&&contrast(preferred,background)>=minimum)return preferred
  return library.tokens.colors.map(c=>c.hex).filter(valid).sort((a,b)=>contrast(b,background)-contrast(a,background))[0]
}

/** Prepared content fields are stronger typography evidence than raw occurrence
 * counts: a chart may contain hundreds of tiny Arial data labels. */
export function studioFonts(library:StudioLibrary){
  const fonts=library.tokens.fonts.map(f=>({...f,sizes:[...f.sizes]}))
  const fields=Object.values(library.prepared).flatMap(p=>p.profile.fields)
  for(const field of fields){
    const font=fonts.find(f=>f.family===field.font)
    if(!font)fonts.push({family:field.font,sizes:[field.size],occurrences:0})
    else if(!font.sizes.includes(field.size))font.sizes.push(field.size)
  }
  const score=(f:typeof fonts[number])=>{
    const prepared=fields.filter(p=>p.font===f.family).length
    const rule=library.rules.some(r=>r.toLowerCase().includes(f.family.toLowerCase()))
    return Number(rule)*100000+prepared*1000+Number(f.sizes.some(s=>s>=48))*100+Math.log2(f.occurrences+1)
  }
  return fonts.sort((a,b)=>score(b)-score(a))
}

export function studioTheme(library:StudioLibrary,fontOverride?:string,canvasFillId?:string){
  const colors=library.tokens.colors.map(c=>c.hex).filter(c=>/^#[\da-f]{6}$/i.test(c))
  const ordered=[...colors].sort((a,b)=>lightness(b)-lightness(a)),font=studioFonts(library).find(f=>!fontOverride||f.family===fontOverride)
  if(!font||!ordered.length)throw Error('В дизайн-системе отсутствует типографика или палитра.')
  const declared=library.rules.filter(r=>/фирменн|основн.*цвет|brand|primary/iu.test(r)).flatMap(r=>r.match(/#[\da-f]{6}\b/ig)??[])
  const fill=library.backgrounds?.fills.find(f=>f.id===canvasFillId)?.element.fill?.color
  const background=fill?'#'+[fill.r,fill.g,fill.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase():sourceBackground(library)??ordered[0],ink=contrastingInk(library,background)
  const accent=declared.map(hex=>colors.find(c=>c.toLowerCase()===hex.toLowerCase())).find(Boolean)??[...library.tokens.colors].filter(c=>valid(c.hex)&&chroma(c.hex)>50&&contrast(c.hex,background)>=3).sort((a,b)=>b.occurrences-a.occurrences)[0]?.hex??ink
  const fields=Object.values(library.prepared).flatMap(p=>p.profile.fields).filter(f=>f.font===font.family)
  const bodySizes=fields.filter(f=>['body','caption'].includes(f.role)).map(f=>f.size).filter(s=>s>=24&&s<=40).sort((a,b)=>a-b)
  const body=snap(bodySizes[Math.floor(bodySizes.length/2)]??32)
  const headingSizes=font.sizes.filter(s=>s>=56&&s<=88).sort((a,b)=>Math.abs(a-64)-Math.abs(b-64))
  const titleColors=[...library.editable.filter(t=>t.kind==='text'&&t.data.title&&!t.data.text&&!/^\d+$/.test(t.data.title)).map(t=>t.style.color),...fields.filter(f=>f.role==='title').map(f=>f.color)].filter(valid)
  const titleInk=titleColors.filter(c=>contrast(c,background)>=3).sort((a,b)=>titleColors.filter(c=>c===b).length-titleColors.filter(c=>c===a).length)[0]??(sourceBackground(library)?ink:accent)
  const numbers=fields.filter(f=>f.role==='number'&&contrast(f.color,background)>=3).map(f=>f.color)
  const metricInk=numbers.sort((a,b)=>numbers.filter(c=>c===b).length-numbers.filter(c=>c===a).length)[0]??accent
  return {font:font.family,background,ink,accent,titleInk,metricInk,sourceStyle:!!sourceBackground(library),body,title:snap(headingSizes[0]??body*2),heading:snap(body*1.5),metric:snap(body*5)}
}

/** The model sees the visual differences that actually exist in the library. */
export function componentAppearance(library:StudioLibrary,id:string){
  const profile=library.prepared[id]?.profile
  if(profile)return {background:profile.source.background,colors:[...new Set([
    ...profile.fields.map(f=>f.color),...profile.source.graphic.match(/#[\da-f]{6}\b/ig)??[],
  ])],fields:profile.fields.map(f=>({role:f.role,font:f.font,size:f.size,weight:f.weight,color:f.color})),states:profile.states,hasArtwork:!!profile.artwork||!!profile.source.graphic}
  return library.editable.find(t=>t.id===id)?.style
}

/** Keep the DS hue, lifting neutral cards on dark canvases just enough to
 * distinguish their boundaries. Text keeps its own contrast requirement. */
function distinguishPanel(library:StudioLibrary,background:string,canvas:string){
  if(lightness(canvas)>=128||chroma(background)>70||contrast(background,canvas)>=1.6)return background
  const neutrals=library.tokens.colors.map(c=>c.hex).filter(c=>valid(c)&&chroma(c)<40&&lightness(c)>lightness(background)).sort((a,b)=>lightness(a)-lightness(b))
  const target=neutrals.find(c=>contrast(c,canvas)>=1.6)
  if(!target)return background
  const from=rgb(background),to=rgb(target)
  for(let amount=.05;amount<=1.001;amount+=.05){
    const lifted='#'+from.map((v,i)=>Math.round(v+(to[i]-v)*amount).toString(16).padStart(2,'0')).join('').toUpperCase()
    if(contrast(lifted,canvas)>=1.6)return lifted
  }
  return target
}

/** Primitive fallback inherits the DS surface and checks both text and canvas contrast. */
export function studioSurface(library:StudioLibrary,kind:'panel'|'accent',canvas?:string){
  const base=studioTheme(library),theme=canvas?{...base,background:canvas,ink:contrastingInk(library,canvas)}:base
  const inverse=library.tokens.colors.map(c=>c.hex).filter(c=>valid(c)&&lightness(c)>=230).sort((a,b)=>lightness(b)-lightness(a))[0]??'#FFFFFF'
  for(const {profile:p} of Object.values(library.prepared)){
    let background=p.source.background??[...p.source.graphic.matchAll(/fill="(#[\da-f]{6})"/ig)].map(m=>m[1]).find(c=>c.toLowerCase()!==theme.background.toLowerCase())
    if(!background||background.toLowerCase()===theme.background.toLowerCase())continue
    if((kind==='accent')!==(chroma(background)>70))continue
    if(kind==='panel'&&chroma(background)>24)continue
    if(kind==='panel'&&lightness(theme.background)>=128&&contrast(background,theme.background)<1.2)continue
    if(kind==='panel')background=distinguishPanel(library,background,theme.background)
    return {background,ink:contrastingInk(library,background,kind==='accent'?inverse:p.fields.find(f=>['body','caption'].includes(f.role))?.color??p.fields[0].color,kind==='accent'?3:4.5)}
  }
  const dark=lightness(theme.background)<128
  const background=kind==='accent'?theme.accent:distinguishPanel(library,library.tokens.colors.map(c=>c.hex).filter(c=>valid(c)&&chroma(c)<(dark?40:70)&&(dark?lightness(c)<80:lightness(c)>180&&contrast(c,theme.background)>=1.2)&&c.toLowerCase()!==theme.background.toLowerCase()).sort((a,b)=>(dark?0:chroma(a)-chroma(b))||Math.abs(lightness(a)-lightness(theme.background))-Math.abs(lightness(b)-lightness(theme.background)))[0]??theme.background,theme.background)
  return {background,ink:contrastingInk(library,background,kind==='accent'?inverse:theme.ink,kind==='accent'?3:4.5)}
}
