import {test,expect} from './workspace-fixture'
import {strictComponentFixture} from '../fixtures/studio-components'
import {componentFlexTask} from '../../lib/presentations/studio/component-flex'
import {compactPackets} from '../../lib/presentations/studio/compact-content'
import {validateReceipt,commitStudioOptions,studioKey} from '../../lib/presentations/studio/storage'
import {memoryBucket} from '../helpers/memory-bucket'
import {labUnitMetric} from '../../component-lab/fixtures'
import {sourceCandidate} from '../../lib/component-lab/source'
import {LAB_VERSION} from '../../lib/component-lab/contract'
import {generationSummary} from '../../lib/presentations/studio/generations'

test('component-only renderer retains native text styles, fills every block and forbids primitive substitution',async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {run,library,packet,reply}=strictComponentFixture(),{work}=componentFlexTask(packet,library).validate(reply)
  const result=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts',renderer=await import(path) as typeof import('../../browser/studio-generation');const ok=await renderer.renderStudioSlide(library,work);const wrong=structuredClone(work);wrong.plan!.components.b2='missing';return {ok,bad:await renderer.renderStudioSlide(library,wrong)}},{library,work})
  expect(result.ok.passed,result.ok.issues.join('; ')).toBe(true)
  expect(result.ok.components.map(c=>c.componentId)).toEqual(['native-title','native-text'])
  expect(result.ok.html).toContain('data-native-layout');expect(result.ok.html).toContain('#265fc1')
  const pixels=await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return [[8,80],[80,8],[80,120]].map(([x,y])=>[...c.getImageData(x,y,1,1).data])},result.ok.preview)
  expect(pixels.slice(0,2),'exported component background must retain both slide margins').toEqual([[255,255,255,255],[255,255,255,255]])
  expect(pixels[2]).toEqual([38,95,193,255])
  expect(result.ok.text[0].size).toBeGreaterThanOrEqual(40);expect(result.ok.text[1].size).toBeGreaterThanOrEqual(24)
  expect(result.bad.passed).toBe(false);expect(result.bad.components).toHaveLength(1)
  run.slides=[work];expect(()=>validateReceipt(run,result.ok,true)).not.toThrow()
  const substituted=structuredClone(result.ok);substituted.components.pop();expect(()=>validateReceipt(run,substituted,true)).toThrow(/режиме компонентов/)
  const enlarged=structuredClone(result.ok);enlarged.components[0].height*=1.5;expect(()=>validateReceipt(run,enlarged,true)).toThrow(/измеренной областью/)
  const tiny=structuredClone(result.ok);tiny.text[1].size=12;expect(()=>validateReceipt(run,tiny,true)).toThrow(/читаемого/)
})

test('an undersized component returns independently measured feasible sizes for Qwen repair',async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library,packet,reply}=strictComponentFixture(),{work}=componentFlexTask(packet,library).validate(reply),source=await sourceCandidate(labUnitMetric(),'fixture')
  const issues=await page.evaluate(async({library,work,profile,version})=>{
    const paths={r:'/browser/studio-generation.ts',f:'/browser/component-lab/fonts.ts'}
    const resources=await (await import(paths.f) as typeof import('../../browser/component-lab/fonts')).sourceFonts(library.uploadId,profile,true)
    library.prepared['test-metric']={version,profile,faces:resources.faces??[],assets:resources.artwork?.assets??[],fidelity:{status:'preserved'}} as typeof library.prepared[string]
    const b=work.content.blocks[1];b.kind='metric';b.fields={value:'67%',caption:'Путешественники сравнивают несколько направлений'};b.source=Object.values(b.fields).join('\n')
    work.bindings.b2=[{id:'test-metric',kind:'prepared',fields:Object.fromEntries(profile.fields.map(f=>[f.id,f.role==='number'?'value':'caption']))}];work.plan!.components.b2='test-metric';work.candidates[0].slots.forEach(s=>{s.rect.w=150})
    return (await (await import(paths.r) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,work)).issues
  },{library,work,profile:source.profile!,version:`preparation-1:${source.profile!.version}:${LAB_VERSION}`})
  expect(issues.join('\n')).toMatch(/Размер блока b2.*Измеренные подходящие размеры: [\d]+×[\d]+/)
})

for(const strategy of ['components','recipes'] as const)test(`the product repairs failed ${strategy} stages independently and reopens without another request`,async({page})=>{
  const {run,library,packet,reply}=strictComponentFixture(),{bucket}=memoryBucket()
  if(strategy==='components')packet.atoms[0].text=Array(8).fill(packet.atoms[0].text).join(' ')
  const source=packet.atoms.map(a=>a.text).join('\n')
  Object.assign(packet,compactPackets(source)[0])
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Компоненты',text:source,uploadId:library.uploadId,styleName:library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart',compositionMode:strategy,modelRoute:'akashml-fp8'}
  run.slides=[];run.status='planning';run.semantic={source,status:'pending',strategy,units:[{id:packet.id,packet,status:'pending',attempts:0}]}
  let current=run,calls=0
  const save=()=>bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(current))
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await save()
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.route('**/api/style-bank',r=>r.fulfill({json:{styles:[]}}));await page.route(`**/api/projects/${run.projectId}`,r=>r.fulfill({json:{project}}))
  await page.route(`**/api/projects/${run.projectId}/generations`,r=>r.fulfill({json:{generations:[generationSummary(current)]}}))
  await page.route(`**/api/projects/${run.projectId}/compose*`,async r=>{
    if(r.request().method()==='POST'){
      const body=r.request().postDataJSON(),unit=current.semantic!.units![0]
      if(body.action==='structure'){
        calls++;unit.attempts=calls;current.modelRequests=calls
        if(calls===1){unit.status='failed';unit.error='Ответ модели не завершён.';current.status='blocked';current.error=unit.error}
        else{const next=structuredClone(reply);if(strategy==='components'&&calls===2)next.nodes[2].weight=13;const result=componentFlexTask(packet,library).validate(next);unit.status='complete';unit.proof=result.proof;delete unit.error;delete current.error;current.slides=[result.work];current.status='preparing';current.semantic!.status='complete'}
        await save()
      }
      if(body.action==='fail'){current.slides[0].error=body.receipt.error;current.status='blocked';await save()}
      if(body.action==='options')current=await commitStudioOptions(bucket,run.projectId,run.revision,body.receipt)
    }
    await r.fulfill({json:{run:current,configured:true}})
  })
  await page.goto(`/projects/${project.id}?generate=1`)
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(1);await expect(page.locator('[data-generation-busy=true]')).toHaveCount(0)
  expect(calls).toBe(2);expect(current.status).toBe('complete')
  await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(1);expect(calls).toBe(2)
})
