import {editableTableLayout} from './editable-table'
import JSZip from 'jszip'
import {writeEditablePptx} from '../slides/pptx'
import {validateEditableData,type EditableTemplate,type EditableData} from './editable-contract'

const A='http://schemas.openxmlformats.org/drawingml/2006/main',C='http://schemas.openxmlformats.org/drawingml/2006/chart',D='http://schemas.openxmlformats.org/drawingml/2006/diagram',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const emu=(v:number)=>Math.round(v*9525),hex=(v:string|undefined,fallback='0077FF')=>/^#[\da-f]{6}$/i.test(v??'')?v!.slice(1):fallback
const fill=(v:string|undefined)=>`<a:solidFill><a:srgbClr val="${hex(v)}"/></a:solidFill>`
const relationships=(list:[string,string,string][])=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id,type,target])=>`<Relationship Id="${esc(id)}" Type="${R}/${type}" Target="${esc(target)}"/>`).join('')}</Relationships>`
const column=(n:number):string=>n<26?String.fromCharCode(65+n):column(Math.floor(n/26)-1)+column(n%26)
async function workbook(data:EditableData){
 const zip=new JSZip(),rows=[['Категория',...data.series!.map(s=>s.name)],...data.categories!.map((name,i)=>[name,...data.series!.map(s=>s.values[i])])]
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
 zip.file('_rels/.rels',relationships([['rOffice','officeDocument','xl/workbook.xml']]))
 zip.file('xl/workbook.xml',`<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="sheet1"/></sheets></workbook>`)
 zip.file('xl/_rels/workbook.xml.rels',relationships([['sheet1','worksheet','worksheets/sheet1.xml']]))
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${S}"><sheetData>${rows.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>v==null?'':typeof v==='number'?`<c r="${column(ci)}${ri+1}"><v>${v}</v></c>`:`<c r="${column(ci)}${ri+1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`)
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
function chartXml(t:EditableTemplate,data:EditableData){
 const c=t.config,s=t.style,palette=s.palette??[s.accent??'#0077ff','#ff2b8b','#79e7ed'],circular=['donut','pie'].includes(c.chartType??'')
 const cache=(values:(string|number|null)[],numeric=true)=>`<c:${numeric?'numCache':'strCache'}>${numeric?'<c:formatCode>General</c:formatCode>':''}<c:ptCount val="${values.length}"/>${values.map((v,i)=>v===null?'':`<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:${numeric?'numCache':'strCache'}>`
 const groups=new Map<string,number[]>()
 data.series!.forEach((ser,i)=>{const type=c.chartType==='combo'?ser.type??'bar':c.chartType!,key=type+':'+(ser.axis??'left');groups.set(key,[...groups.get(key)??[],i])})
 const groupXml=[...groups].map(([key,indexes])=>{
  const [type,axis]=key.split(':'),family=type==='donut'?'doughnutChart':type+'Chart',axisId=axis==='right'?3:2
  const series=indexes.map(i=>{const ser=data.series![i],col=column(i+1),color=ser.color??palette[i%palette.length]
   return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Data!$${col}$1</c:f>${cache([ser.name],false)}</c:strRef></c:tx><c:spPr>${fill(color)}<a:ln w="28575">${fill(color)}</a:ln></c:spPr>${ser.colors?.map((v,n)=>`<c:dPt><c:idx val="${n}"/><c:spPr>${fill(v)}</c:spPr></c:dPt>`).join('')??''}<c:cat><c:strRef><c:f>Data!$A$2:$A$${data.categories!.length+1}</c:f>${cache(data.categories!,false)}</c:strRef></c:cat><c:val><c:numRef><c:f>Data!$${col}$2:$${col}$${ser.values.length+1}</c:f>${cache(ser.values)}</c:numRef></c:val>${['line','area'].includes(type)?`<c:smooth val="${c.smooth?1:0}"/>`:''}</c:ser>`
  }).join('')
  return `<c:${family}>${type==='bar'?`<c:barDir val="${c.horizontal?'bar':'col'}"/>`:''}${['bar','line','area'].includes(type)?`<c:grouping val="${c.stacked?'stacked':type==='bar'?'clustered':'standard'}"/>`:''}<c:varyColors val="${circular?1:0}"/>${series}${c.labels?'<c:dLbls><c:showVal val="1"/></c:dLbls>':''}${type==='donut'?`<c:holeSize val="${Math.round((c.hole??.66)*100)}"/>`:''}${!circular?`<c:axId val="1"/><c:axId val="${axisId}"/>`:''}</c:${family}>`
 }).join('')
 const axes=circular?'':`<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="${c.horizontal?'l':'b'}"/><c:crossAx val="2"/></c:catAx>${[2,...data.series!.some(s=>s.axis==='right')?[3]:[]].map(id=>`<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${id===2&&c.yMin!==undefined?`<c:min val="${c.yMin}"/>`:''}${id===2&&c.yMax!==undefined?`<c:max val="${c.yMax}"/>`:''}</c:scaling><c:delete val="${c.axis===false?1:0}"/><c:axPos val="${id===3?'r':c.horizontal?'b':'l'}"/>${c.grid?'<c:majorGridlines/>':''}<c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>`).join('')}`
 const title=data.title?`<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(data.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title>`:''
 return `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart>${title}<c:plotArea><c:layout/>${groupXml}${axes}</c:plotArea>${c.legend?'<c:legend><c:legendPos val="b"/></c:legend>':''}<c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round((s.fontSize??18)*75)}">${fill(s.color??'#111111')}<a:latin typeface="${esc(s.font??'Arial')}"/></a:defRPr></a:pPr></a:p></c:txPr><c:externalData r:id="workbook"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
}
function tableXml(t:EditableTemplate,data:EditableData){
 const rows=[data.columns!,...data.rows!],w=Math.max(800,t.width),s=t.style,{styles,widths}=editableTableLayout(t,data),total=100
 return `<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${rows[0].map((_,i)=>`<a:gridCol w="${emu(w*widths[i]/total)}"/>`).join('')}</a:tblGrid>${rows.map((row,ri)=>`<a:tr h="${emu(Math.max(40,(s.fontSize??18)*2.8))}">${row.map((value,ci)=>{
  const style=styles[ri]?.[ci],owner=styles[ri]?.findIndex((cell,j)=>j<ci&&(cell.colSpan??1)>ci-j),merged=style?.hidden
  const attrs=merged?owner!==undefined&&owner>=0?'hMerge="1"':'vMerge="1"':`${(style?.colSpan??1)>1?`gridSpan="${style!.colSpan}"`:''} ${(style?.rowSpan??1)>1?`rowSpan="${style!.rowSpan}"`:''}`
  const bg=style?.background??(ri===0?s.headerFill:ri%2===0?s.stripe:undefined)??s.background??'#ffffff',ink=style?.color??(ri===0?s.headerColor:undefined)??s.color??'#111111'
  return `<a:tc ${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${style?.align==='right'?'r':style?.align==='center'?'ctr':'l'}"/><a:r><a:rPr sz="${Math.round((s.fontSize??18)*75)}" b="${style?.bold?1:0}">${fill(ink)}<a:latin typeface="${esc(s.font??'Arial')}"/></a:rPr><a:t>${esc(value)}</a:t></a:r></a:p></a:txBody><a:tcPr>${fill(bg)}</a:tcPr></a:tc>`
 }).join('')}</a:tr>`).join('')}</a:tbl>`
}
export function supportsNativePptx(t:EditableTemplate){return t.kind==='table'||t.kind==='smartart'&&!!t.nativeObject||t.kind==='chart'&&['bar','line','area','donut','pie','combo','radar'].includes(t.config.chartType??'')}
/** Export real Office objects and an editable embedded workbook, never a chart
 * screenshot. Source SmartArt layout XML remains data, never executable code. */
