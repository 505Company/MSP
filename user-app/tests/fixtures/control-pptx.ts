import JSZip from 'jszip'
import { deflateSync } from 'node:zlib'

const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const ns=`xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`
const px=(n:number)=>Math.round(n*9525)
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const rels=(entries:Array<[string,string,string]>)=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`
const xfrm=(x:number,y:number,w:number,h:number)=>`<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`
function shape(id:number,name:string,x:number,y:number,w:number,h:number,fill:string){return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${fill.startsWith('#')?`<a:srgbClr val="${fill.slice(1)}"/>`:`<a:schemeClr val="${fill}"/>`}</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`}
function text(id:number,name:string,value:string,x:number,y:number,w:number,h:number,size=24){return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"><a:lnSpc><a:spcPct val="120000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ru-RU" sz="${size*75}"><a:solidFill><a:srgbClr val="152B42"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${esc(value)}</a:t></a:r><a:endParaRPr lang="ru-RU" sz="${size*75}"/></a:p></p:txBody></p:sp>`}
function group(id:number,name:string,x:number,y:number,w:number,h:number,contents:string,childW=w,childH=h){return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(childW)}" cy="${px(childH)}"/></a:xfrm></p:grpSpPr>${contents}</p:grpSp>`}
const tree=(contents:string)=>`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${contents}</p:spTree>`
const picture=`<p:pic><p:nvPicPr><p:cNvPr id="21" name="Фото с кадрированием"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rImage"/><a:srcRect l="25000" r="25000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(16,16,100,80)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`

function crc(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0)}return (c^0xffffffff)>>>0}
export function controlImage(){
  const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,sum])}
  const header=Buffer.alloc(13);header.writeUInt32BE(16,0);header.writeUInt32BE(8,4);header[8]=8;header[9]=2
  const colors=[[232,92,70],[255,200,87],[35,128,210],[36,170,130]]
  const raw=Buffer.alloc(8*(1+16*3));for(let y=0;y<8;y++)for(let x=0;x<16;x++){const at=y*49+1+x*3;raw.set(colors[Math.floor(x/4)],at)}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}

/** Fresh synthetic fixture; no presentation or library from the Figma project is included. */
export async function controlPptx():Promise<Buffer>{
  const zip=new JSZip(),add=(path:string,value:string|Buffer)=>zip.file(path,value,{date:new Date('2026-09-25T00:00:00Z')})
  add('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${[['presentation','presentation.main'],['slides/slide1','slide'],['slideLayouts/slideLayout1','slideLayout'],['slideMasters/slideMaster1','slideMaster']].map(([path,kind])=>`<Override PartName="/ppt/${path}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`)
  add('_rels/.rels',rels([['rOffice','officeDocument','ppt/presentation.xml']]))
  add('ppt/presentation.xml',`<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rMaster"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rSlide"/></p:sldIdLst><p:sldSz cx="${px(960)}" cy="${px(540)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  add('ppt/_rels/presentation.xml.rels',rels([['rSlide','slide','slides/slide1.xml'],['rMaster','slideMaster','slideMasters/slideMaster1.xml']]))
  const card=group(10,'Карточка решения',80,60,640,230,shape(11,'Фон карточки',0,0,640,230,'accent1')+text(12,'Заголовок','Решение для города',24,20,590,45,28)+text(13,'Описание','Проверяем структуру и новый текст.',24,85,480,90,22)+group(14,'Маркер',552,156,64,48,shape(15,'Фон маркера',0,0,64,48,'#FFFFFF')+text(16,'Номер','01',10,7,44,34,24)))
  const imageCard=group(20,'Карточка с фото',80,325,320,150,shape(24,'Фон фото',0,0,640,300,'#EBF1F5')+group(25,'Вложенная фотография',20,20,240,210,picture,120,105)+text(22,'Подпись','Новая среда',310,75,290,90,18),640,300)
  add('ppt/slides/slide1.xml',`<p:sld ${ns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${tree(card+imageCard)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
  add('ppt/slides/_rels/slide1.xml.rels',rels([['rLayout','slideLayout','../slideLayouts/slideLayout1.xml'],['rImage','image','../media/control.png']]))
  add('ppt/media/control.png',controlImage())
  add('ppt/slideLayouts/slideLayout1.xml',`<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank">${tree('')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels([['rMaster','slideMaster','../slideMasters/slideMaster1.xml']]))
  add('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster ${ns}><p:cSld>${tree(text(50,'Подпись мастера','Контроль импорта',760,500,180,28,14))}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rLayout"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`)
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels([['rLayout','slideLayout','../slideLayouts/slideLayout1.xml'],['rTheme','theme','../theme/theme1.xml']]))
  add('ppt/theme/theme1.xml',`<a:theme xmlns:a="${A}" name="Контроль"><a:themeElements><a:clrScheme name="Контроль">${[['dk1','152B42'],['lt1','FFFFFF'],['dk2','233A52'],['lt2','F4F7FA'],['accent1','DCEAE5'],['accent2','E85C46'],['accent3','2380D2'],['accent4','6A58A8'],['accent5','C9D57A'],['accent6','EAD79B'],['hlink','2458ED'],['folHlink','6A58A8']].map(([k,v])=>`<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Контроль"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`)
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
}
