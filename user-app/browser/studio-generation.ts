import {designQuality} from '../lib/presentations/studio/design-quality'
import {applyStudioBrandAccents} from './studio-color-zones'
import {studioBackground} from './studio-background'
import {backgroundDesigns,contentBackground} from '../lib/presentations/studio/visual-design'
import {reserveMasterSpace} from '../lib/presentations/studio/master-layout'
import {masterItemBounds} from '../lib/design-system/slide-masters'
import { toPng, getFontEmbedCSS } from 'html-to-image'
import { prepareLayoutFonts } from './layout-fonts'
import { ensureUploadFonts } from './fonts'
import { measurePreparedBox, renderPreparedBox } from './prepared-components'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import { hydrateEditableHtml } from '../lib/design-system/editable-hydrate'
import { studioDataInstance, renderStudioData } from './studio-data'
import {studioTextInstance,constrainStudioText} from './studio-text'
import {fitRecipeText,maximumTextSize,textFitsBox,nativeTextKeepsHierarchy,nativeWordsFit} from './studio-type-fit'
import {textGeometry} from './layout-execution'
import {addStudioChrome} from './studio-chrome'
import {fitMeasuredFlex,type SpaceNeeds} from '../lib/presentations/studio/flex-fit'
import {fitIncomingCandidate} from '../lib/presentations/studio/recipe-packs'
import {receiptPreservesFields} from '../lib/presentations/studio/field-bindings'
import {respectsPlacement} from '../lib/presentations/studio/recipe-variants'
import {minimumReadableSize as readableSize} from '../lib/presentations/studio/readability'
import { primitiveFor, type PrimitiveNode } from '../lib/presentations/studio/recipes'
import { editableValues } from '../lib/presentations/studio/bindings'
import { studioTheme, studioFonts, studioSurface } from '../lib/presentations/studio/theme'
import { slotBindings, draftOptions, optionSignature } from '../lib/presentations/studio/options'
export { studioTheme } from '../lib/presentations/studio/theme'
import type { Box, Candidate, ContentBlock, DesignOption, RenderReceipt, SlideWork, Slot, SlotPresentation, StudioLibrary } from '../lib/presentations/studio/contract'

