import {test} from 'node:test'
import assert from 'node:assert/strict'
import {zoneRect,contrast,COLOR_ZONE_VERSION} from '../lib/presentations/studio/color-zones'
import {accentPalette,canApplyBrandAccents,sparsePanelRect,BRAND_ACCENTS_VERSION} from '../lib/presentations/studio/brand-accents'
import {studioFixture,measuredStudioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {applyStudioOption,refreshStudioColors,studioKey,readStudioAppearanceSources} from '../lib/presentations/studio/storage'
import {contentHash} from '../lib/design-system/catalog'

test('text accents prefer vivid readable library hues and preserve authored covers',()=>{
  const {library,slides}=studioFixture()
  library.tokens.colors=['#3782BA','#0077FF','#000000','#FFFFFF','#FF3885','#FFE59C','#C3A3E2','#7CEDF8','#FFBD92'].map(hex=>({hex,occurrences:1}))
  assert.deepEqual(accentPalette(library),['#FF3885','#0077FF'])
  for(const c of accentPalette(library))assert.ok(contrast(c,'#FFFFFF')>=3)
  assert.equal(canApplyBrandAccents(slides[0].content),false)
  assert.equal(canApplyBrandAccents(slides[1].content,{backgroundId:'native-cover'}),false)
  assert.equal(canApplyBrandAccents({...slides[1].content,id:'slide-3'}),true)
  assert.deepEqual(accentPalette(library,'#FFFFFF',4.5),[])
  assert.equal(contrast('#FFFFFF','#000000'),21)
})

test('a background belongs only to a spacious block and cannot intersect neighbouring data or text',()=>{
  const region={x:48,y:48,w:888,h:756},title={x:48,y:48,w:870,h:154},right={x:984,y:48,w:888,h:756}
  const panel=sparsePanelRect(region,[title],[right,{x:48,y:852,w:1824,h:180}])
  assert.ok(panel);assert.ok(panel.emptyRatio>.7);assert.deepEqual(panel.rect,{x:24,y:24,w:936,h:804})
  assert.equal(sparsePanelRect(region,[{...title,h:540}],[right]),undefined)
  assert.equal(sparsePanelRect(region,[title],[{x:600,y:500,w:500,h:300}]),undefined)
  assert.equal(sparsePanelRect({x:48,y:48,w:1824,h:200},[title],[]),undefined)
})

test('color refresh preserves all measured content, selection, model use and a recoverable original',async()=>{
  const run=measuredStudioFixture('fast'),{bucket}=memoryBucket()
  run.slides.forEach(s=>applyStudioOption(run,s.content.id,s.options![0].id))
  const key=studioKey(run.projectId,run.revision)
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision}))
  await bucket.put(key,JSON.stringify(run))
  const work=run.slides[1],saved=work.options!.map(o=>o.receipt!),basis=await contentHash(saved)
  const receipts=saved.map(r=>({...r,preview:'data:image/png;base64,bmV3',html:r.html+'<div></div>',colorZone:{version:COLOR_ZONE_VERSION,axis:'vertical' as const,fraction:.5 as const,side:'end' as const,color:'#00805E',rect:zoneRect('vertical',.5,'end'),minContrast:5}}))
  await assert.rejects(()=>refreshStudioColors(bucket,run.projectId,run.revision,{slideId:work.content.id,basis,receipts:receipts.map(r=>({...r,text:r.text.map(t=>({...t,x:t.x+1}))}))}),/геометрию/)
  await assert.rejects(()=>refreshStudioColors(bucket,run.projectId,run.revision,{slideId:work.content.id,basis,receipts:receipts.map(r=>({...r,colorZone:{...r.colorZone,color:'#123456'}}))}),/палитре/)
  const done=await refreshStudioColors(bucket,run.projectId,run.revision,{slideId:work.content.id,basis,receipts})
  assert.equal(done.modelRequests,run.modelRequests);assert.equal(done.results[work.content.id].optionId,run.results[work.content.id].optionId)
  assert.deepEqual(done.results[work.content.id].text,run.results[work.content.id].text)
  assert.deepEqual(await (await bucket.get(key.replace('/run.json',`/before-${COLOR_ZONE_VERSION}.json`)))!.json(),JSON.parse(JSON.stringify(run)))
  await assert.rejects(()=>refreshStudioColors(bucket,run.projectId,run.revision,{slideId:work.content.id,basis,receipts}),/другой вкладке/)
})


test('legacy bands restore the exact source option without reverting the current selection',async()=>{
  const run=measuredStudioFixture('fast'),{bucket}=memoryBucket()
  run.slides.forEach(s=>applyStudioOption(run,s.content.id,s.options![0].id))
  const key=studioKey(run.projectId,run.revision),work=run.slides[1]
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision}))
  await bucket.put(key.replace('/run.json',`/before-${COLOR_ZONE_VERSION}.json`),JSON.stringify(run))
  const pristine=structuredClone(run),originals=work.options!.map(o=>o.receipt!)
  for(const r of originals){r.html+='<div data-studio-color-zone></div>';r.colorZone={version:COLOR_ZONE_VERSION,axis:'vertical',fraction:.5,side:'end',color:'#00805E',rect:zoneRect('vertical',.5,'end'),minContrast:5}}
  if(work.options!.length>1)applyStudioOption(run,work.content.id,work.options![1].id)
  await bucket.put(key,JSON.stringify(run))
  const sources=await readStudioAppearanceSources(bucket,run.projectId,run.revision)
  assert.deepEqual(sources[work.content.id],pristine.slides[1].options!.map(o=>o.receipt!))
  const receipts=sources[work.content.id].map(r=>({...r,brandAccents:{version:BRAND_ACCENTS_VERSION,colors:['#00805E']}}))
  const done=await refreshStudioColors(bucket,run.projectId,run.revision,{slideId:work.content.id,basis:await contentHash(originals),receipts})
  assert.equal(done.results[work.content.id].optionId,run.results[work.content.id].optionId)
  assert.equal(done.results[work.content.id].colorZone,undefined)
  assert.equal(done.modelRequests,run.modelRequests)
  assert.deepEqual(await (await bucket.get(key.replace('/run.json',`/before-${BRAND_ACCENTS_VERSION}.json`)))!.json(),JSON.parse(JSON.stringify(run)))
  originals[0].text[0].value='changed content';await bucket.put(key,JSON.stringify(run))
  await assert.rejects(()=>readStudioAppearanceSources(bucket,run.projectId,run.revision),/исходный вариант/)
})
