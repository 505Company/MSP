import JSZip from 'jszip'
import { controlPptx } from './control-pptx'
const A='http://schemas.openxmlformats.org/drawingml/2006/main',C='http://schemas.openxmlformats.org/drawingml/2006/chart',D='http://schemas.openxmlformats.org/drawingml/2006/diagram',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export async function nativePptx(){
 const zip=await JSZip.loadAsync(await controlPptx())
 const frame=(id:number,uri:string,body:string,x:number,y:number)=>`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Native ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x*9525}" y="${y*9525}"/><a:ext cx="${400*9525}" cy="${200*9525}"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${body}</a:graphicData></a:graphic></p:graphicFrame>`
 const cell=(text:string,attrs='')=>`<a:tc ${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"/></a:pPr><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="EAF3F8"/></a:solidFill></a:tcPr></a:tc>`
 const table=`<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1905000"/><a:gridCol w="1905000"/></a:tblGrid><a:tr h="635000">${cell('Регион')}${cell('Число')}</a:tr><a:tr h="635000">${cell('Север')}${cell('42')}</a:tr><a:tr h="635000">${cell('Общий итог','gridSpan="2"')}${cell('','hMerge="1"')}</a:tr></a:tbl>`
 const cache=(vs:(string|number|null)[],numeric=true)=>`<c:${numeric?'numLit':'strLit'}><c:ptCount val="${vs.length}"/>${vs.map((v,i)=>v===null?'':`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:${numeric?'numLit':'strLit'}>`
 zip.file('ppt/charts/chart1.xml',`<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Продажи</c:v></c:tx><c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr><c:cat>${cache(['A','B','C'],false)}</c:cat><c:val>${cache([12,null,-8])}</c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend/></c:chart></c:chartSpace>`)
 zip.file('ppt/diagrams/data1.xml',`<d:dataModel xmlns:d="${D}" xmlns:a="${A}"><d:ptLst>${['root','a','b'].map((id,i)=>`<d:pt modelId="${id}"><d:prSet/><d:spPr/><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${['Команда','Дизайн','Разработка'][i]}</a:t></a:r></a:p></d:t></d:pt>`).join('')}</d:ptLst><d:cxnLst><d:cxn modelId="e1" type="parOf" srcId="root" destId="a" srcOrd="0" destOrd="0"/><d:cxn modelId="e2" type="parOf" srcId="root" destId="b" srcOrd="1" destOrd="0"/></d:cxnLst></d:dataModel>`)
 zip.file('ppt/diagrams/layout1.xml',`<d:layoutDef xmlns:d="${D}" uniqueId="synthetic-tree"><d:layoutNode name="root"><d:alg type="hierRoot"/></d:layoutNode></d:layoutDef>`)
 const s=await zip.file('ppt/slides/slide1.xml')!.async('string')
 zip.file('ppt/slides/slide1.xml',s.replace(/<p:spTree>[\s\S]*?<\/p:spTree>/,`<p:spTree>${frame(991,'http://schemas.openxmlformats.org/drawingml/2006/table',table,20,20)}${frame(992,C,`<c:chart xmlns:c="${C}" r:id="chart"/>`,500,20)}${frame(993,D,`<d:relIds xmlns:d="${D}" r:dm="data" r:lo="layout"/>`,20,280)}</p:spTree>`))
 const rels=await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
 zip.file('ppt/slides/_rels/slide1.xml.rels',rels.replace('</Relationships>',[['chart','chart','../charts/chart1.xml'],['data','diagramData','../diagrams/data1.xml'],['layout','diagramLayout','../diagrams/layout1.xml']].map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')+'</Relationships>'))
 const ct=await zip.file('[Content_Types].xml')!.async('string')
 zip.file('[Content_Types].xml',ct.replace('</Types>','<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'+['data','layout'].map(type=>`<Override PartName="/ppt/diagrams/${type}1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagram${type[0].toUpperCase()+type.slice(1)}+xml"/>`).join('')+'</Types>'))
 return zip.generateAsync({type:'uint8array'})
}
export function nativePdf(){
 const stream='0.1 0.4 0.9 rg 40 150 200 70 re f\nBT /F1 18 Tf 45 180 Td (Editable PDF text) Tj ET\n0 0 0 RG 40 120 m 240 120 l S'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 260] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
 let pdf='%PDF-1.4\n';const offsets=[0]
 for(const [i,o]of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`}
 const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
 return new TextEncoder().encode(pdf)
}
