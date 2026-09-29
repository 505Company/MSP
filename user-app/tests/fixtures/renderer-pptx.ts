import JSZip from 'jszip'
import { controlPptx } from './control-pptx'

export async function bottomAlignedPptx(){
  const zip=await JSZip.loadAsync(await controlPptx()),xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
  const shape=`<p:sp><p:nvSpPr><p:cNvPr id="90" name="Большой показатель"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="4000500" y="3143250"/><a:ext cx="3810000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="b"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="10800" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>43</a:t></a:r><a:r><a:rPr sz="5400" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>%</a:t></a:r></a:p></p:txBody></p:sp>`
  zip.file('ppt/slides/slide1.xml',xml.replace('</p:spTree>',shape+'</p:spTree>'))
  return zip.generateAsync({type:'nodebuffer'})
}

export async function rendererPptx(){
  const zip=await JSZip.loadAsync(await controlPptx())
  const shape=`<p:sp><p:nvSpPr><p:cNvPr id="80" name="Максимальное скругление"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="4762500" y="3048000"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="0077FF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`
  const source=await zip.file('ppt/slides/slide1.xml')!.async('string')
  zip.file('ppt/slides/slide1.xml',source.replace('</p:spTree>',shape+'</p:spTree>'))
  return zip.generateAsync({type:'nodebuffer'})
}
