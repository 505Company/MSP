import type {Candidate,ContentBlock,ContentSlide,Slot,SlotPresentation} from './contract'

const plain=(b:ContentBlock)=>!b.data&&!b.placement&&['text','list','feature'].includes(b.kind)
const fields=(b:ContentBlock)=>Object.values(b.fields)
const label=(b:ContentBlock)=>b.fields.heading??b.fields.text??''
const short=(b:ContentBlock)=>plain(b)&&fields(b).every(t=>t.split('\n').every(l=>l.length<=66&&!/[.!?]\s*$/.test(l)))&&!/\d/.test(b.source)
const makeSlot=(region:string,blocks:ContentBlock[],x:number,y:number,w:number,h:number,p:SlotPresentation={},columns=1,gap=32):Slot=>({region,blocks:blocks.map(b=>b.id),rect:{x,y,w,h},direction:columns>1?'wrap':'column',columns,gap,presentation:{primitiveFirst:true,typographyRole:'support',maxTypeSize:64,...p}})

/** Recognize relationships from structure, independent of subject, slide index,
 * or mode. The recipe binds the original blocks and fields without rewriting. */
export function structuredPattern(slide:ContentSlide){
 const body=slide.blocks.filter(b=>b.role==='body')
 if(!body.length||body.some(b=>!plain(b)))return
 const headings=body.filter(b=>/:\s*$/.test(label(b))&&label(b).length<100)
 if(headings.length){
  const sections:ContentBlock[][]=[],before:ContentBlock[]=[],after:ContentBlock[]=[]
  for(const b of body){
   if(headings.includes(b))sections.push([b])
   else if(!sections.length)before.push(b)
   else if(b===body.at(-1)&&b.kind==='text'&&b.source.length>72)after.push(b)
   else sections.at(-1)!.push(b)
  }
  if(sections.length<=4&&sections.every(g=>g.length<=7)&&before.length<=2&&after.length<=1)return {kind:'sections' as const,sections,before,after}
 }
 const paired=body.every(b=>b.kind==='feature'&&b.fields.heading.length<=66&&b.fields.body?.length<=100&&/\d/.test(b.fields.body))
 if(paired&&body.length>=3&&body.length<=6)return {kind:'pairs' as const,pairs:body.map(b=>[b])}
 if(body.length>=6&&body.length<=12&&body.length%2===0&&body.every((b,i)=>b.kind==='text'&&b.source.length<=100&&(i%2? /\d/.test(b.source):! /\d/.test(b.source)))){
  return {kind:'pairs' as const,pairs:Array.from({length:body.length/2},(_,i)=>body.slice(i*2,i*2+2))}
 }
 const items=body.filter(short),prose=body.filter(b=>!items.includes(b))
 const count=items.reduce((n,b)=>n+fields(b).join('\n').split('\n').filter(Boolean).length,0)
 if(count>=3&&count<=12&&prose.length<=2&&prose.every(b=>b.kind==='text'||b.kind==='list'))return {kind:'list' as const,items,prose,count}
}