const px=(n:number)=>`${n}px`
const snap=(n:number)=>Math.round(n/4)*4
type Tree={box:Box;slot?:Slot;direction?:'row'|'column';gap?:number;children?:Tree[]}
const bounds=(slots:Slot[]):Box=>({x:Math.min(...slots.map(s=>s.rect.x)),y:Math.min(...slots.map(s=>s.rect.y)),w:Math.max(...slots.map(s=>s.rect.x+s.rect.w))-Math.min(...slots.map(s=>s.rect.x)),h:Math.max(...slots.map(s=>s.rect.y+s.rect.h))-Math.min(...slots.map(s=>s.rect.y))})
function flowTree(slots:Slot[]):Tree{
  if(slots.length===1)return {box:slots[0].rect,slot:slots[0]}
  for(const axis of ['y','x'] as const){
    const size=axis==='x'?'w':'h',sorted=[...slots].sort((a,b)=>a.rect[axis]-b.rect[axis])
    for(let i=1;i<sorted.length;i++){
      const end=Math.max(...sorted.slice(0,i).map(s=>s.rect[axis]+s.rect[size])),start=sorted[i].rect[axis]
      if(start>=end-1)return {box:bounds(slots),direction:axis==='y'?'column':'row',gap:Math.max(0,start-end),children:[flowTree(sorted.slice(0,i)),flowTree(sorted.slice(i))]}
    }
  }
  throw Error('Области рецепта пересекаются.')
}
const textSize=(role:string,theme:ReturnType<typeof studioTheme>,step:number,primary:boolean)=>{
  const base=role==='grid-value'?104:role==='grid-label'?48:role==='display'?192:role==='support'?64:role==='title'?theme.title:/metric-value|fact-value|hero-value/.test(role)?theme.metric:/marker|^index$/.test(role)?56:/heading|-title|quote$/.test(role)?theme.heading:role==='takeaway'?theme.body+4:/footer|caption|author|metadata|page|source|footnote/.test(role)?28:theme.body
  // A content slot may contain a longer value than the demonstration text.
  // The 30% geometry allowance does not impose a 70% type-size floor. Keep
  // role-specific readable floors instead, while retaining four-pixel steps.
  const preferred=snap(base*(primary&&role!=='title'?1.15:1)),minimum=Math.min(preferred,role==='title'?40:/metric-value|fact-value/.test(role)?64:/heading|quote$/.test(role)?32:/marker/.test(role)?28:role==='footer'?20:24)
  return Math.max(minimum,preferred-step*4)
}
function primitive(node:PrimitiveNode,block:ContentBlock,theme:ReturnType<typeof studioTheme>,step:number,primary:boolean,presentation:SlotPresentation={},isRoot=true,library?:StudioLibrary):HTMLElement|null{
  const el=document.createElement('div')
  const surface=library&&node.surface&&!['plain','slide'].includes(node.surface)?studioSurface(library,/inverse|status-band|cover-rail/.test(node.surface)?'accent':'panel',theme.background):undefined
  if(surface)theme={...theme,ink:surface.ink,accent:surface.ink,titleInk:surface.ink,metricInk:surface.ink}
  const policy=()=>{
    if(node.preferredWidth!==undefined){el.style.width=px(node.preferredWidth);el.style.flexBasis=px(node.preferredWidth)}
    if(node.flex)el.style.flex=`${node.flex.grow??0} ${node.flex.shrink??1} ${typeof node.flex.basis==='number'?px(node.flex.basis):node.flex.basis??'auto'}`
    if(node.pushToEnd)el.style.marginTop='auto'
    if(node.textAlign)el.style.textAlign=node.textAlign
  }
  if(node.field){const original=block.fields[node.field],value=node.sourceRange?original?.slice(node.sourceRange.start,node.sourceRange.end):original;if(!value)return null;el.textContent=value;el.dataset.field=node.field
    el.dataset.typeRole=node.role??'body'
    if(node.sourceRange)el.dataset.sourceRange=JSON.stringify(node.sourceRange)
    const ink=(presentation.ink==='inverse'||presentation.ink==='panel')?theme.ink:presentation.ink?theme[presentation.ink]:undefined
    Object.assign(el.style,{fontFamily:JSON.stringify(theme.font),fontSize:px(Math.min(presentation.maxTypeSize??Infinity,snap(textSize(node.role??'body',theme,step,primary)*(presentation.typeScale??1)*(/heading/.test(node.role??'')?presentation.headingScale??1:/marker/.test(node.role??'')?presentation.markerScale??1:1)))),fontWeight:/display|title|heading|value|marker|takeaway/.test(node.role??'')?'700':'400',lineHeight:node.role==='display'?'1.02':node.role==='title'?'1.2':'1.25',whiteSpace:'pre-wrap',overflowWrap:'normal',textWrap:/display|title/.test(node.role??'')?'balance':'pretty',flex:'0 0 auto',color:ink??(theme.sourceStyle&&/display|^title$/.test(node.role??'')?theme.titleInk:theme.sourceStyle&&/metric-value|fact-value|hero-value|grid-value/.test(node.role??'')?theme.metricInk:/title|value|marker/.test(node.role??'')?theme.accent:theme.ink),minWidth:'0'})
    el.style.fontSize=px(Math.max(readableSize(block,node.field),parseFloat(el.style.fontSize)))
    if(node.role==='display'){el.style.lineHeight='1.14';el.style.paddingBottom='.08em'}
    // The line separator remains in textContent and the source receipt. The
    // repeated row already supplies the line break in layout.
    if(node.sourceRange)el.style.whiteSpace='pre-line'
    if(node.role==='grid-value')el.style.whiteSpace='nowrap'
    if((node.field==='value'||node.role==='metric-value')&&value.length<=28&&!value.includes('\n'))el.style.whiteSpace='nowrap'
    policy()
    return el
  }
  const insets=node.insets,padding=insets?`${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`:px(node.padding??0)
  Object.assign(el.style,{display:'flex',flexDirection:node.direction??'column',gap:px(node.gap??20),padding,justifyContent:presentation.align==='end'?'flex-end':presentation.align==='center'?'center':node.justify==='start'?'flex-start':node.justify==='end'?'flex-end':node.justify??'flex-start',alignItems:node.align==='start'?'flex-start':node.align==='end'?'flex-end':node.align??'stretch',boxSizing:'border-box',minWidth:'0',width:isRoot?'100%':undefined,height:node.heightMode==='hug'?'auto':isRoot||node.heightMode==='fill'?'100%':'auto',flexShrink:'0',...(surface?{background:surface.background,color:surface.ink}:{})})
  policy()
  for(const d of node.edges??[])el.style.setProperty(`border-${d.edge}`,`${d.width}px solid ${theme.accent}`)
  if(node.columns&&(node.children?.length??0)>1){el.style.display='grid';el.style.gridTemplateColumns=`repeat(${Math.min(node.columns,node.children!.length)},minmax(0,1fr))`}
  for(const child of node.children??[]){const item=primitive(child,block,theme,step,primary,presentation,false,library);if(item)el.appendChild(item)}
  return el.childNodes.length?el:null
}
function rangeBox(el:HTMLElement){
  if(el.namespaceURI==='http://www.w3.org/2000/svg'){
    const glyphs=[...el.querySelectorAll('text')].map(t=>t.getBoundingClientRect()).filter(r=>r.width&&r.height)
    if(glyphs.length){const x=Math.min(...glyphs.map(r=>r.x)),y=Math.min(...glyphs.map(r=>r.y));return new DOMRect(x,y,Math.max(...glyphs.map(r=>r.right))-x,Math.max(...glyphs.map(r=>r.bottom))-y)}
  }
  const rects=textGeometry(el).ink
  if(!rects.length)return new DOMRect()
  const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return new DOMRect(x,y,Math.max(...rects.map(r=>r.right))-x,Math.max(...rects.map(r=>r.bottom))-y)
}
function textReceipt(block:ContentBlock,field:string,el:HTMLElement,root:HTMLElement){const a=el.getBoundingClientRect(),r=root.getBoundingClientRect(),s=getComputedStyle(el),sourceRange=el.dataset.sourceRange?JSON.parse(el.dataset.sourceRange) as {start:number;end:number}:undefined;return {blockId:block.id,field,value:sourceRange?el.textContent??'':block.fields[field],...sourceRange?{sourceRange}:{},size:parseFloat(s.fontSize),x:a.x-r.x,y:a.y-r.y,width:a.width,height:a.height,font:s.fontFamily,color:s.color,weight:parseInt(s.fontWeight)||400}}

