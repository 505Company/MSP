import JSZip from 'jszip'
import type { ElementIR, BoundsIR, ColorIR, TextElementIR, ParagraphIR, ShapeElementIR } from '../../vendor/drag/src/core/model'
import type { ComponentDefinition, ComponentIssue } from '../design-system/types'
import { visibleElements } from '../design-system/compiler'

function exportElements(elements:ElementIR[]):ElementIR[]{
  return elements.map(e=>{
    if(!('children' in e))return e
    const children=exportElements(e.children),image=children.length===1?children[0]:null
    // PPTX image crops are represented by a rectangular group mask in the reader.
    // Preserve the group transform and express that local mask as native srcRect cropping.
    if(e.clipsContent&&!e.clipPathData&&image?.kind==='raster'&&!image.rotation&&!image.centeredTransform?.flipH&&!image.centeredTransform?.flipV){
      const c=image.clipBounds??{x:0,y:0,width:e.bounds.width,height:e.bounds.height}
      const x=Math.max(0,c.x),y=Math.max(0,c.y),right=Math.min(e.bounds.width,c.x+c.width),bottom=Math.min(e.bounds.height,c.y+c.height)
      return {...e,clipsContent:false,children:[{...image,visible:image.visible&&right>x&&bottom>y,clipBounds:{x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)}}]}
    }
    return {...e,children}
  })
}
// Native DrawingML only. Unsupported properties stop export rather than becoming a screenshot.
export function pptxExportIssues(scene:ComponentDefinition):ComponentIssue[]{
  const issues:ComponentIssue[]=[]
  for(const e of visibleElements(exportElements(scene.scene.elements))){
    const unsupported:string[]=[]
    if(e.effects?.length||e.blur)unsupported.push('тени и размытие')
    if(e.kind==='table'||e.kind==='chart'||'tableGrid' in e&&e.tableGrid)unsupported.push('таблицы и диаграммы')
    if('clipsContent' in e&&e.clipsContent)unsupported.push('маска группы')
    if('clipPathData' in e&&e.clipPathData)unsupported.push('фигурная маска')
    if('gradient' in e&&e.gradient)unsupported.push('градиент')
    if('pattern' in e&&e.pattern)unsupported.push('узор заливки')
    if('windingRule' in e&&e.windingRule==='EVENODD')unsupported.push('контур с чётным правилом заполнения')
    if('clipBounds' in e&&e.clipBounds&&(e.kind!=='raster'||e.rotation||e.centeredTransform?.flipH||e.centeredTransform?.flipV))unsupported.push('маска повёрнутого объекта')
    if(e.kind==='text'){
      if(e.linkRuns?.length)unsupported.push('гиперссылки')
      if(e.textBox?.align==='JUSTIFIED'||e.paragraphs?.some(p=>p.align==='JUSTIFIED'))unsupported.push('выравнивание по ширине')
      if((e.flow?.columns??1)>1)unsupported.push('несколько текстовых колонок')
      if(e.flow?.autoFit==='SHRINK')unsupported.push('автоматическое уменьшение исходного текста')
      if([e,...e.styleRuns??[]].some(r=>r.fontSize<4/3||r.fontSize>4000))unsupported.push('кегль за пределами PPTX')
    }
    if(unsupported.length)issues.push({code:'pptx-export-property',elementId:e.id,message:`«${e.name}»: экспорт пока не поддерживает ${unsupported.join(', ')}.`})
  }
  return issues
}

const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const ns=`xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`
const esc=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
const emu=(value:number)=>Math.round(value*9525)
const point=(x:number,y:number)=>`<a:pt x="${emu(x)}" y="${emu(y)}"/>`
const hex=(color:ColorIR)=>[color.r,color.g,color.b].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('').toUpperCase()
const fill=(color:ColorIR,alpha=1)=>`<a:solidFill><a:srgbClr val="${hex(color)}"><a:alpha val="${Math.round(color.a*alpha*100000)}"/></a:srgbClr></a:solidFill>`
const black:ColorIR={r:0,g:0,b:0,a:1}
const rels=(entries:Array<[string,string,string]>)=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${esc(target)}"/>`).join('')}</Relationships>`
const tree=(contents:string)=>`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${contents}</p:spTree>`

