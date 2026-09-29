import type { Box, ContentSlide, StudioLibrary } from './contract'

/** Legacy metadata is retained only to read and restore saved v1 receipts. */
export const COLOR_ZONE_VERSION = 'brand-zones-1' as const
export type ColorZone = { version: typeof COLOR_ZONE_VERSION; axis: 'vertical'|'horizontal'; fraction: .5|.4|.25; side: 'start'|'end'; color: string; rect: Box; minContrast: number }
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
export function luminance(hex:string){return rgb(hex).reduce((sum,v,i)=>sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i],0)}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
export function paletteColors(library:StudioLibrary){return [...new Set(library.tokens.colors.map(c=>c.hex.toUpperCase()).filter(c=>/^#[\dA-F]{6}$/.test(c)))]}
export const slideNumber=(slide:ContentSlide)=>Number(slide.id.match(/(\d+)$/)?.[1]??1)
export function overlap(a:Box,b:Box){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))}
export function zoneRect(axis:ColorZone['axis'],fraction:ColorZone['fraction'],side:ColorZone['side']):Box{
  const w=axis==='vertical'?1920*fraction:1920,h=axis==='horizontal'?1080*fraction:1080
  return {x:side==='end'?1920-w:0,y:side==='end'?1080-h:0,w,h}
}