async function draw(library:StudioLibrary,work:SlideWork,candidate:Candidate,steps:Record<string,number>,geometry:number,host:HTMLElement,font:string,shrink=false,preferComponents=true){
  let componentNeeds=false
  const design=backgroundDesigns(library).find(d=>d.id===candidate.backgroundId),baseTheme=studioTheme(library,font,candidate.canvasFillId),theme=design?{...baseTheme,background:design.background,ink:design.ink,titleInk:design.ink}:baseTheme,tree=flowTree(candidate.slots),warnings:string[]=[],issues:string[]=[],components:RenderReceipt['components']=[],text:RenderReceipt['text']=[],fontCSS=new Set<string>(),dataValues:NonNullable<RenderReceipt['dataValues']>=[],dataTextSizes:number[]=[],spaceNeeds:SpaceNeeds={}
  const root=document.createElement('div');root.dataset.studioSlide=work.content.id
  Object.assign(root.style,{width:'1920px',height:'1080px',background:theme.background,color:theme.ink,position:'relative',boxSizing:'border-box',fontFamily:JSON.stringify(theme.font),overflow:'visible',padding:`${tree.box.y}px ${1920-tree.box.x-tree.box.w}px ${1080-tree.box.y-tree.box.h}px ${tree.box.x}px`})
  if(design&&library.backgrounds){
    const background=document.createElement('div');background.dataset.studioBackground=design.id
    Object.assign(background.style,{position:'absolute',inset:'0',pointerEvents:'none'})
    background.innerHTML=await studioBackground(library,design.selection)
    root.appendChild(background)
  }
  for(const layer of candidate.decorations??[]){
    const el=document.createElement('div');el.dataset.recipeDecoration=layer.id
    Object.assign(el.style,{position:'absolute',pointerEvents:'none',left:px(layer.rect.x),top:px(layer.rect.y),width:px(layer.rect.w),height:px(layer.rect.h),background:layer.surface==='rule'?theme.accent:studioSurface(library,layer.surface,theme.background).background})
    root.appendChild(el)
  }
  if(candidate.authored){
    if(candidate.authored.surface==='slide-inverse')root.style.background=studioSurface(library,'accent').background
    for(const layer of candidate.authored.layers){
      if((!layer.surface||['plain','slide'].includes(layer.surface))&&!layer.edges?.length)continue
      const el=document.createElement('div');el.dataset.recipeDecoration=layer.id
      Object.assign(el.style,{position:'absolute',pointerEvents:'none',boxSizing:'border-box',left:px(layer.rect.x),top:px(layer.rect.y),width:px(layer.rect.w),height:px(layer.rect.h)})
      if(layer.surface&&!['plain','slide'].includes(layer.surface))el.style.background=layer.surface==='rule'?theme.accent:studioSurface(library,/inverse|status-band|cover-rail/.test(layer.surface)?'accent':'panel').background
      for(const d of layer.edges??[])el.style.setProperty(`border-${d.edge}`,`${d.width}px solid ${theme.accent}`)
      root.appendChild(el)
    }
  }
  host.replaceChildren(root)
  const boxes=new Map<string,HTMLElement>()
  const build=(t:Tree):HTMLElement=>{
    const el=document.createElement('div');Object.assign(el.style,{display:'flex',flexDirection:t.direction??'column',gap:px(t.gap??0),minWidth:'0',minHeight:'0',width:'100%',height:'100%',boxSizing:'border-box'})
    if(t.slot){
      const slot=t.slot,cols=slot.direction==='row'?slot.blocks.length:slot.direction==='wrap'?Math.min(slot.columns,slot.blocks.length):1
      const rows=Math.ceil(slot.blocks.length/cols)
      Object.assign(el.style,{flexDirection:'column',gap:px(slot.gap)})
      const rowWeights=Array.from({length:rows},(_,row)=>Math.sqrt(Math.max(...slot.blocks.slice(row*cols,(row+1)*cols).map(id=>work.content.blocks.find(b=>b.id===id)!.source.length+30))))
      const averageRowWeight=rowWeights.reduce((a,b)=>a+b,0)/rows
      for(let row=0;row<rows;row++){
        const rowFlex=1+geometry*Math.max(-1,Math.min(1,rowWeights[row]/averageRowWeight-1))
        const rowEl=document.createElement('div');Object.assign(rowEl.style,{display:'flex',flexDirection:'row',gap:px(slot.gap),minHeight:'0',minWidth:'0',flex:`${rowFlex} 1 0`})
        const ids=slot.blocks.slice(row*cols,(row+1)*cols)
        const weight=ids.reduce((n,id)=>n+Math.sqrt(work.content.blocks.find(b=>b.id===id)!.source.length+30),0)/ids.length
        ids.forEach(id=>{const b=work.content.blocks.find(b=>b.id===id)!,box=document.createElement('div');box.dataset.block=id
          const flex=1+geometry*Math.max(-1,Math.min(1,Math.sqrt(b.source.length+30)/weight-1))
          Object.assign(box.style,{flex:`${flex} 1 0`,minWidth:'0',minHeight:'0',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:slot.presentation?.align==='center'?'center':'flex-start'})
          rowEl.appendChild(box);boxes.set(id,box)
        });el.appendChild(rowEl)
      }
    }else for(const c of t.children!){const child=build(c),horizontal=t.direction==='row',axis=horizontal?'w':'h',size=c.box[axis],wrapper=document.createElement('div')
      // Retain cross-axis insets instead of stretching every region over them.
      Object.assign(wrapper.style,{display:'flex',boxSizing:'border-box',minWidth:'0',minHeight:'0',flex:`${size} 1 0`,[horizontal?'minWidth':'minHeight']:px(size*.7),[horizontal?'maxWidth':'maxHeight']:px(size*1.3),padding:horizontal?`${c.box.y-t.box.y}px 0 ${t.box.y+t.box.h-c.box.y-c.box.h}px`:`0 ${t.box.x+t.box.w-c.box.x-c.box.w}px 0 ${c.box.x-t.box.x}px`})
      wrapper.appendChild(child);el.appendChild(wrapper)
    }
    return el
  }
  const contentTree=build(tree);contentTree.style.position='relative';root.appendChild(contentTree);await document.fonts.ready
  const paragraphSizes=new Map<string,number>()
  for(const slot of candidate.slots){
    const blocks=slot.blocks.map(id=>work.content.blocks.find(b=>b.id===id)!)
    const section=slot.presentation?.contentTreatment==='section'
    if(slot.presentation?.typographyRole!=='support'||slot.direction!=='column'||blocks.length<2||blocks.some(b=>b.role!=='body'||(!section&&(b.kind!=='text'||Object.keys(b.fields).length!==1))))continue
    const first=boxes.get(blocks[0].id)!,group=first.parentElement!.parentElement!,width=first.getBoundingClientRect().width,available=group.getBoundingClientRect().height-slot.gap*(blocks.length-1)
    const probe=document.createElement('div');Object.assign(probe.style,{position:'absolute',width:px(width),fontFamily:JSON.stringify(theme.font),fontWeight:'400',lineHeight:'1.25',whiteSpace:'pre-wrap',textWrap:'pretty',visibility:'hidden'});root.appendChild(probe)
    let sizes:number[]=[],size=Math.min(maximumTextSize('support'),slot.presentation?.maxTypeSize??Infinity)
    for(;size>=24;size-=4){probe.style.fontSize=px(size);sizes=blocks.map(b=>{
      const values=section?Object.values(b.fields).flatMap(value=>value.split('\n').filter(Boolean)):[b.fields.text]
      return values.reduce((sum,value)=>{probe.style.fontWeight=section&&/:\s*$/.test(value)?'700':'400';probe.textContent=value;return sum+probe.getBoundingClientRect().height},0)+(values.length-1)*(section?12:0)
    });if(sizes.reduce((a,b)=>a+b,0)<=available+.5)break}
    probe.remove()
    if(size<24)continue
    for(const [i,b] of blocks.entries()){paragraphSizes.set(b.id,size);boxes.get(b.id)!.parentElement!.style.flex=`${sizes[i]} 1 0`}
  }
  const typePriority=(b:ContentBlock)=>b.role==='title'?3:b.kind==='metric'?(work.plan!.primary.includes(b.id)?2:1):0
  for(const b of [...work.content.blocks].sort((a,b)=>typePriority(b)-typePriority(a))){
    const box=boxes.get(b.id);if(!box){issues.push(`Не размещён блок ${b.id}`);continue}
    const rect=box.getBoundingClientRect(),slot=candidate.slots.find(s=>s.blocks.includes(b.id))!
    let rendered=false,componentFailure='',componentState:RenderReceipt['components'][number]['state']
    if(b.data){
      const {template,data,preferredFontSize}=studioDataInstance(b.data.template,b.data.values,rect.width,steps[b.id]??0)
      renderStudioData(box,template,data,preferredFontSize);issues.push(...await hydrateEditableHtml(box))
      if(template.kind==='table'){
        const actual=[...box.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('th,td')].map(c=>c.textContent??''))
        if(JSON.stringify(actual)!==JSON.stringify([b.data.values.columns,...b.data.values.rows??[]]))issues.push(`Изменены ячейки ${b.id}`)
      }
      for(const el of box.querySelectorAll<HTMLElement>('td,th')){const size=parseFloat(getComputedStyle(el).fontSize);dataTextSizes.push(size);if(size<24)issues.push(`Мелкий текст ${b.id}: менее 24 px`)}
      for(const el of box.querySelectorAll<SVGTextElement>('svg text')){const m=el.getScreenCTM();if(m&&parseFloat(getComputedStyle(el).fontSize)*Math.hypot(m.a,m.b)<18)issues.push(`Мелкие подписи графика ${b.id}: менее 18 px`)}
      dataValues.push({blockId:b.id,templateId:b.data.template.id,values:b.data.values})
      components.push({blockId:b.id,componentId:b.data.template.id,kind:'editable',width:rect.width,height:rect.height});rendered=true
    }else{
      const variants=slotBindings(work,library,slot,b.id),preferred=work.plan?.components[b.id]
      const visibleVariants=design?variants.filter(v=>{const t=library.editable.find(t=>t.id===v.id);return t?.style.color?.toLowerCase()===design.ink?.toLowerCase()||library.prepared[v.id]?.profile.fields.every(f=>f.color.toLowerCase()===design.ink?.toLowerCase())}):variants
      const ordered=work.strictComponents?variants.filter(v=>v.id===preferred):preferComponents?[...visibleVariants].sort((a,c)=>Number(c.id===preferred)-Number(a.id===preferred)):[]
      for(const variant of ordered){
        try{
          const values=Object.fromEntries(Object.entries(variant.fields).map(([key,field])=>[key,b.fields[field]]))
          if(variant.kind==='prepared'){
            const pin=library.prepared[variant.id],scale=Math.max(.7,Math.min(1.3,slot.presentation?.scale??1)),density=slot.presentation?.density??(b.emphasis==='secondary'?'compact':work.plan?.primary.includes(b.id)?'large':'normal'),measured=await measurePreparedBox(library.uploadId,pin,values,{width:Math.min(rect.width/scale,pin.profile.maxWidth,1600),maxHeight:Math.min(rect.height/scale,pin.profile.maxHeight,1200),widthMode:'fill',heightMode:work.strictComponents||['panel','accent'].includes(slot.presentation?.components??'')?'fill':'hug',background:theme.background},undefined,false,{maxTypeStep:work.strictComponents?4:Math.min(4,steps[b.id]??0),preferredState:density==='large'?'vertical':density==='compact'?'compact':'horizontal'})
            if(measured.measurement.status!=='fits'){
              const m=measured.measurement,sizes=m.feasibleSizes.slice(0,3).map(s=>`${Math.ceil(s.width*scale)}×${Math.ceil(s.height*scale)}`).join(', ')
              const same=m.feasibleSizes.find(s=>Math.abs(s.width*scale-rect.width)<1),wider=m.feasibleSizes.find(s=>s.width*scale>rect.width)
              if(same||wider)spaceNeeds[b.id]={width:(same?pin.profile.minWidth:wider!.width)*scale,height:(same??wider)!.height*scale+1}
              componentFailure=sizes?`Измеренные подходящие размеры: ${sizes} px. Выдели такую область или выбери другой компонент.`:`${m.issues.join(', ')}. Измеренных подходящих размеров нет; выбери другой компонент.`
              continue
            }
            const trial=measured.measurement.chosen!,wrap=document.createElement('div'),inner=document.createElement('div')
            componentState=trial.state
            spaceNeeds[b.id]={width:pin.profile.minWidth*scale,height:trial.requiredHeight*scale+1}
            if(trial.fields.some(f=>variant.fields[f.id]&&f.fontSize*scale<readableSize(b,variant.fields[f.id])-.1)){componentFailure='Поля компонента меньше читаемого минимума; выбери другой компонент.';continue}
            Object.assign(wrap.style,{width:px(trial.width*scale),height:px(trial.height*scale),flex:'0 0 auto'})
            Object.assign(inner.style,{width:px(trial.width),height:px(trial.height),transform:`scale(${scale})`,transformOrigin:'top left'})
            wrap.appendChild(inner);box.replaceChildren(wrap)
            await renderPreparedBox(inner,library.uploadId,pin,values,measured.measurement)
            fontCSS.add(measured.resources.css)
            const rb=root.getBoundingClientRect(),wb=wrap.getBoundingClientRect()
            for(const f of trial.fields){const key=variant.fields[f.id];if(key)text.push({blockId:b.id,field:key,value:b.fields[key],size:f.fontSize*scale,x:wb.x-rb.x+f.box.x*scale,y:wb.y-rb.y+f.box.y*scale,width:f.box.width*scale,height:f.box.height*scale,font:f.font,color:pin.profile.fields.find(p=>p.id===f.id)!.color,weight:pin.profile.fields.find(p=>p.id===f.id)!.weight})}
          }else{
            const source=library.editable.find(t=>t.id===variant.id)!
            const scalable=source.kind==='text'&&source.sourceLayout?.text.length===1&&!source.sourceLayout.graphicIds.length
            let instance=scalable?studioTextInstance(source,variant,b,rect.width,rect.height,steps[b.id]??0,theme.background):{template:source,data:editableValues(variant,source,b)}
            box.dataset.textInset=String('inset' in instance?instance.inset:0)
            const paint=async(size?:number)=>{
              if(scalable&&size!==undefined)instance=studioTextInstance(source,variant,b,rect.width,rect.height,steps[b.id]??0,theme.background,size)
              box.innerHTML=renderEditableHtml(instance.template,instance.data)
              const issues=await hydrateEditableHtml(box)
              if(source.kind==='text')constrainStudioText(box,rect.width,rect.height)
              return issues
            }
            let problems=await paint()
            if(scalable){
              const titleLimit=Math.min(...text.filter(t=>work.content.blocks.find(b=>b.id===t.blockId)?.role==='title').map(t=>t.size))*.8
              let low=Math.ceil(readableSize(b,'text')/4),high=Math.floor(Math.max(low*4,Math.min(maximumTextSize(b.role),b.role==='body'?titleLimit:Infinity))/4)
              problems=await paint(low*4)
              if(!problems.length&&textFitsBox(box)){
                while(low<high){const mid=Math.ceil((low+high)/2);problems=await paint(mid*4);if(!problems.length&&textFitsBox(box))low=mid;else high=mid-1}
                problems=await paint(low*4)
              }
            }
            const visible=(box.textContent??'').replace(/\s/g,'')
            if(problems.length||box.querySelector('[data-native-overflow="true"]')||!scalable&&!nativeTextKeepsHierarchy(box)||!work.strictComponents&&box.scrollHeight>rect.height+1||Object.values(b.fields).some(v=>!visible.includes(v.replace(/\s/g,'')))){box.replaceChildren();continue}
            for(const [path,field] of Object.entries(variant.fields)){
              const native=instance.template.sourceLayout?.text.find(t=>{const binding=t.binding;return binding.field==='metric'?['value','unit'].includes(path):binding.field==='item'?path===`items.${binding.index??0}.${binding.part??'text'}`:path===binding.field})
              const fieldElement=[...box.querySelectorAll<HTMLElement>('[data-source-text]')].find(el=>el.dataset.sourceText===native?.element.id)
                ??[...box.querySelectorAll<HTMLElement>('[data-field]')].find(el=>el.dataset.field===path)??box
              const receipt=textReceipt(b,field,fieldElement,root)
              {const glyphs=[...fieldElement.querySelectorAll<SVGTextElement>('text')],sizes=glyphs.map(el=>{const m=el.getScreenCTM();return parseFloat(getComputedStyle(el).fontSize)*(m?Math.hypot(m.a,m.b):1)});if(sizes.length)receipt.size=Math.min(...sizes);const style=glyphs[0]?getComputedStyle(glyphs[0]):undefined;if(style){receipt.font=style.fontFamily;receipt.color=style.fill;receipt.weight=parseInt(style.fontWeight)||400}}
              text.push(receipt)
            }
          }
          components.push({blockId:b.id,componentId:variant.id,kind:variant.kind,width:rect.width,height:rect.height,...componentState?{state:componentState}:{}});rendered=true
          if(variant.id!==preferred)warnings.push(`${b.id}: выбран другой совместимый компонент после измерения.`)
          break
        }catch(error){componentFailure=error instanceof Error?error.message:'Ошибка измерения компонента'}
      }
      if(!rendered&&variants.length&&!work.strictComponents&&candidate.authored&&preferComponents&&spaceNeeds[b.id]){
        componentNeeds=true;issues.push(`Размер блока ${b.id}: ${componentFailure}`);continue
      }
      if(!rendered&&variants.length&&!work.strictComponents)warnings.push(`${b.id}: библиотечные компоненты не поместились; применён блок рецепта в стилях дизайн-системы.`)
    }
    if(!rendered&&work.strictComponents){issues.push(`Размер блока ${b.id}: выбранный компонент ${work.plan?.components[b.id]} не помещается в ${Math.round(rect.width)}×${Math.round(rect.height)} px. ${componentFailure}`.trim());continue}
    if(!rendered){
      // A rejected component's feasibility estimate cannot constrain the
      // primitive that actually gets rendered in this slot.
      delete spaceNeeds[b.id];delete box.dataset.textInset
      const treatment=slot.presentation?.components,surface=treatment==='panel'||treatment==='accent'?studioSurface(library,treatment,theme.background):undefined
      const inverse=slot.presentation?.ink==='inverse'?studioSurface(library,'accent',theme.background).ink:slot.presentation?.ink==='panel'?studioSurface(library,'panel',theme.background).ink:undefined
      const localTheme=inverse?{...theme,ink:inverse,titleInk:inverse,metricInk:inverse,accent:inverse}:surface?{...theme,ink:surface.ink,titleInk:surface.ink,metricInk:treatment==='accent'?surface.ink:theme.metricInk,accent:treatment==='accent'?surface.ink:theme.accent}:theme
      const p=primitive(primitiveFor(b,candidate,slot.region),b,localTheme,steps[b.id]??0,work.plan!.primary.includes(b.id),slot.presentation,true,candidate.authored?library:undefined)
      if(p&&surface)Object.assign(p.style,{background:surface.background,padding:'32px',border:surface.background===theme.background?`1px solid ${theme.accent}`:'none'})
      box.replaceChildren(...p?[p]:[])
      const titleLimit=Math.min(...text.filter(t=>work.content.blocks.find(b=>b.id===t.blockId)?.role==='title').map(t=>t.size))*.8
      const heroLimit=Math.min(...text.filter(t=>t.field==='value'&&work.plan!.primary.includes(t.blockId)).map(t=>t.size))*.8
      const paragraphSize=paragraphSizes.get(b.id)
      if(paragraphSize)for(const el of box.querySelectorAll<HTMLElement>('[data-field]'))el.style.fontSize=px(paragraphSize)
      else fitRecipeText(box,b,Math.min(titleLimit,heroLimit),shrink||['display','support'].includes(slot.presentation?.typographyRole??''),slot.presentation?.maxTypeSize)
      for(const el of box.querySelectorAll<HTMLElement>('[data-field]'))text.push(textReceipt(b,el.dataset.field!,el,root))
    }
    if(!nativeWordsFit(box))issues.push(`Слово разорвано переносом в ${b.id}`)
    let requiredHeight=0
    // Verify actual glyph bounds, not the font's line-box reserve alone.
    for(const el of box.querySelectorAll<HTMLElement>('[data-field], [data-component-field], td, th, [data-source-text]')){
      const r=rangeBox(el),container=box.getBoundingClientRect()
      requiredHeight=Math.max(requiredHeight,r.bottom-container.top)
      if(r.width&&r.height&&(r.x<container.x-1||r.right>container.right+1||r.y<container.y-1||r.bottom>container.bottom+1))issues.push(`Переполнение ${b.id}`)
    }
    if((work.strictComponents||candidate.measuredFlow)&&!spaceNeeds[b.id])spaceNeeds[b.id]={width:b.data?Math.min(rect.width,600):160,height:b.data?.template.kind==='chart'?Math.min(rect.height,320):Math.max(60,requiredHeight+Number(box.dataset.textInset??0)+(box.firstElementChild?parseFloat(getComputedStyle(box.firstElementChild).paddingBottom)||0:0),b.data?(box.firstElementChild?.getBoundingClientRect().height??0):0)}
    if(box.scrollHeight>rect.height+2||box.scrollWidth>rect.width+2){
      issues.push(`Размер блока ${b.id} превышен`)
      if(candidate.authored)spaceNeeds[b.id]={width:Math.max(rect.width,box.scrollWidth),height:Math.max(rect.height,box.scrollHeight)}
    }
  }
  // A group of metrics shares a type scale. Shrinking to the smallest measured
  // member preserves every fit and prevents arbitrary emphasis from caption length.
  for(const slot of candidate.slots.filter(s=>s.presentation?.contentTreatment==='metric'&&s.blocks.length>1)){
    for(const role of ['grid-value','grid-label']){
      const elements=slot.blocks.flatMap(id=>[...boxes.get(id)!.querySelectorAll<HTMLElement>(`[data-type-role="${role}"]`)])
      const size=Math.min(...elements.map(el=>parseFloat(getComputedStyle(el).fontSize)))
      for(const el of elements)el.style.fontSize=px(size)
      // Equalising values releases height in shorter cells. Let their labels
      // use it together, preserving a shared scale and every measured boundary.
      if(role==='grid-label'&&elements.length){
        let low=Math.floor(size/4),high=Math.floor(Math.min(maximumTextSize(role),slot.presentation?.maxTypeSize??Infinity)/4)
        const paint=(step:number)=>elements.forEach(el=>{el.style.fontSize=px(step*4)})
        while(low<high){const mid=Math.ceil((low+high)/2);paint(mid);if(slot.blocks.every(id=>textFitsBox(boxes.get(id)!)))low=mid;else high=mid-1}
        paint(low)
      }
    }
    for(const id of slot.blocks)for(const el of boxes.get(id)!.querySelectorAll<HTMLElement>('[data-field]')){
      const b=work.content.blocks.find(b=>b.id===id)!,index=text.findIndex(t=>t.blockId===id&&t.field===el.dataset.field)
      if(index>=0)text[index]=textReceipt(b,el.dataset.field!,el,root)
    }
  }
  const all=[...boxes.values()]
  all.forEach((a,i)=>{const x=a.getBoundingClientRect();all.slice(i+1).forEach(b=>{const y=b.getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)issues.push('Пересечение блоков')})})
  for(const b of work.content.blocks)if(!receiptPreservesFields(b,text))issues.push(`Не размещено поле ${b.id}: нарушена точная привязка фрагментов`)
  if(!respectsPlacement(candidate,work.content))issues.push('Не соблюдено указанное расположение содержания')
  for(const t of text){const b=work.content.blocks.find(b=>b.id===t.blockId)!;if(t.size<readableSize(b,t.field)-.1)issues.push(`Мелкий текст ${b.id}.${t.field}: ${t.size.toFixed(1)} px`)}
  return {root,issues:[...new Set(issues)],warnings,components,text,dataValues,dataTextSizes,spaceNeeds,componentNeeds,fontCSS:[...fontCSS]}
}

