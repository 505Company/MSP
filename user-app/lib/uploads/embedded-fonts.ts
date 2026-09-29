import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

export type EmbeddedFont = { id: string; family: string; style: 'Regular'|'Bold'|'Italic'|'Bold Italic'; bytes: Uint8Array; mime: string }
const array = <T>(value: T|T[]|undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]

/** Read sfnt/OpenType bytes, including uncompressed EOT containers used by
 * PowerPoint. Compressed/encrypted containers are retained as unsupported. */
export function fontBytes(data: Uint8Array): Uint8Array|null {
  const sfnt = (d: Uint8Array) => d.length >= 12 && ((d[0]===0&&d[1]===1&&d[2]===0&&d[3]===0)||strFromU8(d.subarray(0,4))==='OTTO')
  if (sfnt(data)) return data
  if (data.length < 82) return null
  const view = new DataView(data.buffer,data.byteOffset,data.byteLength), size=view.getUint32(4,true), flags=view.getUint32(12,true)
  if (view.getUint32(0,true)!==data.length || view.getUint16(34,true)!==0x504c || flags & 0x10000004 || size > data.length-82) return null
  const bytes=data.slice(data.length-size)
  return sfnt(bytes)?bytes:null
}
export function extractEmbeddedFonts(pptx: Uint8Array): EmbeddedFont[] {
  const zip=unzipSync(pptx,{filter:f=>f.originalSize<=8*1024*1024&&/^(ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|ppt\/fonts\/[^/]+)$/.test(f.name)})
  if(!zip['ppt/presentation.xml']||!zip['ppt/_rels/presentation.xml.rels'])return []
  const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false})
  const xml=parser.parse(strFromU8(zip['ppt/presentation.xml'])),rels=parser.parse(strFromU8(zip['ppt/_rels/presentation.xml.rels']))
  const relations=new Map(array<Record<string,string>>(rels.Relationships?.Relationship).filter(r=>r['@_TargetMode']!=='External'&&r['@_Type']?.endsWith('/font')).map(r=>[r['@_Id'],r['@_Target']]))
  const fonts:EmbeddedFont[]=[]
  for(const font of array<Record<string,Record<string,string>>>(xml.presentation?.embeddedFontLst?.embeddedFont)){
    const family=font.font?.['@_typeface'];if(!family||family.length>200)continue
    for(const [tag,style] of [['regular','Regular'],['bold','Bold'],['italic','Italic'],['boldItalic','Bold Italic']] as const){
      const target=relations.get(font[tag]?.['@_id']);if(!target)continue
      const path=target.startsWith('/ppt/')?target.slice(1):`ppt/${target}`
      if(!/^ppt\/fonts\/[^/]+$/.test(path)||!zip[path])continue
      const bytes=fontBytes(zip[path]);if(!bytes)continue
      fonts.push({id:`font-${fonts.length+1}`,family,style,bytes,mime:strFromU8(bytes.subarray(0,4))==='OTTO'?'font/otf':'font/ttf'})
    }
  }
  return fonts
}
