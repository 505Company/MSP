import {dataMaterial} from '../presentations/data-material'
export async function readContentFile(file:File):Promise<string>{
 const extension=/\.(txt|md|csv|tsv|json|xlsx)$/i.exec(file.name)?.[1].toLowerCase()
 if(!extension||!file.size||file.size>2*1024*1024)throw Error('Выберите TXT, MD, CSV, TSV, JSON или XLSX до 2 МБ')
 const bytes=new Uint8Array(await file.arrayBuffer());let text:string
 if(extension==='xlsx')text=(await import('./workbook-file')).workbookContent(bytes)
 else try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw Error('Не удалось прочитать текст. Сохраните файл в UTF-8.')}
 if(!text.trim()||text.length>100000||text.includes('\0'))throw Error('Нужно непустое содержание до 100 000 символов')
 if(['csv','tsv','json'].includes(extension)){
  const material=dataMaterial(text,extension as 'csv'|'tsv'|'json')
  if(material?.every(m=>m.kind==='table'))text=JSON.stringify({tables:material.map(m=>({title:m.title==='Данные'?file.name.replace(/\.[^.]+$/,''):m.title,...m.data}))})
 }
 if(text.length>100000)throw Error('Данные превышают 100 000 символов')
 return text
}
