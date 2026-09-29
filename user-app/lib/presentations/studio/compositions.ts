import type {Candidate,ContentBlock,ContentSlide,Slot,SlotPresentation} from './contract'

const slot=(region:string,blocks:string[],x:number,y:number,w:number,h:number,presentation:SlotPresentation={},direction:Slot['direction']='column',columns=1,gap=24):Slot=>({region,blocks,rect:{x,y,w,h},direction,columns,gap,presentation})
const ids=(blocks:ContentBlock[])=>blocks.map(b=>b.id)
export const isStep=(b:ContentBlock)=>b.kind==='step'||b.kind==='feature'&&/^\d{1,2}[.)]?$/.test(b.fields.heading?.trim()??'')
const metricLike=(b:ContentBlock)=>b.kind==='metric'||b.kind==='feature'&&!isStep(b)&&!!b.fields.body&&/^[+−–-]?\d[\d\s.,]*\s*[%\p{L}]*$/u.test(b.fields.heading??'')
const narrative=(b:ContentBlock)=>['feature','list','text','quote'].includes(b.kind)&&!b.data
export const compositionCatalog=[
  {id:'mosaic',label:'Крупный факт · мозаика карточек',use:'Один главный факт и 1–3 пояснения',accepted:true},
  {id:'spotlight',label:'Вертикальный акцент',use:'Факт, две опорные карточки и выделенный тезис'},
  {id:'ribbon',label:'Широкая акцентная карточка',use:'Факт и 2–3 пояснения с широким завершающим блоком'},
  {id:'metrics',label:'Показатели и контекст',use:'2–4 показателя и 1–2 блока пояснений'},
  {id:'journey',label:'Маршрут по шагам',use:'3–5 шагов и до трёх дополнительных показателей'},
  {id:'comparison',label:'Две стороны',use:'Два сопоставляемых блока и необязательный показатель'},
  {id:'comparison-sections',label:'Два состояния · акцентная область',use:'Короткие пункты первого состояния и связанный тезис второго'},
  {id:'metric-grid',label:'Показатели · крупные карточки',use:'Два или три показателя и контекст'},
  {id:'metric-focus',label:'Крупный показатель и вывод',use:'Один показатель с пояснением'},
  {id:'fact-grid',label:'Факты · две колонки',use:'Короткие факты и показатели с общим выводом'},
  {id:'evidence',label:'История и цифры',use:'2–3 смысловых блока и 1–3 показателя'},
] as const

/** A short section label after a sequence of short points is a boundary,
 * not another item in that sequence. Works on immutable model text blocks. */
export function comparisonSections(slide:ContentSlide){
  const titles=slide.blocks.filter(b=>b.role==='title'),body=slide.blocks.filter(b=>b.role==='body')
  if(titles.length!==1||titles[0].source.length>60||body.some(b=>b.kind!=='text'||Object.keys(b.fields).length!==1||b.data||b.placement))return
  const pivot=body.findIndex((b,i)=>i>=2&&i<=5&&b.emphasis==='secondary'&&b.source.length<=36&&body.slice(0,i).every(p=>p.source.length<=85)&&body[i+1]?.source.length>=45)
  if(pivot<0)return
  const following=body.slice(pivot+1),conclusion=following.length>1&&following.at(-1)!.emphasis==='secondary'?following.pop():undefined
  if(!following.length||following.length>2)return
  return {title:titles[0],before:body.slice(0,pivot),label:body[pivot],after:following,conclusion}
}

/** Universal flex compositions. User accepted mosaic and rejected editorial /
 * column. Those two are retired from new runs; saved results remain immutable.
 * Every recipe declares compatible semantic groups rather than sample words,
 * library IDs or colors. These are newly authored combinations, not Figma copies. */