function transform(e:ElementIR,group=false,b=e.bounds){
  let {x,y}=b
  if(!e.centeredTransform&&e.rotation){const r=e.rotation*Math.PI/180;x+=(Math.cos(r)*b.width-Math.sin(r)*b.height-b.width)/2;y+=(Math.sin(r)*b.width+Math.cos(r)*b.height-b.height)/2}
  const flags=`rot="${Math.round(e.rotation*60000)}" flipH="${e.centeredTransform?.flipH?1:0}" flipV="${e.centeredTransform?.flipV?1:0}"`
  return `<a:xfrm ${flags}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${Math.max(1,emu(b.width))}" cy="${Math.max(1,emu(b.height))}"/>${group?`<a:chOff x="0" y="0"/><a:chExt cx="${Math.max(1,emu(b.width))}" cy="${Math.max(1,emu(b.height))}"/>`:''}</a:xfrm>`
}
function customPath(e:ShapeElementIR){
  const data=e.pathData??'',tokens=data.match(/[MLCQZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)??[]
  if(data.replace(/[MLCQZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[\s,]/g,''))throw new Error('Неподдержанный векторный контур')
  let i=0,command='',output=''
  while(i<tokens.length){
    if(/^[MLCQZ]$/.test(tokens[i]))command=tokens[i++]
    if(command==='Z'){output+='<a:close/>';command='';continue}
    const count=({M:2,L:2,C:6,Q:4} as Record<string,number>)[command]
    if(!count||i+count>tokens.length)throw new Error('Неполный векторный контур')
    const numbers=tokens.slice(i,i+count).map(Number);i+=count
    if(numbers.some(n=>!Number.isFinite(n)))throw new Error('Некорректный векторный контур')
    const tag=({M:'moveTo',L:'lnTo',C:'cubicBezTo',Q:'quadBezTo'} as Record<string,string>)[command]
    output+=`<a:${tag}>${Array.from({length:count/2},(_,n)=>point(numbers[n*2],numbers[n*2+1])).join('')}</a:${tag}>`
    if(command==='M')command='L'
  }
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${Math.max(1,emu(e.bounds.width))}" h="${Math.max(1,emu(e.bounds.height))}" fill="${e.fill?'norm':'none'}">${output}</a:path></a:pathLst></a:custGeom>`
}
function stroke(e:ShapeElementIR,alpha:number){
  const s=e.stroke
  if(!s||s.width<=0)return '<a:ln><a:noFill/></a:ln>'
  const cap=s.cap==='ROUND'?'rnd':s.cap==='SQUARE'?'sq':'flat',join=s.join==='ROUND'?'<a:round/>':s.join==='BEVEL'?'<a:bevel/>':'<a:miter lim="800000"/>'
  const dash=s.dash?.length?`<a:custDash>${Array.from({length:Math.ceil(s.dash.length/2)},(_,i)=>`<a:ds d="${Math.round(s.dash![i*2]/s.width*100000)}" sp="${Math.round(s.dash![(i*2+1)%s.dash!.length]/s.width*100000)}"/>`).join('')}</a:custDash>`:'<a:prstDash val="solid"/>'
  return `<a:ln w="${emu(s.width)}" cap="${cap}">${fill(s.paint.color,alpha)}${dash}${join}</a:ln>`
}

function textBody(e:TextElementIR,alpha:number){
  const paragraphs=e.paragraphs??(()=>{let start=0;return e.text.split('\n').map(value=>{const p:ParagraphIR={start,end:start+value.length,align:e.textBox?.align??'LEFT',left:0,right:0,indent:0,before:0,after:0,fontSize:e.fontSize};start+=value.length+1;return p})})()
  const body=paragraphs.map(p=>{
    const align={LEFT:'l',CENTER:'ctr',RIGHT:'r',JUSTIFIED:'just'}[p.align]
    const spacing=p.lineHeight?.unit==='PIXELS'?`<a:spcPts val="${Math.round(p.lineHeight.value*75)}"/>`:`<a:spcPct val="${Math.round((p.lineHeight?.value??120)*1000)}"/>`
    const tabs=p.tabs?.length?`<a:tabLst>${p.tabs.map(t=>`<a:tab pos="${emu(t.position)}" algn="${t.align==='CENTER'?'ctr':t.align==='RIGHT'?'r':'l'}"/>`).join('')}</a:tabLst>`:''
    const properties=`<a:pPr algn="${align}" marL="${emu(p.left)}" marR="${emu(p.right)}" indent="${emu(p.indent)}"${p.defaultTab?` defTabSz="${emu(p.defaultTab)}"`:''}><a:lnSpc>${spacing}</a:lnSpc><a:spcBef><a:spcPts val="${Math.round(p.before*75)}"/></a:spcBef><a:spcAft><a:spcPts val="${Math.round(p.after*75)}"/></a:spcAft><a:buNone/>${tabs}</a:pPr>`
    const boundaries=[...new Set([p.start,p.end,...[...e.styleRuns??[],...e.colorRuns??[]].flatMap(r=>[Math.max(p.start,Math.min(p.end,r.start)),Math.max(p.start,Math.min(p.end,r.end))])])].sort((a,b)=>a-b)
    let runs=''
    for(let i=0;i<boundaries.length-1;i++){
      const start=boundaries[i],end=boundaries[i+1],s=e.styleRuns?.find(r=>r.start<=start&&r.end>start),color=e.colorRuns?.find(r=>r.start<=start&&r.end>start)?.fill.color??black,style=s?.fontStyle??e.fontStyle??'Regular',family=s?.fontFamily??e.fontFamily
      const rPr=`<a:rPr lang="ru-RU" sz="${Math.round((s?.fontSize??e.fontSize)*75)}" b="${style.includes('Bold')?1:0}" i="${style.includes('Italic')?1:0}" baseline="${Math.round((s?.baselineShift??0)*100000)}" spc="${Math.round((s?.letterSpacing??0)*75)}" u="${s?.decoration==='UNDERLINE'?'sng':'none'}" strike="${s?.decoration==='STRIKETHROUGH'?'sngStrike':'noStrike'}">${fill(color,alpha)}<a:latin typeface="${esc(family)}"/><a:ea typeface="${esc(family)}"/><a:cs typeface="${esc(family)}"/></a:rPr>`
      runs+=e.text.slice(start,end).split('\n').map(value=>`<a:r>${rPr}<a:t xml:space="preserve">${esc(value)}</a:t></a:r>`).join(`<a:br>${rPr}</a:br>`)
    }
    return `<a:p>${properties}${runs}<a:endParaRPr lang="ru-RU" sz="${Math.round(p.fontSize*75)}"/></a:p>`
  }).join('')
  return `<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" wrap="${e.textBox?.wrap?'square':'none'}" anchor="${e.textBox?.vertical==='CENTER'?'ctr':e.textBox?.vertical==='BOTTOM'?'b':'t'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody>`
}

function croppedImage(e:Extract<ElementIR,{kind:'raster'}>):{bounds:BoundsIR;crop:string}|null{
  const b=e.bounds,c=e.clipBounds
  if(!c)return {bounds:b,crop:''}
  const left=Math.max(b.x,c.x),top=Math.max(b.y,c.y),right=Math.min(b.x+b.width,c.x+c.width),bottom=Math.min(b.y+b.height,c.y+c.height)
  if(right<=left||bottom<=top)return null
  const pct=(v:number,size:number)=>Math.round(v/size*100000)
  return {bounds:{x:left,y:top,width:right-left,height:bottom-top},crop:`<a:srcRect l="${pct(left-b.x,b.width)}" t="${pct(top-b.y,b.height)}" r="${pct(b.x+b.width-right,b.width)}" b="${pct(b.y+b.height-bottom,b.height)}"/>`}
}

export async function writeEditablePptx(scene:ComponentDefinition,assets:Array<{id:string;bytes:Uint8Array}>):Promise<Uint8Array>{
  const issues=[...scene.issues.filter(i=>i.severity!=='warning'),...pptxExportIssues(scene)]
  if(issues.length)throw new Error(issues.map(i=>i.message).join('\n'))
  const zip=new JSZip(),add=(path:string,value:string|Uint8Array)=>zip.file(path,value),assetRelations=new Map<string,string>(),relations:Array<[string,string,string]>=[['rLayout','slideLayout','../slideLayouts/slideLayout1.xml']]
  for(const id of scene.source.assetIds){
    const asset=assets.find(a=>a.id===id)
    if(!asset)throw new Error('Исходное изображение недоступно')
    const ext=asset.bytes[0]===255&&asset.bytes[1]===216?'jpg':asset.bytes[0]===137&&asset.bytes[1]===80?'png':null
    if(!ext)throw new Error('Экспорт поддерживает изображения PNG и JPEG')
    const n=assetRelations.size+1,rid=`rImage${n}`,path=`media/image${n}.${ext}`
    assetRelations.set(id,rid);add(`ppt/${path}`,asset.bytes);relations.push([rid,'image',`../${path}`])
  }
  let nextId=2
  const draw=(e:ElementIR,opacity=1):string=>{
    if(!e.visible||e.opacity<=0)return ''
    const id=nextId++,alpha=opacity*e.opacity,name=esc(e.name)
    if('children' in e)return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${transform(e,true)}</p:grpSpPr>${[...e.children].sort((a,b)=>a.zIndex-b.zIndex).map(c=>draw(c,alpha)).join('')}</p:grpSp>`
    if(e.kind==='raster'){
      const image=croppedImage(e);if(!image)return ''
      return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${assetRelations.get(e.assetId)}"><a:alphaModFix amt="${Math.round(alpha*100000)}"/></a:blip>${image.crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(e,false,image.bounds)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    }
    const geom=e.kind==='path'?customPath(e):`<a:prstGeom prst="${e.kind==='ellipse'?'ellipse':e.kind==='line'?'line':'rect'}"><a:avLst/></a:prstGeom>`
    const paint=e.kind==='text'?'<a:noFill/><a:ln><a:noFill/></a:ln>':`${e.fill?fill(e.fill.color,alpha):'<a:noFill/>'}${stroke(e,alpha)}`
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${e.kind==='text'?' txBox="1"':''}/><p:nvPr/></p:nvSpPr><p:spPr>${transform(e)}${geom}${paint}</p:spPr>${e.kind==='text'?textBody(e,alpha):''}</p:sp>`
  }
  const content=exportElements(scene.scene.elements).sort((a,b)=>a.zIndex-b.zIndex).map(e=>draw(e)).join('')
  add('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${[['presentation','presentation.main'],['slides/slide1','slide'],['slideLayouts/slideLayout1','slideLayout'],['slideMasters/slideMaster1','slideMaster']].map(([path,kind])=>`<Override PartName="/ppt/${path}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`)
  add('_rels/.rels',rels([['rOffice','officeDocument','ppt/presentation.xml']]))
  add('ppt/presentation.xml',`<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rMaster"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rSlide"/></p:sldIdLst><p:sldSz cx="${emu(scene.scene.width)}" cy="${emu(scene.scene.height)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  add('ppt/_rels/presentation.xml.rels',rels([['rSlide','slide','slides/slide1.xml'],['rMaster','slideMaster','slideMasters/slideMaster1.xml']]))
  add('ppt/slides/slide1.xml',`<p:sld ${ns}><p:cSld name="${esc(scene.name)}">${tree(content)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
  add('ppt/slides/_rels/slide1.xml.rels',rels(relations))
  add('ppt/slideLayouts/slideLayout1.xml',`<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank">${tree('')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels([['rMaster','slideMaster','../slideMasters/slideMaster1.xml']]))
  add('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster ${ns}><p:cSld>${tree('')}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rLayout"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`)
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels([['rLayout','slideLayout','../slideLayouts/slideLayout1.xml'],['rTheme','theme','../theme/theme1.xml']]))
  const solid='<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  add('ppt/theme/theme1.xml',`<a:theme xmlns:a="${A}" name="MSP"><a:themeElements><a:clrScheme name="MSP">${[['dk1','000000'],['lt1','FFFFFF'],['dk2','222222'],['lt2','F5F5F5'],['accent1','0077FF'],['accent2','33AA88'],['accent3','FFCC44'],['accent4','AA66DD'],['accent5','EE7755'],['accent6','88BBEE'],['hlink','2458ED'],['folHlink','8855AA']].map(([k,v])=>`<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="MSP"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[9525,25400,38100].map(w=>`<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`)
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
