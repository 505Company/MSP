import type JSZip from 'jszip'
import {fontBytes} from '../uploads/embedded-fonts'
import {pptxFamilyName,renamePptxFont} from './pptx-font-names'

export type PptxFontStyle = 'Regular' | 'Bold' | 'Italic' | 'Bold Italic'
export type PptxFont = {family: string; style: PptxFontStyle; bytes: Uint8Array}
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export const fontKey = (font:Pick<PptxFont,'family'|'style'>) => `${font.family.toLowerCase()}:${font.style}`

/** PowerPoint expects an EOT container in application/x-fontdata, not Word's
 * obfuscated-font format. Embed the complete sfnt so later edits have all glyphs.
 * https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/1663dabc-5d98-463f-889e-bcd9b77c3d34
 * https://www.w3.org/submissions/EOT/ (version 0x00020001)
 */
export function powerpointFont(font:PptxFont):Uint8Array {
  const data=fontBytes(font.bytes)
  const fail=(message:string):never=>{throw Error(`Шрифт «${font.family}» (${font.style}): ${message}`)}
  if(!data||data.length>8*1024*1024) return fail('для встраивания нужен файл TTF или OTF.')
  const source=new DataView(data.buffer,data.byteOffset,data.byteLength), tables=new Map<string,DataView>()
  const count=source.getUint16(4)
  if(!count||12+count*16>data.length)return fail('повреждена таблица шрифта.')
  for(let i=0;i<count;i++){
    const p=12+i*16,tag=String.fromCharCode(...data.subarray(p,p+4)),offset=source.getUint32(p+8),length=source.getUint32(p+12)
    if(offset>data.length||length>data.length-offset)return fail('повреждена таблица шрифта.')
    tables.set(tag,new DataView(data.buffer,data.byteOffset+offset,length))
  }
  const os=tables.get('OS/2'),head=tables.get('head'),names=tables.get('name')
  if(!head||head.byteLength<54||!names||names.byteLength<6||os&&os.byteLength<68)return fail('не хватает данных для встраивания.')
  const rights=os?.getUint16(8)??0,level=rights&14
  if(level===2||rights&0x200)return fail('лицензия запрещает встраивание контуров.')
  if(level&&!(level&8))return fail('лицензия разрешает только просмотр; редактируемый PPTX требует разрешения на редактирование.')
  const name=(id:number,fallback:string)=>{
    const entries=names.getUint16(2),base=names.getUint16(4),matches:{value:string;rank:number}[]=[]
    if(6+entries*12>names.byteLength)return fail('повреждены имена шрифта.')
    for(let i=0;i<entries;i++){
      const p=6+i*12,platform=names.getUint16(p),language=names.getUint16(p+4),length=names.getUint16(p+8),offset=base+names.getUint16(p+10)
      if(names.getUint16(p+6)!==id||![0,3].includes(platform))continue
      if(offset+length>names.byteLength||length%2)return fail('повреждены имена шрифта.')
      let value='';for(let n=0;n<length;n+=2)value+=String.fromCharCode(names.getUint16(offset+n))
      matches.push({value,rank:language===0x409?0:language===0?1:2})
    }
    return matches.sort((a,b)=>a.rank-b.rank)[0]?.value??fallback
  }
  const strings=[name(1,font.family),name(2,font.style),name(5,'Version 1.0'),name(4,`${font.family} ${font.style}`)]
  if(strings.some(s=>s.length>32767))return fail('слишком длинное имя шрифта.')
  // Fixed header is 80 bytes, followed by four padded UTF-16LE strings and an
  // empty padded root string. Flags=0: neither subsetting nor MTX compression.
  const headerSize=80+strings.reduce((sum,s)=>sum+4+s.length*2,0)+4
  const result=new Uint8Array(headerSize+data.length),v=new DataView(result.buffer)
  v.setUint32(0,result.length,true);v.setUint32(4,data.length,true);v.setUint32(8,0x00020001,true)
  if(os){result.set(new Uint8Array(os.buffer,os.byteOffset+32,10),16);v.setUint8(27,os.getUint16(62)&1);v.setUint32(28,os.getUint16(4),true)
    for(let i=0;i<4;i++)v.setUint32(36+i*4,os.getUint32(42+i*4),true)
    if(os.byteLength>=86)for(let i=0;i<2;i++)v.setUint32(52+i*4,os.getUint32(78+i*4),true)
  }else{v.setUint8(27,font.style.includes('Italic')?1:0);v.setUint32(28,font.style.includes('Bold')?700:400,true)}
  v.setUint8(26,1);v.setUint16(32,rights,true);v.setUint16(34,0x504c,true);v.setUint32(60,head.getUint32(8),true)
  let offset=80
  for(const s of strings){offset+=2;v.setUint16(offset,s.length*2,true);offset+=2;for(let i=0;i<s.length;i++,offset+=2)v.setUint16(offset,s.charCodeAt(i),true)}
  result.set(data,headerSize)
  return result
}

