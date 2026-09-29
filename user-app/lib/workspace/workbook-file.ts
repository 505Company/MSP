import {unzipSync,strFromU8} from 'fflate'
import {XMLParser} from 'fast-xml-parser'
type Xml=Record<string,unknown>
const object=(v:unknown):Xml=>v&&typeof v==='object'&&!Array.isArray(v)?v as Xml:{}
const list=(v:unknown):Xml[]=>v==null?[]:(Array.isArray(v)?v:[v]).map(object)
const value=(v:unknown):string=>v==null?'':typeof v==='object'?String(object(v)['#text']??''):String(v)
const rich=(v:unknown):string=>{const x=object(v);return x.t!=null?value(x.t):list(x.r).map(r=>value(r.t)).join('')}
export function workbookContent(bytes:Uint8Array):string{
 let total=0
 const files=unzipSync(bytes,{filter:f=>{if(!/\.(xml|rels)$/.test(f.name))return false;total+=f.originalSize;if(total>24_000_000||f.originalSize>8_000_000)throw Error('Таблица слишком велика');return true}})
 const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false})
 const xml=(name:string):Xml=>{const bytes=files[name];if(!bytes)return {};const text=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Не удалось прочитать структуру XLSX');return object(parser.parse(text))}
 const workbook=object(xml('xl/workbook.xml').workbook),rels=list(object(xml('xl/_rels/workbook.xml.rels').Relationships).Relationship)
 const date1904=['1','true'].includes(String(object(workbook.workbookPr)['@_date1904']??''))
 const shared=list(object(xml('xl/sharedStrings.xml').sst).si).map(rich),style=object(xml('xl/styles.xml').styleSheet)
 const formats=new Map(list(object(style.numFmts).numFmt).map(f=>[String(f['@_numFmtId']),String(f['@_formatCode'])])),styles=list(object(style.cellXfs).xf)
 const tables:Array<{title:string;columns:string[];rows:string[][]}>=[]
 for(const sheet of list(object(workbook.sheets).sheet)){
  if(tables.length>=20)throw Error('За один раз можно загрузить до 20 листов')
  const rel=rels.find(r=>r['@_Id']===sheet['@_id']);if(!rel||rel['@_TargetMode']==='External')continue
  const target=String(rel['@_Target']??''),path=target.startsWith('/')?target.slice(1):'xl/'+target
  if(path.includes('..')||!/^xl\/worksheets\/[\w.-]+\.xml$/.test(path))continue
  const rows:string[][]=[];let width=0
  for(const row of list(object(object(xml(path).worksheet).sheetData).row)){
   const cells:string[]=[]
   for(const cell of list(row.c)){
    const address=String(cell['@_r']??''),name=/^[A-Z]+/.exec(address)?.[0];if(!name)continue
    const col=[...name].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;if(col>=60)throw Error('В таблице поддерживается до 60 столбцов')
    if(cell.f!=null&&cell.v==null)throw Error('В XLSX есть формула без сохранённого результата. Пересчитайте и сохраните файл.')
    const type=cell['@_t'],raw=value(cell.v);let text=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?rich(cell.is):raw
    const formatId=String(styles[Number(cell['@_s']??0)]?.['@_numFmtId']??'0'),format=formats.get(formatId)??''
    if((!type||type==='n')&&raw&&Number.isFinite(Number(raw))){
     if(['9','10'].includes(formatId)||/%/.test(format))text=String(Number((Number(raw)*100).toPrecision(12)))+'%'
     else if(['14','15','16','17','22'].includes(formatId)||/^[^"\[]*[dy]/i.test(format))text=new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Number(raw)*86400000).toISOString().slice(0,10)
    }
    cells[col]=text
   }
   if(cells.some(c=>c?.trim())){width=Math.max(width,cells.length);rows.push(cells)}
  }
  if(rows.length<2)continue
  const matrix=rows.map(row=>Array.from({length:width},(_,i)=>row[i]??''))
  tables.push({title:String(sheet['@_name']??'Данные'),columns:matrix[0],rows:matrix.slice(1)})
 }
 if(!tables.length)throw Error('В XLSX не найдены таблицы с заголовками и строками данных')
 return JSON.stringify({tables})
}