export function compositionsFor(slide:ContentSlide):Candidate[]{
  const title=slide.blocks.filter(b=>b.role==='title'),footer=slide.blocks.filter(b=>b.role==='footer'),body=slide.blocks.filter(b=>b.role==='body')
  if(title.length!==1||footer.length>1||!body.length||body.some(b=>b.data))return []
  const sources=['33:223/fact-explanations-01','19:209/text-columns-01','6:185/dense-editorial-01']
  const tailHeight=Math.min(144,Math.max(76,(footer[0]?.source.split('\n').length??1)*44)),tailY=1032-tailHeight
  const bottom=footer.length?tailY-48:1000,top=title[0].source.length>80?360:title[0].source.length>48?320:268,height=bottom-top,head=title[0].id
  const heading=slot('headline',[head],80,64,1760,top-112,{primitiveFirst:true,maxTypeSize:112,typeScale:.875,ink:'accent'})
  const tail=footer.map(b=>slot('takeaway',[b.id],80,tailY,1760,tailHeight,{ink:'ink'}))
  const make=(id:typeof compositionCatalog[number]['id'],slots:Slot[],score:number):Candidate=>({id:`composition/${id}`,recipeId:`composition/${id}`,label:compositionCatalog.find(c=>c.id===id)!.label,slots:[heading,...slots,...tail],score,sources})
  const result:Candidate[]=[],metrics=body.filter(metricLike),steps=body.filter(isStep),prose=body.filter(b=>narrative(b)&&!metricLike(b))
  const comparison=comparisonSections(slide)
  if(comparison){
    const end=comparison.conclusion?Math.min(832,bottom-168):bottom,panel={x:968,y:112,w:872,h:end-112}
    result.push({id:'composition/comparison-sections',recipeId:'composition/comparison-sections',label:'Два состояния · акцентная область',score:300,sources,
      decorations:[{id:'second-state',rect:panel,surface:'accent'},{id:'first-state-rule',rect:{x:80,y:300,w:768,h:3},surface:'rule'}],
      slots:[
        slot('first-heading',[comparison.title.id],80,160,768,112,{primitiveFirst:true,maxTypeSize:112}),
        slot('first-state',ids(comparison.before),80,344,768,end-376,{primitiveFirst:true,typographyRole:'support',maxTypeSize:64},'column',1,32),
        slot('second-heading',[comparison.label.id],1016,160,776,112,{primitiveFirst:true,typographyRole:'section-heading',maxTypeSize:112,ink:'inverse'}),
        slot('second-state',ids(comparison.after),1016,344,776,end-392,{primitiveFirst:true,typographyRole:'support',maxTypeSize:68,ink:'inverse'},'column',1,48),
        ...comparison.conclusion?[slot('shared-conclusion',[comparison.conclusion.id],80,end+48,1760,120,{primitiveFirst:true,typographyRole:'support',maxTypeSize:56})]:[],...tail,
      ]})
  }
  const hero=body.find(b=>b.emphasis==='primary')??metrics[0]??prose[0],rest=body.filter(b=>b!==hero)
  const split=hero&&rest.length>=1&&rest.length<=3&&rest.every(narrative)
  if(split){
    const upper=Math.round((height-28)*.5/4)*4,lowerY=top+upper+28
    result.push(make('mosaic',[
      slot('hero',[hero.id],80,top,752,height,{components:'any',scale:1.2,align:'center'}),
      ...(rest.length>1?[
        slot('lead-explanation',[rest[0].id],960,top,880,upper,{components:'accent',align:'center'}),
        slot('supporting-explanations',ids(rest.slice(1)),960,lowerY,880,bottom-lowerY,{components:'panel'},'row',2,28),
      ]:[slot('explanation',ids(rest),960,top,880,height,{components:'accent',align:'center'})]),
    ],180))
    if(rest.length===3)result.push(make('spotlight',[
      slot('hero',[hero.id],80,top,616,height,{components:'any',scale:1.05,align:'center'}),
      slot('supporting-explanations',ids(rest.slice(0,2)),736,top,524,height,{components:'panel'},'column',1,28),
      slot('vertical-accent',[rest[2].id],1300,top,540,height,{components:'accent',scale:1,align:'center',headingScale:1.7}),
    ],170))
    if(rest.length>=2){const rowHeight=Math.floor((height-28)*.42/4)*4,accentY=top+rowHeight+28
      result.push(make('ribbon',[
        slot('hero',[hero.id],80,top,616,height,{components:'any',scale:1.15,align:'center'}),
        slot('supporting-explanations',ids(rest.slice(0,-1)),752,top,1088,rowHeight,{components:'panel'},'row',2,28),
        slot('wide-accent',[rest.at(-1)!.id],752,accentY,1088,bottom-accentY,{components:'accent',scale:1,align:'center'}),
      ],165))
    }
  }
  if(metrics.length>=2&&metrics.length<=4&&prose.length>=1&&prose.length<=2&&metrics.length+prose.length===body.length){
    const half=(height-28)/2,first=metrics.slice(0,2),last=metrics.slice(2)
    result.push(make('metrics',[
      ...(last.length?[
        slot('top-metrics',ids(first),80,top,1040,half,{primitiveFirst:true,contentTreatment:'metric',maxTypeSize:128},'row',2,40),
        slot('bottom-metrics',ids(last),80,top+half+28,1040,half,{primitiveFirst:true,contentTreatment:'metric',maxTypeSize:128},'row',2,40),
      ]:[slot('metrics',ids(metrics),80,top,1040,height,{primitiveFirst:true,contentTreatment:'metric',maxTypeSize:160},'column',1,40)]),
      slot('context',ids(prose),1160,top,680,height,{components:'accent',align:'center',maxHeadingRatio:2,typeScale:1.25},'column',1,28),
    ],210))
  }
  const stepNotes=body.filter(b=>!steps.includes(b)&&!metrics.includes(b))
  if(steps.length>=3&&steps.length<=6&&metrics.length<=3&&stepNotes.length<=1&&stepNotes.every(narrative)){ 
    const railHeight=metrics.length?200:stepNotes.length?152:0,stepHeight=height-(railHeight?railHeight+32:0),width=(1760-28*(steps.length-1))/steps.length
    result.push(make('journey',[
      ...steps.map((b,i)=>slot(`step-${i+1}`,[b.id],80+i*(width+28),top,width,stepHeight,{components:i===0?'accent':'panel',primitiveFirst:true,typeScale:steps.length>3?.9:1.05,markerScale:1.8})),
      ...stepNotes.map(b=>slot('step-conclusion',[b.id],80,bottom-railHeight,1760,railHeight,{primitiveFirst:true,typographyRole:'support'})),
      ...(metrics.length?[slot('evidence-rail',ids(metrics),80,bottom-railHeight,1760,railHeight,{components:'bare',scale:.8},'row',metrics.length,28)]:[]),
    ],220))
    if(steps.length>=4&&!metrics.length){
      const cells=[...steps,...stepNotes],rows=Math.ceil(cells.length/3),h=(height-32*(rows-1))/rows,w=(1760-64)/3
      result.push({...make('journey',cells.map((b,i)=>slot(`step-grid-${i+1}`,[b.id],80+(i%3)*(w+32),top+Math.floor(i/3)*(h+32),w,h,{primitiveFirst:true,components:stepNotes.includes(b)?'bare':i===0?'accent':'panel',typographyRole:stepNotes.includes(b)?'support':undefined,markerScale:1.6})),230),id:'composition/journey-grid',label:'Шаги · крупная сетка'})
    }
  }
  if(prose.length===2&&metrics.length<=1&&prose.length+metrics.length===body.length){
    const railHeight=metrics.length?300:0,bodyHeight=height-(railHeight?railHeight+32:0)
    result.push(make('comparison',[
      slot('first-side',[prose[0].id],80,top,860,bodyHeight,{components:'panel',primitiveFirst:prose.some(b=>b.kind==='list'),scale:1.2,align:'center'}),
      slot('second-side',[prose[1].id],980,top,860,bodyHeight,{components:'accent',primitiveFirst:prose.some(b=>b.kind==='list'),align:'center',maxHeadingRatio:2,typeScale:1.2}),
      ...(metrics.length?[slot('shared-metric',ids(metrics),80,bottom-railHeight,1760,railHeight,{components:'bare',scale:.8})]:[]),
    ],205))
  }
  const story=body.filter(b=>!metrics.includes(b))
  if(story.length>=2&&story.length<=3&&metrics.length>=1&&metrics.length<=3&&story.every(b=>narrative(b)||b.kind==='step')){
    const firstHeight=Math.floor((height-28)*.5/4)*4,lowerY=top+firstHeight+28
    result.push(make('evidence',[
      slot('lead-story',[story[0].id],80,top,1080,firstHeight,{components:'accent',align:'center'}),
      slot('supporting-story',ids(story.slice(1)),80,lowerY,1080,bottom-lowerY,{components:'panel'},'row',2,28),
      slot('evidence',ids(metrics),1200,top,640,height,{components:'panel',scale:1},'column',1,28),
    ],200))
  }
  if(metrics.length>=2&&metrics.length<=3&&prose.length<=1&&metrics.length+prose.length===body.length){
    const cards=[...metrics,...prose],rows=Math.ceil(cards.length/2),h=(height-32*(rows-1))/rows
    result.push(make('metric-grid',cards.map((b,i)=>slot(`metric-card-${i+1}`,[b.id],80+(i%2)*896,top+Math.floor(i/2)*(h+32),864,h,{primitiveFirst:true,align:'center',components:i===cards.length-1&&prose.includes(b)?'accent':'bare',typographyRole:prose.includes(b)?'support':undefined})),270))
  }
  if(metrics.length===1&&prose.length<=1&&metrics.length+prose.length===body.length){
    result.push(make('metric-focus',[
      slot('main-number',[metrics[0].id],80,top,1000,height,{primitiveFirst:true,align:'center'}),
      ...prose.map(b=>slot('meaning',[b.id],1160,top,680,height,{primitiveFirst:true,components:'accent',typographyRole:'support',align:'center'})),
    ],260))
    if(prose.length)result.push({...make('metric-focus',[
      slot('main-number',[metrics[0].id],80,top,1760,height*.60,{primitiveFirst:true,align:'center'}),
      slot('meaning',[prose[0].id],80,top+height*.60+32,1760,height*.40-32,{primitiveFirst:true,typographyRole:'support'}),
    ],250),id:'composition/metric-focus-wide',label:'Показатель · широкая строка'})
  }
  const facts=body.filter(b=>b.kind==='text'&&Object.keys(b.fields).length===1&&b.fields.text.length<100&&/\d/.test(b.fields.text))
  const multi=body.find(b=>['text','list'].includes(b.kind)&&Object.keys(b.fields).length===1&&(b.fields.text??b.fields.body??'').split('\n').filter(Boolean).length>=4&&(b.fields.text??b.fields.body??'').split('\n').filter(Boolean).every(line=>line.length<100&&/\d/.test(line)))
  if((facts.length>=4&&facts.length<=8&&body.length-facts.length<=1)||(multi&&body.length<=2)){
    const cards=multi?[multi]:facts,extra=body.filter(b=>!cards.includes(b)),gridHeight=height-(extra.length?164:0)
    result.unshift(make('fact-grid',[
      slot('facts',ids(cards),80,top,1760,gridHeight,{primitiveFirst:true,repeatColumns:multi?2:undefined,factLayout:multi?'inline':'stacked',typographyRole:'support'},multi?'column':'wrap',!multi&&cards.length===6?3:2,48),
      ...extra.map(b=>slot('conclusion',[b.id],80,top+gridHeight+36,1760,128,{primitiveFirst:true,typographyRole:'support'})),
    ],280))
    const grid=result[0]
    result.unshift({...grid,id:'composition/fact-rows',recipeId:'composition/fact-rows',label:'Факты · строки с разделителями',slots:grid.slots.map(s=>s.region==='facts'?{...s,columns:2,presentation:{...s.presentation,factLayout:'inline'}}:s)})
  }
  return result
}

/** Quantization collapses near-identical coordinate variants. Source IDs and
 * two-pixel adjustments cannot count as a new composition. */
export function compositionSignature(c:Candidate){
  return JSON.stringify([c.backgroundId,c.canvasFillId,c.slots.map(s=>({blocks:s.blocks,box:[s.rect.x,s.rect.y,s.rect.w,s.rect.h].map(n=>Math.round(n/64)),direction:s.direction,columns:s.columns,treatment:s.presentation?.components??'any',density:s.presentation?.density,factLayout:s.presentation?.factLayout,contentTreatment:s.presentation?.contentTreatment,...s.presentation?.align?{align:s.presentation.align}:{}})).sort((a,b)=>a.blocks[0].localeCompare(b.blocks[0])),c.authored?.primitives,c.decorations])
}
