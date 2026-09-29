import {unzipSync,strFromU8} from 'fflate'
import {PptxCatalogReader,OFFICE_REL} from '../vendor/drag/src/formats/pptx/catalog'
import {C,cc} from '../vendor/drag/src/formats/pptx/chart-data'

/** Read saved values of embedded XLSX cells. Formula text and external links are
 * never evaluated/fetched. The chart's saved cache remains the fallback. */
export function embeddedChartValues(reader:PptxCatalogReader,part:string,space:Element){
 const relationship=cc(space,'externalData')?.getAttributeNS(OFFICE_REL,'id'),rel=relationship?reader.relationships(part).get(relationship):undefined
 if(!rel||rel.external||!rel.type.endsWith('/package')||!rel.target.endsWith('.xlsx'))return null
 const bytes=reader.readAsset(rel.target);if(bytes.length>16_000_000)return null
 let total=0
 const files=unzipSync(bytes,{filter:file=>{if(!/\.(xml|rels)$/.test(file.name))return false;total+=file.originalSize;if(total>32_000_000||file.originalSize>8_000_000)throw Error('security-limit');return true}})
 const parser=new DOMParser(),xml=(name:string)=>{const b=files[name];if(!b)return null;const s=strFromU8(b);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('invalid-file');return parser.parseFromString(s,'application/xml')}
 const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',REL='http://schemas.openxmlformats.org/package/2006/relationships',workbook=xml('xl/workbook.xml'),relations=xml('xl/_rels/workbook.xml.rels')
 if(!workbook||!relations)return null
 const strings=Array.from(xml('xl/sharedStrings.xml')?.getElementsByTagNameNS(NS,'si')??[]).map(e=>Array.from(e.getElementsByTagNameNS(NS,'t')).map(t=>t.textContent??'').join(''))
 const sheets=new Map<string,Map<string,string|number|null>>()
 for(const sheet of Array.from(workbook.getElementsByTagNameNS(NS,'sheet'))){
  const id=sheet.getAttributeNS(OFFICE_REL,'id'),link=Array.from(relations.getElementsByTagNameNS(REL,'Relationship')).find(r=>r.getAttribute('Id')===id)
  if(!link||link.getAttribute('TargetMode')==='External')continue
  const target=link.getAttribute('Target')??'',path=target.startsWith('/')?target.slice(1):'xl/'+target
  if(path.includes('..')||!/^xl\/worksheets\/[\w.-]+\.xml$/.test(path))continue
  const cells=new Map<string,string|number|null>()
  for(const cell of Array.from(xml(path)?.getElementsByTagNameNS(NS,'c')??[])){
   if(cells.size>200000)throw Error('security-limit')
   const address=cell.getAttribute('r')??'',type=cell.getAttribute('t'),raw=cell.getElementsByTagNameNS(NS,'v')[0]?.textContent??''
   const value=type==='s'?strings[Number(raw)]??null:type==='inlineStr'?Array.from(cell.getElementsByTagNameNS(NS,'t')).map(t=>t.textContent??'').join(''):type==='str'?raw:raw.trim()&&Number.isFinite(Number(raw))?Number(raw):null
   cells.set(address,value)
  }
  sheets.set(sheet.getAttribute('name')??'',cells)
 }
 return (container:Element|undefined):Array<string|number|null>|null=>{
  const formula=container?.getElementsByTagNameNS(C,'f')[0]?.textContent??'',match=/^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula)
  if(!match)return null
  const sheet=sheets.get((match[1]??match[2]).replaceAll("''","'"));if(!sheet)return null
  const column=(name:string)=>[...name].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),a=column(match[3]),b=column(match[5]??match[3]),top=Number(match[4]),bottom=Number(match[6]??match[4])
  if(a!==b&&top!==bottom||b<a||bottom<top||(b-a+1)*(bottom-top+1)>2000)return null
  const name=(n:number):string=>n<=26?String.fromCharCode(64+n):name(Math.floor((n-1)/26))+name((n-1)%26+1)
  const values:Array<string|number|null>=[]
  for(let r=top;r<=bottom;r++)for(let c=a;c<=b;c++)values.push(sheet.get(name(c)+r)??null)
  return values
 }
}