export function structuredCompositions(slide:ContentSlide):Candidate[]{
 const titles=slide.blocks.filter(b=>b.role==='title'),footers=slide.blocks.filter(b=>b.role==='footer'),body=slide.blocks.filter(b=>b.role==='body')
 if(titles.length!==1||footers.length>1||body.some(b=>b.data||b.placement))return []
 const title=titles[0],top=title.source.length>80?360:title.source.length>44?320:272,bottom=footers.length?884:1008,height=bottom-top
 const header=makeSlot('headline',[title],80,80,1760,top-120,{typographyRole:'title',maxTypeSize:112})
 const tail=footers.map(b=>makeSlot('conclusion',[b],80,924,1760,100,{maxTypeSize:44}))
 const result:Candidate[]=[]
 const make=(name:string,label:string,slots:Slot[],decorations:Candidate['decorations']=[]):Candidate=>({id:'composition/'+name,recipeId:'composition/'+name,label,score:340,preserveReadingOrder:true,slots:[header,...slots,...tail],decorations,sources:['19:209/text-columns-01','39:798/instructions-six-faq','33:223/fact-explanations-01']})
 const rule=(id:string,x:number,y:number,w:number,h=3)=>({id,rect:{x,y,w,h},surface:'rule' as const})
 const pattern=structuredPattern(slide)
 if(pattern?.kind==='sections'){
  const {sections,before,after}=pattern,end=after.length?bottom-112:bottom
  if(sections.length>=2&&!before.length){
   const width=(1760-56*(sections.length-1))/sections.length
   const slots=sections.map((g,i)=>makeSlot('section-'+i,g,80+i*(width+56),top+32,width,end-top-32,{contentTreatment:'section',maxTypeSize:52},1,24))
   result.push(make('section-columns','Этапы · смысловые колонки',[...slots,...after.map(b=>makeSlot('takeaway',[b],80,end+32,1760,112,{maxTypeSize:44}))],sections.map((_,i)=>rule('section-'+i,80+i*(width+56),top,width))))
  }
  if(sections.length===1&&before.length<=2){
   const g=sections[0],x=before.length?992:80,w=before.length?848:1760
   result.push(make('section-list','Тезис и связанный список',[
    ...before.length?[makeSlot('lead',before,80,top,800,end-top,{maxTypeSize:64},1,48)]:[],
    makeSlot('list',g,x+32,top+32,w-64,end-top-64,{contentTreatment:'section',ink:'inverse',maxTypeSize:52},1,10),
    ...after.map(b=>makeSlot('takeaway',[b],80,end+32,1760,112,{maxTypeSize:44})),
   ],[{id:'list-panel',rect:{x,y:top,w,h:end-top},surface:'accent'}]))
  }
 }
 if(pattern?.kind==='pairs'){
  for(const variant of ['cards','rows'] as const){
   const columns=variant==='cards'?2:1,rows=Math.ceil(pattern.pairs.length/columns),w=(1760-48*(columns-1))/columns,h=(height-36*(rows-1))/rows
   const slots:Slot[]=[],decorations:NonNullable<Candidate['decorations']>=[]
   for(const [i,pair] of pattern.pairs.entries()){
    const x=80+(i%columns)*(w+48),y=top+Math.floor(i/columns)*(h+36)
    decorations.push(rule('pair-'+i,x,y+h-3,w))
    if(pair.length===1)slots.push(makeSlot('pair-'+i,pair,x,y,w,h-24,{contentTreatment:'pair',maxTypeSize:64}))
    else if(variant==='cards'){
     slots.push(makeSlot('label-'+i,[pair[0]],x,y,w,76,{maxTypeSize:56,ink:'accent'}),makeSlot('value-'+i,[pair[1]],x,y+100,w,h-124,{maxTypeSize:64}))
    }else slots.push(makeSlot('label-'+i,[pair[0]],x,y,w*.42,h-24,{maxTypeSize:56,ink:'accent'}),makeSlot('value-'+i,[pair[1]],x+w*.47,y,w*.53,h-24,{maxTypeSize:64}))
   }
   result.push(make('paired-'+variant,variant==='cards'?'Связанные пары · карточки':'Связанные пары · строки',slots,decorations))
  }
 }
 if(pattern?.kind==='list'){
  const {items}=pattern,conclusion=pattern.prose.length>1&&pattern.prose.at(-1)===body.at(-1)?pattern.prose.at(-1):undefined
  const prose=pattern.prose.filter(b=>b!==conclusion),multi=items.some(b=>fields(b).join('\n').includes('\n')),listHeight=height-(conclusion?124:0)
  for(const variant of ['grid','rail'] as const){
   const alongside=prose.length>0&&variant==='rail',intro=prose.length>0&&!alongside?Math.min(320,Math.max(176,Math.ceil(prose.reduce((n,b)=>n+b.source.length,0)/62)*60+32)):0
   const x=alongside?992:80,w=alongside?848:1760,y=top+intro,h=listHeight-intro
   const columns=alongside?1:multi?Math.min(2,items.length):variant==='rail'?2:items.length>=6?3:2
   result.push(make('list-'+variant,variant==='grid'?'Перечень · крупная сетка':'Перечень · акцентная колонка',[
    ...prose.length?[makeSlot('context',prose,80,top,alongside?800:1760,alongside?listHeight:intro-32,{maxTypeSize:56},1,32)]:[],
    makeSlot('items',items,x,y,w,h,{contentTreatment:'list',repeatColumns:multi?(items.length===1&&!alongside?2:1):undefined,maxTypeSize:60,...variant==='rail'?{ink:'accent' as const}:{}},columns,48),
    ...conclusion?[makeSlot('takeaway',[conclusion],80,bottom-96,1760,96,{maxTypeSize:44})]:[],
   ]))
  }
 }
 // A number can be the title of a statistical slide. Keep its explanation
 // attached to it; never promote an unrelated secondary metric above it.
 const numericTitle=/^[+−–-]?\d[\d\s.,]*\s*\S{1,20}$/.test(title.source)&&title.source.length<=32
 const caption=body[0],secondaryMetrics=body.slice(1)
 if(numericTitle&&caption?.kind==='text'&&caption.source.length<=140&&secondaryMetrics.length>=2&&secondaryMetrics.length<=3&&secondaryMetrics.every(b=>b.kind==='metric'||b.kind==='feature'&&/^\d/.test(b.fields.heading??''))){
  const slots=[makeSlot('main-value',[title],112,192,760,180,{typographyRole:'metric-value',ink:'inverse',maxTypeSize:144}),makeSlot('main-caption',[caption],112,436,760,300,{ink:'inverse',maxTypeSize:56}),makeSlot('other-facts',secondaryMetrics,1024,128,816,880,{contentTreatment:'metric',maxTypeSize:128},1,32)]
  result.push({...make('number-story','Главный показатель и контекст',slots,[{id:'main-fact',rect:{x:80,y:128,w:832,h:880},surface:'accent'}]),slots:[...slots,...tail]})
  const band=[makeSlot('main-value',[title],112,152,792,196,{typographyRole:'metric-value',ink:'inverse',maxTypeSize:144}),makeSlot('main-caption',[caption],1000,152,808,212,{ink:'inverse',maxTypeSize:56}),makeSlot('other-facts',secondaryMetrics,80,500,1760,bottom-500,{contentTreatment:'metric',maxTypeSize:128},secondaryMetrics.length,48)]
  result.push({...make('number-story-band','Главный показатель · широкая область',band,[{id:'main-fact',rect:{x:80,y:112,w:1760,h:312},surface:'accent'}]),slots:[...band,...tail]})
 }
 const metrics=body.filter(b=>b.kind==='metric')
 const context=body.filter(b=>!metrics.includes(b))
 if(metrics.length===4&&context.length===1&&context[0].kind==='text'){
  result.push(make('metrics-rail','Показатели · нижняя лента',[
   makeSlot('context',context,80,top,1760,180,{maxTypeSize:56}),
   makeSlot('metrics',metrics,80,top+248,1760,height-248,{contentTreatment:'metric',maxTypeSize:128},4,40),
  ]))
 }
 if(metrics.length>=4&&metrics.length<=8&&metrics.length===body.length){
  for(const columns of [2,3]){
   result.push(make('metric-cells-'+columns,'Показатели · открытые ячейки '+columns,[makeSlot('metrics',metrics,80,top,1760,height,{contentTreatment:'metric',maxTypeSize:128},columns,48)]))
  }
 }
 return result
}