export async function exportEditableTemplatePptx(t:EditableTemplate,data:EditableData):Promise<Uint8Array>{
 const own={...data};delete own.children;delete own.templateId;delete own.rowKeys;validateEditableData(t.kind,own,t.config)
 if(!supportsNativePptx(t))throw Error('Для этой конструкции доступен редактируемый HTML')
 const w=Math.max(800,t.width),h=t.kind==='table'?Math.max(300,(data.rows!.length+1)*Math.max(40,(t.style.fontSize??18)*2.8)):Math.max(500,t.height)
 const zip=await JSZip.loadAsync(await writeEditablePptx({id:t.id,name:t.name,kind:'compound',source:{slide:t.slide,rootId:t.id,elementIds:[],ancestorIds:[],assetIds:[]},scene:{width:w+40,height:h+40,elements:[]},slots:[],fixedTextIds:[],issues:[],semantics:[]},[]))
 let body='',uri='',overrides='';const rels:[string,string,string][]=[['rLayout','slideLayout','../slideLayouts/slideLayout1.xml']]
 if(t.kind==='chart'){
  uri=C;body=`<c:chart xmlns:c="${C}" r:id="chart"/>`;rels.push(['chart','chart','../charts/chart1.xml'])
  zip.file('ppt/charts/chart1.xml',chartXml(t,data));zip.file('ppt/charts/_rels/chart1.xml.rels',relationships([['workbook','package','../embeddings/data.xlsx']]))
  zip.file('ppt/embeddings/data.xlsx',await workbook(data));overrides=`<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/ppt/embeddings/data.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`
 }else if(t.kind==='table'){uri='http://schemas.openxmlformats.org/drawingml/2006/table';body=tableXml(t,data)}
 else{
  uri=D;body=`<d:relIds xmlns:d="${D}" r:dm="data" r:lo="layout"/>`;rels.push(['data','diagramData','../diagrams/data1.xml'],['layout','diagramLayout','../diagrams/layout1.xml'])
  const items=data.items!,root='msp-document',nodes=[`<d:pt modelId="${root}" type="doc"/>`,...items.map(item=>`<d:pt modelId="${esc(item.id)}"><d:prSet/><d:spPr/><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(item.title??item.text)}</a:t></a:r></a:p></d:t></d:pt>`)]
  const connections=items.map((item,i)=>`<d:cxn modelId="msp-edge-${i}" type="parOf" srcId="${esc(item.parentId??root)}" destId="${esc(item.id)}" srcOrd="${i}" destOrd="0"/>`)
  zip.file('ppt/diagrams/data1.xml',`<d:dataModel xmlns:d="${D}" xmlns:a="${A}"><d:ptLst>${nodes.join('')}</d:ptLst><d:cxnLst>${connections.join('')}</d:cxnLst></d:dataModel>`)
  const native=t.nativeObject!;if(native.kind!=='smartart'||!native.layoutXml)throw Error('В исходнике нет переносимого макета SmartArt')
  zip.file('ppt/diagrams/layout1.xml',native.layoutXml)
  overrides=['data','layout'].map(type=>`<Override PartName="/ppt/diagrams/${type}1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagram${type[0].toUpperCase()+type.slice(1)}+xml"/>`).join('')
 }
 const graphic=`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="${esc(t.name)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(20)}" y="${emu(20)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${body}</a:graphicData></a:graphic></p:graphicFrame>`
 const slide=await zip.file('ppt/slides/slide1.xml')!.async('string');zip.file('ppt/slides/slide1.xml',slide.replace('</p:spTree>',graphic+'</p:spTree>'))
 zip.file('ppt/slides/_rels/slide1.xml.rels',relationships(rels));zip.file('[Content_Types].xml',(await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>',overrides+'</Types>'))
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
