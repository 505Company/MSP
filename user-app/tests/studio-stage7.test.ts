import {test} from 'node:test'
import assert from 'node:assert/strict'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {incomingCandidates,executablePacks,fitIncomingCandidate} from '../lib/presentations/studio/recipe-packs'
import {bindTextContract,fieldsPreserved} from '../lib/presentations/studio/field-bindings'
import {tableVariants,mirrorCandidate,respectsPlacement} from '../lib/presentations/studio/recipe-variants'
import {searchAssignments} from '../lib/presentations/studio/assignment-search'
import {STUDIO_VERSION,type ContentSlide,type StudioRun} from '../lib/presentations/studio/contract'
import {reflowStudioRun,studioKey,validateReceipt} from '../lib/presentations/studio/storage'
import {textBlock,metricBlock,stage7Table,stage7Compound} from './fixtures/studio-stage7'
import {measuredStudioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {optionSignature} from '../lib/presentations/studio/options'

test('legacy and incoming recipes offer different allocations of the same content',()=>{
  const slide:ContentSlide={id:'s',title:'Тест',directions:[],blocks:[textBlock('title','Тест','title'),textBlock('short','Коротко'),textBlock('long','Подробное объяснение. '.repeat(30)),textBlock('note','Вывод','footer')]}
  for(const recipe of ['19:209/intro-03','39:514/seven-theses-01']){
    const c=candidatesFor(slide).filter(c=>c.recipeId===recipe&&!c.mirrored)
    assert.ok(new Set(c.map(v=>JSON.stringify(v.slots.map(s=>[s.region,s.blocks])))).size>=2,recipe)
    for(const v of c)assert.deepEqual(v.slots.flatMap(s=>s.blocks).sort(),slide.blocks.map(b=>b.id).sort())
  }
})
test('a rejected complete assignment does not hide later valid distributions; search is bounded',()=>{
  const entries=[textBlock('a','Большой текст'),textBlock('b','Короткий')].map(block=>({block,choices:['small','wide'].map((region,i)=>({region,value:region,cost:i}))}))
  const regions=['small','wide'].map(id=>({id,min:1,max:1,valid:(n:number)=>n===1}))
  const found=searchAssignments(entries,regions,a=>a.get('a')==='wide')
  assert.equal(found.length,1);assert.equal(found[0].get('a'),'wide');assert.equal(found[0].get('b'),'small')
  assert.ok(searchAssignments(Array.from({length:25},(_,i)=>({...entries[0],block:textBlock(`b${i}`,'Текст')})),regions).length===0)
})
test('nested explanation and three items bind exact source ranges, never invented markers or truncated lists',()=>{
  const content=stage7Compound(),block=content.blocks[1],contract=executablePacks[1].bundle.contracts.approach,before=JSON.stringify(content)
  const binding=bindTextContract(block,contract)!
  assert.ok(binding);assert.equal((binding.fields.items as unknown[]).length,3)
  assert.equal(binding.paths['items.2.text'].field,'body')
  const parts=Object.values(binding.paths).map(p=>({...p,value:p.sourceRange?block.fields[p.field].slice(p.sourceRange.start,p.sourceRange.end):block.fields[p.field]}))
  assert.equal(fieldsPreserved(block,parts),true);assert.equal(fieldsPreserved(block,parts.slice(0,-1)),false);assert.equal(fieldsPreserved(block,[...parts,parts[2]]),false)
  assert.equal(bindTextContract({...block,fields:{...block.fields,body:block.fields.body+'\n- Четвёртый пункт'}},contract),null)
  assert.equal(bindTextContract({...block,fields:{...block.fields,body:'- Только пункты\n- Без пояснения'}},contract),null)
  assert.ok(incomingCandidates(content).some(c=>c.recipeId==='39:798/display-two-approaches'&&c.authored?.fieldBindings?.[block.id]['items.2.text']))
  assert.equal(JSON.stringify(content),before)
})
test('table combinations retain wide data regions and keep original recipes separately',()=>{
  const base=[textBlock('title','Аудитория','title'),stage7Table()],kpi=metricBlock('metric','76%','Планируют поездку сами')
  const combinations=[base,[...base,textBlock('explanation','Пояснение к таблице')],[...base,kpi,metricBlock('metric-2','38 млн','Путешественники')],[...base,kpi,textBlock('outcome','Итог без потери фактов','footer')]]
  for(const blocks of combinations)for(const scope of ['new','all'] as const){
    const slide:ContentSlide={id:'s',title:'Аудитория',directions:[],blocks},c=candidatesFor(slide,scope).filter(c=>c.authored?.variant?.kind==='table-content')
    assert.ok(c.length)
    assert.ok(c.some(c=>c.slots.find(s=>s.blocks.includes('data'))!.rect.w===1828))
    for(const candidate of c)assert.deepEqual(candidate.slots.flatMap(s=>s.blocks).sort(),blocks.map(b=>b.id).sort())
  }
  for(const {pack,bundle} of executablePacks){
    // Source coverage is a one-frame/one-state rule of the immutable export.
    // Host derivations deliberately refer to those same frames, and validate
    // all other field, hierarchy, geometry and family rules unchanged.
    assert.deepEqual(pack.validateRecipeDefinition(bundle).filter(s=>s!=='source-frame-coverage'),[])
    for(const state of pack.states)assert.deepEqual(bundle.states.find(s=>s.id===state.id),state)
    for(const state of bundle.states.filter(s=>tableVariants[s.id]))assert.equal(state.sourceFrame,pack.states.find(s=>s.id===tableVariants[state.id].baseStateId)!.sourceFrame)
  }
})
test('mirror keeps dimensions and restores geometry after two reflections; unilateral placement cannot vanish',()=>{
  const slide:ContentSlide={id:'s',title:'График',directions:[],blocks:[textBlock('t','График','title'),{...stage7Table(),placement:'left'},metricBlock('k','76%','Показатель')]}
  const original=incomingCandidates(slide).find(c=>c.authored?.variant?.kind==='data-sidebar')!,mirror=mirrorCandidate(original)
  assert.ok(respectsPlacement(original,slide));assert.equal(respectsPlacement(mirror,slide),false)
  assert.deepEqual(mirrorCandidate(mirror).slots,original.slots)
  for(const [i,s] of mirror.slots.entries()){assert.equal(s.rect.w,original.slots[i].rect.w);assert.equal(s.rect.h,original.slots[i].rect.h);assert.equal(s.rect.x,1920-original.slots[i].rect.x-s.rect.w)}
  const right={...slide,blocks:slide.blocks.map(b=>b.id==='data'?{...b,placement:'right' as const}:b)}
  assert.ok(candidatesFor(right,'new').some(c=>c.mirrored))
  const fitted=fitIncomingCandidate(mirror,{t:{height:170}})
  if(fitted)assert.ok(fitted.mirrored&&respectsPlacement(fitted,right))
})
test('a full-width explanation above a table and three right-hand KPIs has a compatible recipe',()=>{
  const slide:ContentSlide={id:'s',title:'Факторы выбора',directions:[],blocks:[
    {...textBlock('title','Факторы выбора','title'),placement:'top'},
    {...textBlock('intro','Пояснение перед таблицей и показателями'),placement:'top'},
    {...stage7Table(),placement:'left'},
    ...[1,2,3].map(i=>({...metricBlock(`k${i}`,`${i*10}%`,'Показатель'),placement:'right' as const})),
  ]}
  const candidates=candidatesFor(slide,'new');assert.ok(candidates.length)
  for(const candidate of candidates)assert.ok(respectsPlacement(candidate,slide))
  assert.ok(candidates.some(c=>c.authored?.variant?.kind==='data-sidebar'))
})
test('old recipe retry upgrades explicitly, preserving successes, source, and model history',async()=>{
  const run=measuredStudioFixture(),{bucket}=memoryBucket()
  run.status='blocked';run.results[run.slides[1].content.id]=run.slides[1].options![0].receipt!
  const old={...run,version:'studio-recipes-7'},key=studioKey(run.projectId,run.revision)
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision,uploadId:run.library.uploadId}))
  await bucket.put(key,JSON.stringify(old))
  const next=await reflowStudioRun(bucket,run.projectId,run.revision)
  assert.equal(next.version,STUDIO_VERSION);assert.deepEqual(next.results,run.results);assert.deepEqual(next.slides[1],JSON.parse(JSON.stringify(run.slides[1])))
  assert.deepEqual(next.slides[0].content,run.slides[0].content);assert.deepEqual(next.modelRunIds,run.modelRunIds);assert.equal(next.modelRequests,run.modelRequests)
})
test('server accepts exact slices and rejects repeated or omitted source ranges',()=>{
  const run=measuredStudioFixture(),work=run.slides[0],receipt=structuredClone(work.options![0].receipt!),first=receipt.text[0],mid=Math.floor(first.value.length/2)
  receipt.text.splice(0,1,{...first,value:first.value.slice(0,mid),sourceRange:{start:0,end:mid}},{...first,value:first.value.slice(mid),sourceRange:{start:mid,end:first.value.length}})
  assert.ok(validateReceipt(run as StudioRun,receipt,true))
  const repeated=structuredClone(receipt);repeated.text.push(receipt.text[0]);assert.throws(()=>validateReceipt(run,repeated,true),/повтор/)
  const omitted=structuredClone(receipt);omitted.text.shift();assert.throws(()=>validateReceipt(run,omitted,true),/Потеря/)
})

test('unused primitive variants and requested densities cannot count as different measured DS designs',()=>{
  const content:ContentSlide={id:'s',title:'Тест',directions:[],blocks:[textBlock('title','Тест','title'),stage7Table(),metricBlock('metric','76%','Поездки')]},candidate=incomingCandidates(content).find(c=>c.authored?.variant?.kind==='data-sidebar')!,other=structuredClone(candidate),library=measuredStudioFixture().library
  other.authored!.primitives.metric={direction:'column',gap:88,children:[{field:'value'},{field:'caption'}]}
  for(const slot of other.slots)slot.presentation={...slot.presentation,density:'compact'}
  const components={metric:'rendered-ds-metric'}
  assert.equal(optionSignature(candidate,library,components,{metric:'vertical'}),optionSignature(other,library,components,{metric:'vertical'}))
  assert.notEqual(optionSignature(candidate,library,components,{metric:'vertical'}),optionSignature(other,library,components,{metric:'compact'}))
})