/** One executor serves both modes. Geometry is measured locally; no extra LLM
 * critique calls or content truncation are hidden in a render retry. */
export async function renderStudioSlide(library:StudioLibrary,work:SlideWork,signal?:AbortSignal,policy:{fontFit?:boolean;captureFailure?:boolean;fittingBudgetMs?:number}={}):Promise<RenderReceipt>{
  if(!work.plan)throw Error('Нет решения для слайда.')
  const started=performance.now();await ensureUploadFonts(library.uploadId)
  const preferredFont=studioTheme(library).font
  let fonts:Awaited<ReturnType<typeof prepareLayoutFonts>>|undefined,selectedFont=preferredFont
  for(const font of studioFonts(library)){
    signal?.throwIfAborted()
    try{
      fonts=await prepareLayoutFonts({uploadId:library.uploadId,fonts:[{id:'body',family:font.family}]})
      selectedFont=font.family;break
    }catch(error){if(!(error instanceof Error)||!error.message.startsWith('FONT_TOKEN_UNAVAILABLE'))throw error}
  }
  if(!fonts)throw Error('Шрифты выбранной дизайн-системы недоступны. Добавьте исходные шрифты или выберите другую систему.')
  const host=document.createElement('div');Object.assign(host.style,{position:'fixed',left:'-22000px',top:'0'});document.body.appendChild(host)
  const matches=(c:Candidate)=>c.slots.reduce((n,s)=>n+s.blocks.filter(id=>slotBindings(work,library,s,id).some(v=>v.id===work.plan!.components[id])).length,0)
  const candidates=work.candidates.map(c=>reserveMasterSpace(c,library)).sort((a,b)=>matches(b)-matches(a)||Number(b.id===work.plan!.candidateId)-Number(a.id===work.plan!.candidateId))
  let last:Awaited<ReturnType<typeof draw>>|undefined,chosen:Candidate|undefined
  try{
    fitting: for(const reduceFont of policy.fontFit===false?[false]:[false,true]){
    for(const c of candidates){
      const steps:Record<string,number>={}
      let previousSizes='',relaxNeighbors=false,active=c,spaceAttempts=0,preferComponents=true
      const fittingStarted=performance.now()
      for(let attempt=0;attempt<64;attempt++){
        // A difficult source component must not monopolize a whole generation.
        // Its recipe primitive gets one measured attempt before another recipe.
        if(performance.now()-fittingStarted>(policy.fittingBudgetMs??6000)){
          if(!work.strictComponents&&preferComponents){preferComponents=false;spaceAttempts=8}else break
        }
        let smallestIssues:string[]|undefined
        // Geometry before local text reduction. +/-30% is relative to each
        // recipe region; font sizes in primitive blocks always remain /4.
        for(const geometry of work.strictComponents||c.measuredFlow?[0]:[0,.3,-.3]){
          signal?.throwIfAborted();last=await draw(library,work,active,steps,geometry,host,selectedFont,reduceFont,preferComponents);chosen=active
          if(!smallestIssues||last.issues.length<smallestIssues.length)smallestIssues=last.issues
          if(!last.issues.length)break
        }
        if(!last?.issues.length)break
        const measuredNodes=work.strictComponents?work.flexNodes:c.measuredFlow
        if(measuredNodes&&spaceAttempts<8){
          const fitted=fitMeasuredFlex(measuredNodes,active,last.spaceNeeds,true)
          if(fitted&&fitted.slots.some((s,i)=>Math.abs(s.rect.w-active.slots[i].rect.w)>.5||Math.abs(s.rect.h-active.slots[i].rect.h)>.5)){active=reserveMasterSpace(fitted,library);spaceAttempts++;continue}
        }
        if(c.authored&&spaceAttempts<4){
          const fitted=fitIncomingCandidate(active,last.spaceNeeds)
          if(fitted&&fitted.slots.some((s,i)=>Math.abs(s.rect.w-active.slots[i].rect.w)>.5||Math.abs(s.rect.h-active.slots[i].rect.h)>.5)){active=reserveMasterSpace(fitted,library);spaceAttempts++;continue}
        }
        if(last.componentNeeds&&preferComponents){preferComponents=false;continue}
        if(!reduceFont)break
        const sizes=JSON.stringify([last.text.map(t=>[t.blockId,t.field,t.size]),last.dataTextSizes])
        if(sizes===previousSizes){
          if(relaxNeighbors)break
          // A neighboring metric may still use a large type size while this
          // paragraph has reached its readable floor. Allow the shared flex
          // group to yield space before rejecting the whole composition.
          relaxNeighbors=true
        }
        previousSizes=sizes
        // A long title must not make a roomy body or a metric caption smaller.
        const overflowing=work.content.blocks.filter(b=>smallestIssues?.some(issue=>/Переполнение|Размер блока/.test(issue)&&new RegExp(`\\b${b.id}(?:\\b|\\.)`).test(issue)))
        if(!overflowing.length)break
        const targets=relaxNeighbors?work.content.blocks.filter(b=>c.slots.some(s=>s.blocks.includes(b.id)&&s.blocks.some(id=>overflowing.some(o=>o.id===id)))):overflowing
        for(const block of targets)steps[block.id]=(steps[block.id]??0)+1
      }
      if(!last?.issues.length)break fitting
    }
    }
    if(!last||!chosen)throw Error('Нет исполнимого рецепта.')
    const original=work.candidates.find(c=>c.id===chosen!.id)!
    if(work.strictComponents&&chosen.slots.some((s,i)=>Math.abs(s.rect.w-original.slots[i].rect.w)>.5||Math.abs(s.rect.h-original.slots[i].rect.h)>.5))last.warnings.push('Размеры flex-блоков перераспределены по замерам; порядок, отступы и компоненты Qwen сохранены.')
    const brandAccents=last.issues.length?undefined:applyStudioBrandAccents(last.root,library,work,chosen,last.text)
    const master=library.backgrounds?.masters?.[0]
    if(master){
      const footer=document.createElement('div');footer.dataset.studioMaster=master.id;footer.setAttribute('aria-hidden','true')
      Object.assign(footer.style,{position:'absolute',inset:'0',pointerEvents:'none'})
      footer.innerHTML=await studioBackground(library,{fillId:null,layers:[],masterId:master.id});last.root.appendChild(footer)
    }
    if(!last.issues.length)addStudioChrome(last.root,work,chosen,chosen.authored?.surface==='slide-inverse'?studioSurface(library,'accent').ink:getComputedStyle(last.root).color)
    if(!last.issues.length&&!chosen.backgroundId&&chosen.authored?.surface!=='slide-inverse'){
      const origin=last.root.getBoundingClientRect(),occupied:Box[]=[],rules:Box[]=[]
      if(master)for(const item of master.items){const b=masterItemBounds(master,item,{width:1920,height:1080});occupied.push({x:b.x,y:b.y,w:b.width,h:b.height})}
      for(const el of last.root.querySelectorAll<HTMLElement>('[data-field], [data-component-field], [data-source-text], [data-studio-chrome], [data-editable-chart], table')){
        const r=el.matches('table,[data-editable-chart]')?el.getBoundingClientRect():rangeBox(el)
        if(r.width&&r.height)occupied.push({x:r.x-origin.x,y:r.y-origin.y,w:r.width,h:r.height})
      }
      for(const el of last.root.querySelectorAll<HTMLElement>('[data-recipe-decoration], [style*="border"]')){
        const r=el.getBoundingClientRect(),style=getComputedStyle(el),x=r.x-origin.x,y=r.y-origin.y
        if(el.dataset.recipeDecoration)rules.push({x,y,w:r.width,h:r.height})
        else {
          const top=parseFloat(style.borderTopWidth),bottom=parseFloat(style.borderBottomWidth),left=parseFloat(style.borderLeftWidth),right=parseFloat(style.borderRightWidth)
          if(top>0)rules.push({x,y,w:r.width,h:top})
          if(bottom>0)rules.push({x,y:y+r.height-bottom,w:r.width,h:bottom})
          if(left>0)rules.push({x,y,w:left,h:r.height})
          if(right>0)rules.push({x:x+r.width-right,y,w:right,h:r.height})
        }
      }
      const design=contentBackground(library,occupied,last.components.flatMap(c=>{const t=library.editable.find(t=>t.id===c.componentId);return t?[t.slide]:[]}),chosen.canvasFillId,rules)
      if(design){const layer=document.createElement('div');layer.dataset.studioBackground=design.id;layer.setAttribute('aria-hidden','true');Object.assign(layer.style,{position:'absolute',inset:'0',pointerEvents:'none'});layer.innerHTML=await studioBackground(library,design.selection);last.root.insertBefore(layer,last.root.firstChild)}
    }
    const fontEmbedCSS=[...new Set([...Object.values(fonts.css),...last.fontCSS]),await getFontEmbedCSS(last.root).catch(()=>'')].join('\n'),preview=last.issues.length&&policy.captureFailure===false?'':await toPng(last.root,{pixelRatio:2/3,fontEmbedCSS,cacheBust:false})
    if(chosen.id!==work.plan.candidateId)last.warnings.push('После измерения использован другой совместимый рецепт: '+chosen.label)
    if(selectedFont!==preferredFont)last.warnings.push(`Шрифт «${preferredFont}» недоступен; для текста рецепта использован «${selectedFont}» из этой дизайн-системы.`)
    return {slideId:work.content.id,candidateId:chosen.id,quality:designQuality(work.content,chosen,{text:last.text}),passed:!last.issues.length,...brandAccents?{brandAccents}:{},preview,html:'<style>'+fontEmbedCSS.replaceAll('</style','<\\/style')+'</style>'+last.root.outerHTML,blockIds:work.content.blocks.map(b=>b.id),...(work.strictComponents||chosen.measuredFlow?{layout:Object.fromEntries(chosen.slots.map(s=>[s.blocks[0],s.rect]))}:{}),issues:last.issues,warnings:last.warnings,components:last.components,text:last.text,dataValues:last.dataValues,elapsedMs:Math.round(performance.now()-started)}
  }finally{host.remove()}
}

