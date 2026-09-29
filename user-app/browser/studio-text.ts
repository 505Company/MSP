import {nativeBoundText} from '../lib/design-system/editable-native-layout'
import {editableValues} from '../lib/presentations/studio/bindings'
import type {EditableTemplate} from '../lib/design-system/editable-contract'
import type {ComponentBinding,ContentBlock} from '../lib/presentations/studio/contract'
import {minimumReadableSize} from '../lib/presentations/studio/readability'

/** A native one-field text component has no illustration to distort. Resize
 * its text frame to the flex box and retain the dominant source typography. */
export function studioTextInstance(source:EditableTemplate,binding:ComponentBinding,block:ContentBlock,width:number,height:number,step:number,surface='#ffffff',fittedSize?:number){
  if(!source.sourceLayout||source.sourceLayout.text.length!==1||source.sourceLayout.graphicIds.length)throw Error('Компонент не поддерживает свободное изменение текстовой области.')
  const template=structuredClone(source),data=editableValues(binding,template,block),slot=template.sourceLayout!.text[0]
  const original=slot.element,e=nativeBoundText(slot,data),dominant=[...original.styleRuns??[]].sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0]
  const ink=[...original.colorRuns??[]].sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0]
  const floor=minimumReadableSize(block,'text')
  const preferred=Math.max(floor,Math.round((dominant?.fontSize??original.fontSize)/4)*4),size=Math.max(floor,fittedSize??preferred-step*4)
  e.fontFamily=dominant?.fontFamily??original.fontFamily;e.fontSize=size;e.fontStyle=dominant?.fontStyle??original.fontStyle??'Regular'
  const panel=!!source.style.background&&source.style.background.toLowerCase()!==surface.toLowerCase()&&source.style.background!=='transparent'
  const padding=panel?Math.max(32,source.style.padding??0):source.style.padding??0
  if(!panel)template.style.background='transparent'
  e.bounds={x:padding,y:padding,width:Math.max(1,width-2*padding),height:Math.max(1,height-2*padding)};e.flow={columns:1,gap:0,autoFit:'NONE'}
  e.styleRuns=[{...dominant,start:0,end:e.text.length,fontFamily:e.fontFamily,fontSize:size,fontStyle:e.fontStyle}]
  if(ink)e.colorRuns=[{...ink,start:0,end:e.text.length}]
  e.paragraphs=[{...(e.paragraphs?.[0]??{align:'LEFT' as const,left:0,right:0,indent:0,before:0,after:0,lineHeight:{unit:'PERCENT' as const,value:115}}),start:0,end:e.text.length,fontSize:size,left:0,right:0,indent:0,before:0,after:0}]
  e.textBox={align:e.textBox?.align??'LEFT',vertical:'TOP',wrap:true}
  // graphicIds is empty: the SVG only carries an inherited slide backdrop.
  // Repainting that source viewport after resizing leaks beyond this block.
  template.sourceLayout!.graphic=''
  slot.element=e;template.width=width;template.height=height;template.style.padding=0
  return {template,data,size,inset:padding}
}

/** Native import previews may enlarge the viewport to include source ink.
 * An allocated slide block has fixed bounds: overflow must be reported. */
export function constrainStudioText(box:HTMLElement,width:number,height:number){
  for(const layout of box.querySelectorAll<HTMLElement>('[data-native-layout]')){
    layout.style.aspectRatio=`${width} / ${height}`
    for(const layer of [...layout.children].filter(e=>e.tagName.toLowerCase()==='svg'))layer.setAttribute('viewBox',`0 0 ${width} ${height}`)
  }
}
