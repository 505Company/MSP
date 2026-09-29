import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {readFile} from 'node:fs/promises'
import {combinePptxSlides, writeEditablePptx} from '../lib/slides/pptx-package'
import {powerpointFont, type PptxFont} from '../lib/slides/pptx-fonts'
import {extractEmbeddedFonts,fontBytes} from '../lib/uploads/embedded-fonts'
import {Font} from 'fonteditor-core'
import type {ComponentDefinition} from '../lib/design-system/types'

const empty:ComponentDefinition={id:'s',name:'Slide',kind:'compound',source:{slide:1,rootId:'s',elementIds:[],ancestorIds:[],assetIds:[]},scene:{width:1920,height:1080,elements:[]},slots:[],fixedTextIds:[],issues:[],semantics:[]}

test('combining slides gives every master and layout a presentation-wide unique ID (PowerPoint repair regression)',async()=>{
  const slide=await writeEditablePptx(empty,[])
  const deck=await JSZip.loadAsync(await combinePptxSlides([slide,slide,slide],'Combined'))
  const ids:string[]=[]
  for(const entry of Object.values(deck.files))if(!entry.dir&&entry.name.endsWith('.xml')){
    const xml=await entry.async('string')
    ids.push(...[...xml.matchAll(/<p:sld(?:Master|Layout)Id\s+id="(\d+)"/g)].map(m=>m[1]))
  }
  assert.equal(ids.length,6)
  assert.equal(new Set(ids).size,ids.length,'PowerPoint repairs duplicate layout IDs, even in different masters')
  assert.ok(ids.every(id=>Number(id)>=2147483648))
})

const play=async(style:'Regular'|'Bold'):Promise<PptxFont>=>({family:'Play',style,bytes:new Uint8Array(await readFile(new URL(`../public/fonts/play/Play-${style}.ttf`,import.meta.url)))})
const fontTables=(bytes:Uint8Array)=>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  return new Map(Array.from({length:view.getUint16(4)},(_,i)=>{
    const p=12+i*16,offset=view.getUint32(p+8),length=view.getUint32(p+12)
    return [String.fromCharCode(...bytes.subarray(p,p+4)),bytes.slice(offset,offset+length)] as const
  }))
}
test('the combined deck embeds complete regular and bold fonts once and can be reimported without installed fonts',async()=>{
  const fonts=await Promise.all([play('Regular'),play('Bold')]),scene=structuredClone(empty)
  scene.scene.elements.push({id:'text',name:'Text',kind:'text',bounds:{x:50,y:40,width:500,height:100},rotation:0,visible:true,opacity:1,zIndex:1,text:'Путешествия ABC 123',fontFamily:'Play',fontSize:32})
  const slide=await writeEditablePptx(scene,[])
  const bytes=await combinePptxSlides([slide,slide],'Fonts',[...fonts,...fonts]),zip=await JSZip.loadAsync(bytes)
  const xml=await zip.file('ppt/presentation.xml')!.async('string')
  assert.match(xml,/embedTrueTypeFonts="1" saveSubsetFonts="0"/)
  assert.equal((xml.match(/<p:embeddedFont>/g)??[]).length,1)
  assert.match(xml,/<p:regular r:id="mspFont1"\/><p:bold r:id="mspFont2"\/>/)
  assert.equal(Object.keys(zip.files).filter(p=>p.endsWith('.fntdata')).length,2)
  assert.match(await zip.file('[Content_Types].xml')!.async('string'),/Extension="fntdata" ContentType="application\/x-fontdata"/)
  const restored=extractEmbeddedFonts(bytes)
  assert.equal(restored.length,2)
  assert.match(restored[0].family,/^MSP Play [a-f0-9]{8}$/)
  assert.equal(restored[0].family,restored[1].family)
  const text=await zip.file('ppt/decks/s1/slides/slide1.xml')!.async('string')
  assert.ok(text.includes(`typeface="${restored[0].family}"`))
  assert.ok(!text.includes('typeface="Play"'))
  for(const [i,font] of restored.entries()){
    assert.equal(font.style,fonts[i].style)
    const parsed=Font.create(new Uint8Array(font.bytes).buffer,{type:'ttf'}).get()
    assert.equal(parsed.name.fontFamily,font.family);assert.equal(parsed.name.fontSubFamily,font.style)
    const original=fontTables(fonts[i].bytes),stored=fontTables(font.bytes)
    for(const [name,data] of original)if(!['head','name','DSIG'].includes(name))assert.deepEqual(stored.get(name),data,`${name}: keep all glyphs, shaping, kerning and hinting`)
    assert.equal(parsed.name.licence,Font.create(new Uint8Array(fonts[i].bytes).buffer,{type:'ttf'}).get().name.licence)
    const sfnt=new DataView(font.bytes.buffer,font.bytes.byteOffset,font.bytes.byteLength)
    let sum=0;for(let p=0;p<font.bytes.length;p+=4)sum=(sum+sfnt.getUint32(p))>>>0
    assert.equal(sum,0xb1b0afba,'sfnt checksums survive renaming')
    const packed=await zip.file(`ppt/fonts/font${i+1}.fntdata`)!.async('uint8array'),view=new DataView(packed.buffer)
    assert.equal(view.getUint32(0,true),packed.length);assert.equal(view.getUint32(8,true),0x20001)
    assert.equal(view.getUint32(12,true),0,'no subsetting or compression');assert.equal(view.getUint16(34,true),0x504c)
    assert.deepEqual(fontBytes(packed),font.bytes)
  }
})

test('font export refuses corrupt, restricted and conflicting fonts instead of silently changing the presentation',async()=>{
  const font=await play('Regular'),restricted=font.bytes.slice(),v=new DataView(restricted.buffer)
  for(let i=0;i<v.getUint16(4);i++){
    const p=12+i*16;if(String.fromCharCode(...restricted.subarray(p,p+4))==='OS/2')v.setUint16(v.getUint32(p+8)+8,2)
  }
  assert.throws(()=>powerpointFont({...font,bytes:restricted}),/лицензия запрещает/)
  assert.throws(()=>powerpointFont({...font,bytes:font.bytes.slice(0,100)}),/повреждена/)
  const slide=await writeEditablePptx(empty,[]),other=font.bytes.slice();other[0]^=1
  await assert.rejects(()=>combinePptxSlides([slide,slide],'Conflict',[font,{...font,bytes:other}]),/разные версии/)
})
