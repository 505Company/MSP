import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {incomingCandidates,incomingPacks,resolvePackFlow,adaptIncomingTables,fitIncomingCandidate} from '../lib/presentations/studio/recipe-packs'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {normalizeText} from '../lib/presentations/studio/material'
import {projectContent,createProject,updateProject} from '../lib/workspace/storage'
import {memoryBucket} from './helpers/memory-bucket'
import {measuredStudioFixture,studioText} from './fixtures/studio'
import {compactPackets} from '../lib/presentations/studio/compact-content'
import {reflowStudioRun,studioKey} from '../lib/presentations/studio/storage'
import type {ContentSlide} from '../lib/presentations/studio/contract'

test('all 51 supplied frames remain byte-identical; structural alias has no extra selection weight',async()=>{
  const expected=['066493bc8c1dea0691673545853706dcdb2c8055222c239a1b599db2a6ebba50','8269e36aef04226b8814e87f65b9bb8c09dbc3d3e024555cd73bd53a47cc076b']
  for(const [i,pack] of incomingPacks.entries()){
    const bytes=await readFile(`lib/presentations/studio/authored/incoming/${pack.bundle.id}.recipe.ts`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected[i]);assert.deepEqual(pack.RECIPE_DEFINITION_ISSUES,[])
  }
  assert.deepEqual(incomingPacks.map(p=>p.states.length),[19,32]);assert.equal(incomingPacks.reduce((n,p)=>n+p.canonicalStates.length,0),50)
})
test('new-only scope preserves every source field and refuses old/mixed recipe fallback',()=>{
  const slide=normalizeText('# Новый рынок\n\nСамостоятельные поездки становятся привычкой.\n\nИсточник: 2026')[0],before=JSON.stringify(slide)
  const candidates=candidatesFor(slide,'new');assert.ok(candidates.length)
  for(const c of candidates){assert.match(c.recipeId,/^39:(514|798)\//);assert.ok(c.authored)
    assert.deepEqual(c.slots.flatMap(s=>s.blocks).sort(),slide.blocks.map(b=>b.id).sort())
    for(const b of slide.blocks){const fields:string[]=[];const walk=(n:typeof c.authored.primitives[string])=>{if(n.field)fields.push(n.field);n.children?.forEach(walk)};walk(c.authored.primitives[b.id]);assert.deepEqual(fields.sort(),Object.keys(b.fields).sort())}
    for(const [i,a] of c.slots.entries())for(const b of c.slots.slice(i+1))assert.ok(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)<=Math.max(a.rect.x,b.rect.x)+1||Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)<=Math.max(a.rect.y,b.rect.y)+1)
  }
  assert.equal(JSON.stringify(slide),before)
})
test('table rows and columns adapt inside unchanged outer recipe geometry',()=>{
  const make=(rows:number,cols:number):ContentSlide=>{const columns=Array.from({length:cols},(_,i)=>`Столбец ${i+1}`),values={columns,rows:Array.from({length:rows},(_,i)=>columns.map((_,j)=>`${i+1}:${j+1}`))};return {id:'slide-1',title:'Данные',directions:[],blocks:[{id:'b1',kind:'text',role:'title',fields:{text:'Данные'},source:'Данные'},{id:'b2',kind:'visual',role:'body',fields:{},source:JSON.stringify(values),data:{template:{id:'table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:1200,height:600,data:values,style:{font:'Play'},config:{},graphicHtml:{},dataStatus:'native'},values}}]}}
  const pack=incomingPacks[1],before=JSON.stringify(pack.bundle)
  for(const [rows,cols] of [[4,4],[5,4],[5,3],[8,6]]){
    const slide=make(rows,cols),adapted=adaptIncomingTables(pack.bundle,slide)
    const candidate=incomingCandidates(slide).find(c=>c.recipeId.includes('data-approach-table'))
    assert.ok(candidate,`${rows} × ${cols}`);assert.equal(candidate.authored?.tablePolicy,'adaptive-table-1')
    assert.deepEqual(adapted.states,pack.bundle.states);assert.deepEqual(adapted.families,pack.bundle.families)
    assert.deepEqual(pack.validateRecipeDefinition(adapted),[])
    const original=incomingCandidates(make(4,4)).find(c=>c.recipeId===candidate.recipeId)!
    assert.deepEqual(candidate.slots,original.slots)
  }
  assert.equal(JSON.stringify(pack.bundle),before)
})
test('pruned authored flow keeps real parent geometry and bound region sizes',()=>{
  const pack=incomingPacks[0],state=pack.states.find(s=>s.id==='chapter-cover-01')!
  const present=pack.resolvePresentState(state,state.regions.filter(r=>r.minItems>0).map(r=>r.id))
  const flow=resolvePackFlow(present)
  for(const r of present.regions){const box=flow.regions[r.id];assert.ok(box);assert.ok(box.w>=r.size.width.min-.1&&box.w<=r.size.width.max+.1);assert.ok(box.h>=r.size.height.min-.1&&box.h<=r.size.height.max+.1)}
})
test('measured region growth consumes only authored reserve and retains the selected topology',()=>{
  const slide:ContentSlide={id:'slide-1',title:'План',directions:[],blocks:[{id:'title',role:'title',kind:'text',source:'План',fields:{text:'План'}},...[1,2,3,4].map(i=>({id:`b${i}`,role:'body' as const,kind:'step' as const,source:`${i}\nЭтап\nТекст`,fields:{marker:String(i),heading:'Этап',body:'Текст'}})),{id:'note',role:'footer',kind:'text',source:'Вывод',fields:{text:'Вывод'}}]}
  const c=incomingCandidates(slide).find(c=>c.id==='39:798/instructions-eight-theses/topology-0')!,before=JSON.stringify(c)
  assert.ok(c)
  const fitted=fitIncomingCandidate(c,{title:{height:144},note:{height:52}});assert.ok(fitted)
  assert.equal(fitted.id,c.id);assert.deepEqual(fitted.slots.map(s=>s.blocks),c.slots.map(s=>s.blocks))
  assert.ok(fitted.slots.find(s=>s.blocks.includes('title'))!.rect.h>=144)
  assert.ok(fitted.slots.find(s=>s.blocks.includes('note'))!.rect.h>=52)
  assert.equal(fitIncomingCandidate(c,{title:{height:300}}),null);assert.equal(JSON.stringify(c),before)
})
test('compatible field shapes can use a recipe cell without its exact semantic type label',()=>{
  const content:ContentSlide={id:'s',title:'Результат',directions:[],blocks:[
    {id:'title',kind:'text',role:'title',source:'Результат',fields:{text:'Результат'}},
    {id:'fact',kind:'metric',role:'body',source:'67%\nпланируют сами',fields:{value:'67%',caption:'планируют сами'}},
    {id:'note',kind:'text',role:'footer',source:'Вывод',fields:{text:'Вывод'}},
  ]}
  const asFeature:ContentSlide={...content,blocks:content.blocks.map(b=>b.id==='fact'?{...b,kind:'feature',fields:{heading:'67%',body:'планируют сами'}}:b)}
  // This two-field cell already renders a feature as heading + body. Its name
  // must not prevent using the same shape for a value + explanation.
  const match=incomingCandidates(content).find(c=>c.recipeId==='39:798/instructions-six-faq')
  assert.ok(match,'a metric must be admitted as heading + explanation without inventing fields')
  const control=incomingCandidates(asFeature).find(c=>c.id===match.id)!
  assert.deepEqual(match.slots,control.slots);assert.deepEqual(match.authored?.regions,control.authored?.regions)
  const fields:string[]=[];const walk=(n:import('../lib/presentations/studio/recipes').PrimitiveNode)=>{if(n.field)fields.push(n.field);n.children?.forEach(walk)}
  walk(match.authored!.primitives.fact);assert.deepEqual(fields.sort(),['caption','value'])
  const impossible=structuredClone(content);impossible.blocks[1].fields.unknown='Нельзя потерять это поле'
  assert.ok(!incomingCandidates(impossible).some(c=>c.recipeId===match.recipeId))
  const tooMany={...content,blocks:[content.blocks[0],...Array.from({length:40},(_,i)=>({...content.blocks[1],id:`fact-${i}`})),content.blocks[2]]}
  assert.equal(incomingCandidates(tooMany).length,0,'existing item capacities remain enforced')
})
test('native table can use an existing data visual frame without changing its outside geometry',()=>{
  const values={columns:['Сегмент','Доля'],rows:[['Пары','24%']]}
  const slide:ContentSlide={id:'s',title:'Рынок',directions:[],blocks:[
    {id:'t',role:'title',kind:'text',source:'Рынок',fields:{text:'Рынок'}},
    {id:'lead',role:'body',kind:'text',source:'Описание',fields:{text:'Описание'}},
    ...[1,2].map(i=>({id:`m${i}`,role:'body' as const,kind:'metric' as const,source:'24%\nПары',fields:{value:'24%',caption:'Пары'}})),
    {id:'data',role:'body',kind:'visual',source:JSON.stringify(values),fields:{},data:{template:{id:'native-table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:600,height:500,style:{font:'Play'},config:{},graphicHtml:{},data:values,dataStatus:'native'},values}},
  ]}
  const before=JSON.stringify(slide),candidates=incomingCandidates(slide),table=candidates.find(c=>c.recipeId==='39:798/media-case-result')!
  assert.ok(table);assert.ok(table.authored?.adaptations?.some(a=>a.includes('таблица')))
  const chart=structuredClone(slide);chart.blocks[4].data!.template.kind='chart'
  const control=incomingCandidates(chart).find(c=>c.id===table.id)!
  assert.deepEqual(table.slots,control.slots);assert.deepEqual(table.authored?.regions,control.authored?.regions)
  assert.equal(JSON.stringify(slide),before)
})
test('explicit recipe retry refreshes failed candidates locally and preserves successful slides and model history',async()=>{
  const run=measuredStudioFixture(),{bucket}=memoryBucket()
  run.semantic={source:studioText,status:'complete',strategy:'recipes',units:compactPackets(studioText).map(packet=>({id:packet.id,packet,status:'complete',attempts:1}))}
  run.status='blocked';run.error='Предыдущее измерение';run.modelRequests=2;run.modelRunIds=['retained-model-1','retained-model-2']
  const first=run.slides[0],second=run.slides[1]
  first.candidates=[];first.error='Старая совместимость';delete first.options;delete first.plan
  run.results[second.content.id]=second.options![0].receipt!
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Проверка',text:studioText,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${project.id}.json`,JSON.stringify(project));await bucket.put(studioKey(project.id,project.revision),JSON.stringify(run))
  const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No remote calls during local reflow')}
  try{
    const next=await reflowStudioRun(bucket,run.projectId,run.revision)
    assert.ok(next.slides[0].candidates.length);assert.equal(next.slides[0].error,undefined)
    assert.deepEqual(next.slides[0].content,first.content);assert.deepEqual(next.slides[1],JSON.parse(JSON.stringify(second)))
    assert.deepEqual(next.results,run.results);assert.deepEqual(next.semantic,run.semantic)
    assert.deepEqual(next.modelRunIds,run.modelRunIds);assert.equal(next.modelRequests,2)
    assert.equal(next.status,'preparing')
  }finally{globalThis.fetch=fetch}
})
test('recipe filter persists through project creation, autosave, legacy absence and idempotency',async()=>{
  const {bucket}=memoryBucket(),style={id:crypto.randomUUID(),name:'Стиль',fileName:'style.pptx',sourceId:'x',createdAt:new Date().toISOString(),slideCount:1,componentCount:1,styleCount:1,previewId:null,colors:[],fonts:[]}
  const input={id:crypto.randomUUID(),name:'Проверка',text:'Текст',uploadId:style.id,generationMode:'smart',compositionMode:'recipes',recipeScope:'new'}
  const p=await createProject(bucket,input,style);assert.equal(p.recipeScope,'new');assert.equal((await createProject(bucket,input,style)).revision,p.revision)
  await assert.rejects(()=>createProject(bucket,{...input,recipeScope:'all'},style))
  const updated=await updateProject(bucket,p.id,{baseRevision:p.revision,name:p.name,text:p.text,generationMode:'fast',compositionMode:'recipes',recipeScope:'all'})
  assert.equal(updated.recipeScope,'all');assert.equal(projectContent.parse({name:'Старый',text:'Текст'}).recipeScope,undefined)
})
