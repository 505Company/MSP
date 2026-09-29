import {test,expect} from '@playwright/test'
import JSZip from 'jszip'
import {deflateSync} from 'node:zlib'
import {controlPptx} from '../fixtures/control-pptx'

/** Three ordinary PNGs individually below the source pixel/byte budgets, but
 * over 16 MiB combined. Only their small masked crops belong in PageIR. */
function noiseImage() {
 const crc=(bytes:Buffer)=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0)}return(c^0xffffffff)>>>0}
 const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,sum])}
 const size=1500,header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2
 const raw=Buffer.alloc(size*(1+size*3));let state=34231
 for(let y=0;y<size;y++)for(let x=0;x<size*3;x++){state=(Math.imul(state,1664525)+1013904223)>>>0;raw[y*(1+size*3)+1+x]=state>>>24}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
test('collage crops retain original pictures while only the visible regions consume the page budget',async({page})=>{
 const zip=await JSZip.loadAsync(await controlPptx()),source=await zip.file('ppt/slides/slide1.xml')!.async('string'),picture=source.match(/<p:pic>[\s\S]*?<\/p:pic>/)![0],png=noiseImage()
 expect(png.length*3).toBeGreaterThan(16*1024*1024)
 const pictures=Array.from({length:3},(_,i)=>picture.replace(/id="21"/,`id="${100+i}"`).replace('rImage',`rNoise${i}`).replace('prst="rect"','prst="ellipse"').replace('<a:srcRect l="25000" r="25000"/>',`<a:srcRect l="${i*10000}" r="20000"/>`)).join('')
 const masked=source.replace(/(<p:spTree>)[\s\S]*?(<\/p:spTree>)/,`$1${pictures}$2`)
 zip.file('ppt/slides/slide1.xml',masked)
 const rel=await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
 zip.file('ppt/slides/_rels/slide1.xml.rels',rel.replace('</Relationships>',[0,1,2].map(i=>`<Relationship Id="rNoise${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/noise${i}.png"/>`).join('')+'</Relationships>'))
 for(let i=0;i<3;i++)zip.file(`ppt/media/noise${i}.png`,png)
 await page.goto('/');await page.addScriptTag({url:'/pptx-reader.js'})
 const read=async()=>page.evaluate(async base64=>{
  const reader=(window as unknown as {MspPptxReader:typeof import('../../browser/prepare')}).MspPptxReader
  const result=await reader.rereadSourceSlides(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),'Synthetic collage.pptx',[1])
  return {warnings:result.snapshot.slides[0].warnings,rasters:result.snapshot.elements.filter(e=>e.kind==='raster').length,originals:result.assets.filter(a=>a.origins.some(o=>o.startsWith('ppt/media/'))).map(a=>a.bytes.length),normalizedBytes:result.assets.filter(a=>a.origins.some(o=>o.includes('#normalized:'))).reduce((n,a)=>n+a.bytes.length,0)}
 },(await zip.generateAsync({type:'nodebuffer'})).toString('base64'))
 const actual=await read()
 expect(actual.warnings.some(w=>w.startsWith('normalized-page-unavailable'))).toBe(false)
 expect(actual.rasters).toBe(3);expect(actual.originals).toContain(png.length);expect(actual.normalizedBytes).toBeLessThan(400_000)
 // The same limit remains effective for genuinely retained native resources.
 zip.file('ppt/slides/slide1.xml',masked.replaceAll('prst="ellipse"','prst="rect"'))
 expect((await read()).warnings.some(w=>w.includes('page-image-byte-limit'))).toBe(true)
})