/** One entry per actual face for the whole deck, including mixed generations.
 * Different binaries claiming the same face must not silently overwrite one
 * another: doing that makes earlier slides use a different font on opening. */
export async function embedPptxFonts(zip:JSZip,fonts:PptxFont[]) {
  if(!fonts.length)return
  const unique=new Map<string,PptxFont>()
  for(const f of fonts){const key=fontKey(f),prior=unique.get(key)
    if(prior&&(prior.bytes.length!==f.bytes.length||prior.bytes.some((b,i)=>b!==f.bytes[i])))throw Error(`В выбранных слайдах разные версии шрифта «${f.family}» (${f.style}). Экспортируйте эти версии отдельно.`)
    unique.set(key,f)
  }
  const aliases=new Map<string,string>()
  for(const family of new Set([...unique.values()].map(f=>f.family.toLowerCase()))){
    const faces=[...unique.values()].filter(f=>f.family.toLowerCase()===family).sort((a,b)=>a.style.localeCompare(b.style))
    aliases.set(family,await pptxFamilyName(faces[0].family,faces.map(f=>f.bytes)))
  }
  const groups=new Map<string,{family:string;refs:Map<PptxFontStyle,string>}>(),rels:string[]=[]
  let index=0
  for(const f of unique.values()){
    const id=`mspFont${++index}`,path=`fonts/font${index}.fntdata`
    powerpointFont(f) // Validate rights before metadata normalization.
    const family=aliases.get(f.family.toLowerCase())!
    const bytes=renamePptxFont(fontBytes(f.bytes)!,family,f.style)
    zip.file(`ppt/${path}`,powerpointFont({...f,family,bytes}))
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="${path}"/>`)
    const key=f.family.toLowerCase(),group=groups.get(key)??{family,refs:new Map()};group.refs.set(f.style,id);groups.set(key,group)
  }
  for(const file of zip.file(/\.xml$/)){
    const xml=await file.async('string')
    zip.file(file.name,xml.replace(/\btypeface="([^"]+)"/g,(all,value)=>{
      const source=[...unique.values()].find(f=>escape(f.family)===value)
      return source?`typeface="${aliases.get(source.family.toLowerCase())}"`:all
    }))
  }
  const styles=[['Regular','regular'],['Bold','bold'],['Italic','italic'],['Bold Italic','boldItalic']] as const
  const list=`<p:embeddedFontLst>${[...groups.values()].map(g=>`<p:embeddedFont><p:font typeface="${escape(g.family)}"/>${styles.map(([style,tag])=>g.refs.has(style)?`<p:${tag} r:id="${g.refs.get(style)}"/>`:'').join('')}</p:embeddedFont>`).join('')}</p:embeddedFontLst>`
  let presentation=await zip.file('ppt/presentation.xml')!.async('string')
  presentation=presentation.replace('<p:presentation ','<p:presentation embedTrueTypeFonts="1" saveSubsetFonts="0" ')
  // CT_Presentation: embeddedFontLst follows notesSz/smartTags and precedes
  // custShowLst/defaultTextStyle/extLst. Our package has no embeddedFontLst yet.
  presentation=presentation.replace(/(<p:(?:custShowLst|photoAlbum|custDataLst|kinsoku|defaultTextStyle|modifyVerifier|extLst)\b|<\/p:presentation>)/,list+'$1')
  zip.file('ppt/presentation.xml',presentation)
  zip.file('ppt/_rels/presentation.xml.rels',(await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')).replace('</Relationships>',rels.join('')+'</Relationships>'))
  zip.file('[Content_Types].xml',(await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>','<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>'))
}