/** Render before choosing. The selected preview becomes the deliverable;
 * no post-selection component substitutions or geometry changes are needed. */
export async function renderStudioOptions(library:StudioLibrary,work:SlideWork,signal?:AbortSignal,policy:{limit?:1|2|3}={}):Promise<DesignOption[]>{
  if(!work.candidates.length)throw Error(work.error??'Нет совместимых рецептов для слайда.')
  const options:DesignOption[]=[],failures:string[]=[],seen=new Set<string>(),started=performance.now()
  const drafts=draftOptions(work,library)
  // Finish the small set of source-cover arrangements before plain recipes.
  // A weak headline-low cover must not hide its readable centered sibling
  // behind dozens of generic families and exhaust the option budget.
  const queue:DesignOption[]=[]
  const families=new Map<string,DesignOption[]>()
  for(const option of drafts){
    const candidate=work.candidates.find(c=>c.id===option.plan.candidateId)!
    if(candidate.backgroundId){queue.push(option);continue}
    const family=candidate.recipeId
    families.set(family,[...families.get(family)??[],option])
  }
  while([...families.values()].some(v=>v.length))for(const pool of families.values()){const option=pool.shift();if(option)queue.push(option)}
  const accepted=new Set<string>()
  let attemptsSinceFit=0
  // Complete type fitting within each recipe before trying a weaker family.
  // A global unscaled pass could spend the budget on poor layouts and never
  // revisit the best recipe with a size that fits its intended text area.
  fit: for(const option of queue){
    const hasStrongOption=options.some(o=>(o.receipt?.quality?.score??0)>=94)
    if(options.length&&performance.now()-started>(hasStrongOption?6000:30_000))break fit
    if(options.length&&attemptsSinceFit>=24)break fit
    attemptsSinceFit++
    if(accepted.has(option.id))continue
    signal?.throwIfAborted()
    const candidate=work.candidates.find(c=>c.id===option.plan.candidateId)!
    const receipt=await renderStudioSlide(library,{...work,candidates:[candidate],plan:option.plan,strictComponents:work.strictComponents||!!candidate.fixedComponents,flexNodes:candidate.measuredFlow??work.flexNodes},signal,{fontFit:true,captureFailure:false,...hasStrongOption?{fittingBudgetMs:1200}:{}})
    if(!receipt.passed){failures.push(...receipt.issues);continue}
    const components=Object.fromEntries(receipt.components.filter(c=>work.strictComponents||candidate.fixedComponents||!work.content.blocks.find(b=>b.id===c.blockId)?.data).map(c=>[c.blockId,c.componentId]))
    const signature=optionSignature(candidate,library,components,Object.fromEntries(receipt.components.flatMap(c=>c.state?[[c.blockId,c.state]]:[])))
    if(seen.has(signature))continue
    seen.add(signature);accepted.add(option.id);attemptsSinceFit=0
    options.push({...option,signature,plan:{...option.plan,components},receipt:{...receipt,optionId:option.id}})
    // Once several strong, genuinely distinct layouts fit, further rendering
    // only delays the deliverable. Keep searching when quality is still weak.
    const target=policy.limit??3,good=options.filter(o=>(o.receipt?.quality?.score??0)>=94)
    if(good.length>=target&&new Set(good.map(o=>work.candidates.find(c=>c.id===o.plan.candidateId)!.recipeId)).size>=Math.min(2,target))break fit
    if(options.length>=(work.strictComponents?1:8))break fit
  }
  if(!options.length){
    const unique=[...new Set(failures)],specific=work.strictComponents?unique.filter(issue=>!issue.startsWith('Не размещено поле')):unique
    throw Error((work.strictComponents?'Выбранная Qwen сетка компонентов не прошла измерение. Повтор передаст замечания модели; содержание сохранено. ':'Доступные композиции не вместили слайд при читаемом размере текста. Содержание сохранено; требуется сокращение или разделение. ')+specific.slice(0,8).join('; '))
  }
  const best=Math.max(...options.map(o=>o.receipt?.quality?.score??0)),direction=work.variation?.mode==='fast'?undefined:work.variation?.mode
  const matches=(o:DesignOption)=>!!work.variation&&work.candidates.find(c=>c.id===o.plan.candidateId)?.artDirection===direction&&(o.receipt?.quality?.score??0)>=Math.max(86,best-12)
  return options.sort((a,b)=>Number(matches(b))-Number(matches(a))||(b.receipt?.quality?.score??0)-(a.receipt?.quality?.score??0)).slice(0,policy.limit??3)
}
