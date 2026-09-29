import {z} from 'zod'
export const googleFontQuery=z.object({family:z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} ._-]+$/u),style:z.enum(['Regular','SemiBold','Bold','Italic','Bold Italic']).default('Regular')})
export type GoogleFont= {family:string;style:string;files:{key:string;mime:string;unicodeRange?:string}[];checkedAt:number}
const json={httpMetadata:{contentType:'application/json'}}
export function googleFontUrl(family:string,style:string){
 const url=new URL('https://fonts.googleapis.com/css2')
 url.searchParams.set('family',`${family}:ital,wght@${style.includes('Italic')?1:0},${style==='SemiBold'?600:style.includes('Bold')?700:400}`);url.searchParams.set('display','swap');return url.href
}
export function googleFontSources(css:string){
 return [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([,block])=>{
  const value=block.match(/src:\s*url\(([^)]+)\)/)?.[1]?.replace(/^['"]|['"]$/g,'');if(!value)throw Error('Некорректный ответ Google Fonts')
  const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='fonts.gstatic.com'||url.port||url.username||url.password||!url.pathname.startsWith('/s/'))throw Error('Недопустимый источник шрифта')
  const unicodeRange=block.match(/unicode-range:\s*([^;]+)/)?.[1]?.trim()
  if(unicodeRange&&!/^U\+[\da-f?-]+(?:\s*,\s*U\+[\da-f?-]+)*$/i.test(unicodeRange))throw Error('Некорректный диапазон шрифта')
  return {url:url.href,...(unicodeRange?{unicodeRange}:{})}
 })
}
/** Public font files are cached in our storage. Only family/style are sent to
 * Google; slide text, images and text-subsetting parameters are never sent. */
export async function googleFont(bucket:R2Bucket,raw:unknown):Promise<GoogleFont>{
 const {family,style}=googleFontQuery.parse(raw),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${family}:${style}`)),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),prefix=`fonts/google/v1/${hash}`
 const cached=await bucket.get(`${prefix}/manifest.json`)
 if(cached){const saved=await cached.json<GoogleFont>();if(Date.now()-saved.checkedAt<(saved.files.length?30:1)*86400000)return saved}
 const response=await fetch(googleFontUrl(family,style),{redirect:'manual',signal:AbortSignal.timeout(10000)})
 const manifest:GoogleFont={family,style,files:[],checkedAt:Date.now()}
 if(response.status===400||response.status===404){await bucket.put(`${prefix}/manifest.json`,JSON.stringify(manifest),json);return manifest}
 if(!response.ok)throw Error('Google Fonts временно недоступен')
 const css=await response.text();if(css.length>100000)throw Error('Слишком большой ответ Google Fonts')
 const sources=googleFontSources(css);if(!sources.length||sources.length>40)throw Error('Google Fonts не вернул шрифт')
 for(const [i,source] of sources.entries()){
  const file=await fetch(source.url,{redirect:'manual',signal:AbortSignal.timeout(10000)})
  if(!file.ok||Number(file.headers.get('content-length'))>8*1024*1024)throw Error('Не удалось загрузить шрифт')
  const bytes=new Uint8Array(await file.arrayBuffer()),sig=String.fromCharCode(...bytes.slice(0,4)),mime=sig==='wOF2'?'font/woff2':sig==='wOFF'?'font/woff':sig==='OTTO'?'font/otf':bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0?'font/ttf':null
  if(!mime||bytes.length>8*1024*1024)throw Error('Некорректный файл шрифта')
  const key=`${prefix}/${i}`;await bucket.put(key,bytes,{httpMetadata:{contentType:mime}});manifest.files.push({key,mime,...(source.unicodeRange?{unicodeRange:source.unicodeRange}:{})})
 }
 await bucket.put(`${prefix}/manifest.json`,JSON.stringify(manifest),json);return manifest
}
