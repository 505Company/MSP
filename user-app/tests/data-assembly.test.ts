import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {dataMaterial} from '../lib/presentations/data-material'
import {bindDataMaterial} from '../lib/presentations/data-assembly'
import {workbookContent} from '../lib/workspace/workbook-file'
import type {EditableTemplate} from '../lib/design-system/editable-contract'
const table:EditableTemplate={id:'native-table',name:'Таблица',description:'Данные',tags:['Таблица'],kind:'table',slide:38,width:900,height:400,sourceIds:['table'],memberIds:[],graphicHtml:{},dataStatus:'native',style:{font:'Arial',fontSize:20,headerFill:'#0077ff',stripe:'#e6ebff'},config:{},data:{columns:['Сегмент','Доля'],rows:[['Образец','10%']]}}

test('tabular input is recognized without rewriting cells, including quotes, nulls and percentages',()=>{
 const csv=dataMaterial('Город;Доля\r\n"Нижний; Новгород";"12,5%"\r\nКазань;0','csv')!
 assert.deepEqual(csv[0].data.rows,[['Нижний; Новгород','12,5%'],['Казань','0']])
 assert.deepEqual(dataMaterial('[{"Город":"Москва","Число":12},{"Город":"Казань","Число":null}]')![0].data.rows,[['Москва','12'],['Казань','']])
 assert.equal(dataMaterial('Введение\nНаш проект, его описание и планы на следующий год.'),null)
 assert.throws(()=>dataMaterial('a,b\n"broken','csv'))
})
test('automatic binding chooses a compatible source style and preserves every row when paginating',()=>{
 const data=dataMaterial(JSON.stringify(Array.from({length:45},(_,i)=>({'Название':`Строка ${i}`,'Число':i}))))![0]
 const pages=bindDataMaterial(data,[{...table,id:'other',data:{columns:['A','B','C','D'],rows:[['','','','']]}},table])
 assert.ok(pages.length>1);assert.ok(pages.every(p=>p.template.id==='native-table'&&p.template.style.headerFill==='#0077ff'))
 assert.deepEqual(pages.flatMap(p=>p.data.rows!),data.data.rows)
 assert.ok(pages.every(p=>JSON.stringify(p.data.columns)===JSON.stringify(data.data.columns)))
 assert.throws(()=>bindDataMaterial(data,[]))
})
test('an explicit chart dataset keeps numbers and a chart type; plain record arrays remain tables',()=>{
 const chart=dataMaterial(JSON.stringify({title:'Динамика',chartType:'line',categories:['Янв','Фев'],series:[{name:'Продажи',values:[12,null]}]}))![0]
 assert.equal(chart.kind,'chart');assert.equal(chart.config.chartType,'line');assert.deepEqual(chart.data.series![0].values,[12,null])
 assert.equal(dataMaterial('[{"месяц":"Янв","продажи":12}]')![0].kind,'table')
 const styled=bindDataMaterial(chart,[{...table,kind:'chart',config:{chartType:'line'},data:{categories:['Образец'],series:[{name:'Образец',values:[99],color:'#ff3388',axis:'left'}]}}])[0]
 assert.equal(styled.data.series![0].color,'#ff3388');assert.equal(styled.data.series![0].name,'Продажи');assert.deepEqual(styled.data.series![0].values,[12,null])
})
test('XLSX uses saved cell values and units and rejects uncalculated formulas',async()=>{
 const zip=new JSZip()
 zip.file('xl/workbook.xml','<workbook><sheets><sheet name="Показатели" r:id="s1"/></sheets></workbook>')
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>')
 zip.file('xl/styles.xml','<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="9"/></cellXfs></styleSheet>')
 const sheet='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Доля</t></is></c><c r="B1" t="inlineStr"><is><t>Число</t></is></c></row><row><c r="A2" t="n" s="1"><v>0.32</v></c><c r="B2"><f>SUM(A1:A4)</f><v>73</v></c></row></sheetData></worksheet>'
 zip.file('xl/worksheets/sheet1.xml',sheet)
 const material=dataMaterial(workbookContent(await zip.generateAsync({type:'uint8array'})))!
 assert.equal(material[0].title,'Показатели');assert.deepEqual(material[0].data.rows,[['32%','73']])
 zip.file('xl/worksheets/sheet1.xml',sheet.replace('<v>73</v>',''))
 assert.throws(()=>workbookContent(Uint8Array.from([])))
 const bytes=await zip.generateAsync({type:'uint8array'});assert.throws(()=>workbookContent(bytes),/формул/)
})

test('XLSX respects the 1904 date system without changing saved numbers',async()=>{
 const zip=new JSZip()
 zip.file('xl/workbook.xml','<workbook><workbookPr date1904="1"/><sheets><sheet name="Даты" r:id="s1"/></sheets></workbook>')
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>')
 zip.file('xl/styles.xml','<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>')
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Дата</t></is></c></row><row><c r="A2" t="n"><v>1</v></c></row></sheetData></worksheet>')
 assert.deepEqual(dataMaterial(workbookContent(await zip.generateAsync({type:'uint8array'})))![0].data.rows,[['1904-01-02']])
})
