import {Font} from 'fonteditor-core'

function tables(bytes:Uint8Array) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  return Array.from({length:v.getUint16(4)},(_,i)=>{
    const p=12+i*16,offset=v.getUint32(p+8),length=v.getUint32(p+12)
    return {tag:String.fromCharCode(...bytes.subarray(p,p+4)),bytes:bytes.slice(offset,offset+length)}
  })
}
function checksum(bytes:Uint8Array) {
  let sum=0
  for(let p=0;p<bytes.length;p+=4)sum=(sum+((bytes[p]*0x1000000)+((bytes[p+1]??0)<<16)+((bytes[p+2]??0)<<8)+(bytes[p+3]??0)))>>>0
  return sum
}

/** Drop a Slide's export-family normalization: the native font name and the
 * PPTX typeface must agree. A content-addressed family isolates embedded faces
 * from Office's installed/substituted faces and from other deck versions.
 * Only replace the name table. Rewriting the whole font via fonteditor would
 * discard GSUB/GPOS and change shaping; all glyphs, metrics and hints stay intact.
 * Call after powerpointFont has validated the original sfnt and its rights. */
export function renamePptxFont(bytes:Uint8Array,family:string,style:string):Uint8Array {
  const original=tables(bytes)
  if(original.some(t=>t.tag==='fvar'))throw Error('Для экспорта нужен статический файл шрифта вместо вариативного.')
  const font=Font.create(new Uint8Array(bytes).buffer,{type:String.fromCharCode(...bytes.subarray(0,4))==='OTTO'?'otf':'ttf',hinting:true})
  const name=font.get().name,postscript=`${family.replace(/[^a-zA-Z0-9]/g,'')}-${style.replace(/\s/g,'')}`
  Object.assign(name,{fontFamily:family,preferredFamily:family,fontSubFamily:style,preferredSubFamily:style,
    fullName:`${family} ${style}`,postScriptName:postscript,uniqueSubFamily:postscript})
  const written=font.write({type:'ttf',toBuffer:false}) as ArrayBuffer
  const renamed=tables(new Uint8Array(written)).find(t=>t.tag==='name')!
  // A signature cannot survive an intentional metadata edit.
  const updated=original.filter(t=>t.tag!=='DSIG').map(t=>t.tag==='name'?renamed:t).sort((a,b)=>a.tag.localeCompare(b.tag))
  const result=new Uint8Array(12+updated.length*16+updated.reduce((n,t)=>n+((t.bytes.length+3)&~3),0)),v=new DataView(result.buffer)
  result.set(bytes.subarray(0,4));v.setUint16(4,updated.length)
  const power=Math.floor(Math.log2(updated.length));v.setUint16(6,2**power*16);v.setUint16(8,power);v.setUint16(10,updated.length*16-2**power*16)
  let offset=12+updated.length*16,headOffset=0
  for(const [i,t] of updated.entries()){
    const p=12+i*16
    if(t.tag==='head'){new DataView(t.bytes.buffer).setUint32(8,0);headOffset=offset}
    result.set(new TextEncoder().encode(t.tag),p);v.setUint32(p+4,checksum(t.bytes));v.setUint32(p+8,offset);v.setUint32(p+12,t.bytes.length)
    result.set(t.bytes,offset);offset+=(t.bytes.length+3)&~3
  }
  v.setUint32(headOffset+8,(0xb1b0afba-checksum(result))>>>0)
  return result
}

export async function pptxFamilyName(family:string,faces:Uint8Array[]) {
  const hashes=await Promise.all(faces.map(async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))))
  const joined=new Uint8Array(hashes.length*32);hashes.forEach((hash,i)=>joined.set(hash,i*32))
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',joined))
  const label=family.replace(/[^a-zA-Z0-9]/g,'').slice(0,14)||'Font'
  return `MSP ${label} ${[...digest.subarray(0,4)].map(n=>n.toString(16).padStart(2,'0')).join('')}`
}
