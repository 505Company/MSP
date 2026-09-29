import {diagramContentSchema,type DiagramContent} from '../design-system/graphic-components'
import {editableDataSchema,validateEditableData,type EditableData,type EditableConfig,type EditableTemplate} from '../design-system/editable-contract'
export type DataMaterial={graph?:DiagramContent;title:string;kind:EditableTemplate['kind'];data:EditableData;config:EditableConfig}
const cell=(v:unknown):string=>v==null?'':typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):(()=>{throw Error('В ячейках нужны текст, числа или пустые значения')})()
function table(raw:unknown,title='Данные'):DataMaterial {
 let columns:string[],rows:string[][]
 if(Array.isArray(raw)){
  if(!raw.length)throw Error('В таблице нет строк')
  if(raw.every(Array.isArray)){const matrix=raw.map(row=>(row as unknown[]).map(cell));columns=matrix[0];rows=matrix.slice(1)}
  else if(raw.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){columns=[...new Set(raw.flatMap(row=>Object.keys(row)))];rows=raw.map(row=>columns.map(k=>cell(row[k])))}
  else throw Error('Массив должен содержать строки или записи с названиями столбцов')
 }else{
  const value=raw as {columns?:unknown[];rows?:unknown[][]};if(!Array.isArray(value?.columns)||!Array.isArray(value.rows))throw Error('Нужны столбцы и строки таблицы')
  columns=value.columns.map(cell);rows=value.rows.map(row=>{if(!Array.isArray(row))throw Error('Нужны строки таблицы');return row.map(cell)})
 }
 const data={columns,rows};validateEditableData('table',data)
 return {title,kind:'table',data,config:{}}
}
export function parseDelimited(text:string,separator:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false
 for(let i=0;i<text.length;i++){
  const c=text[i]
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++}else if(quoted||!value)quoted=!quoted;else value+=c}
  else if(c===separator&&!quoted){row.push(value);value=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(c=>c.trim()))rows.push(row);row=[];value=''}
  else value+=c
 }
 if(quoted)throw Error('Не закрыта кавычка в табличных данных')
 row.push(value);if(row.some(c=>c.trim()))rows.push(row)
 return rows
}
/** Structured data bypass prose generation: numbers and cell contents are never
 * rewritten by a model. Ordinary prose remains on the existing text workflow. */
export function dataMaterial(text:string,format?:'csv'|'tsv'|'json'):DataMaterial[]|null {
 const input=text.trim();if(!input)return null
 if(format==='json'||/^[\[{]/.test(input)){
  let raw:unknown;try{raw=JSON.parse(input)}catch{if(format==='json')throw Error('Не удалось прочитать JSON');return null}
  const read=(value:unknown):DataMaterial=>{
   if(Array.isArray(value))return table(value)
   const v=value as Record<string,unknown>;if(!v||typeof v!=='object')throw Error('Нужен массив или объект данных')
   const title=typeof v.title==='string'?v.title:'Данные'
   if(v.columns&&v.rows)return table(v,title)
   if(v.nodes&&v.edges){const graph=diagramContentSchema.parse({nodes:v.nodes,edges:v.edges});return {title,kind:'diagram',data:{items:graph.nodes.map(n=>({id:n.id,text:n.text}))},config:{},graph}}
   const data=editableDataSchema.parse(v.data??Object.fromEntries(Object.entries(v).filter(([key])=>!['title','type','kind','chartType'].includes(key))))
   const kind:DataMaterial['kind']=data.categories&&data.series?'chart':data.periods&&data.items?'gantt':data.items?.some(i=>i.parentId)?'smartart':data.items?'timeline':data.value?'metric':'text'
   const config:EditableConfig=kind==='chart'?{chartType:['bar','line','area','donut','pie','combo','scatter','bubble','radar'].includes(String(v.chartType))?v.chartType as EditableConfig['chartType']:'bar'}:{}
   validateEditableData(kind,data,config);return {title,kind,data,config}
  }
  const wrapper=raw as {tables?:unknown[]};return wrapper?.tables?wrapper.tables.map(read):[read(raw)]
 }
 const lines=input.split(/\r?\n/)
 if(lines.length>2&&lines[0].includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[1])){
  const rows=lines.filter((_,i)=>i!==1).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim()))
  return [table(rows)]
 }
 for(const delimiter of format==='tsv'?['\t']:format==='csv'?[',',';','\t']:['\t',';',',']){
  let rows:string[][];try{rows=parseDelimited(input,delimiter)}catch(error){if(format)throw error;continue}
  if(rows.length>1&&rows[0].length>1&&rows.every(row=>row.length===rows[0].length)&& (format||delimiter==='\t'||rows.slice(1).some(row=>row.some(c=>/^[-+]?\d[\d\s.,%]*$/.test(c.trim())))))return [table(rows)]
 }
 if(format)throw Error('Не удалось выделить прямоугольную таблицу с заголовками')
 return null
}
