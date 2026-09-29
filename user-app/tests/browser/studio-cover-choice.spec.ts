import {test,expect} from '@playwright/test'
import {studioFixture} from '../fixtures/studio'
import {sourceStyleFixture} from '../fixtures/studio-source-style'

test('an awkward source-cover arrangement cannot hide a readable sibling behind generic recipes',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
 await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
 await page.route('**/api/uploads/*/assets/image',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=','base64')}))
 await page.goto('/processing-worker')
 const work=studioFixture('fast','# Путешествия становятся частью повседневного ритма\n\nКороткие поездки открывают новые направления.').slides[0]
 const result=await page.evaluate(async({work,library})=>{
  const paths={render:'/browser/studio-generation.ts',visual:'/lib/presentations/studio/visual-design.ts',options:'/lib/presentations/studio/options.ts',variation:'/lib/presentations/studio/variation.ts'}
  const {renderStudioOptions,renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation')
  const {libraryCoverCandidates}=await import(paths.visual) as typeof import('../../lib/presentations/studio/visual-design')
  const {draftOptions,fastOption}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
  const {orderedCandidates}=await import(paths.variation) as typeof import('../../lib/presentations/studio/variation')
  const base=libraryCoverCandidates(work.content,library)[0]
  const weak={...base,id:base.id+'/awkward',slots:base.slots.map((s,i)=>i?s:{...s,rect:{...s.rect,w:330,h:880}})}
  // Keep the narrow headline away from the supporting paragraph.
  weak.slots[1]={...weak.slots[1],rect:{x:430,y:600,w:870,h:320}}
  const next={...work,candidates:[weak,base,...work.candidates],variation:{mode:'fast' as const,seed:'0',sourceKey:'cover'}}
  for(let i=0;i<100&&orderedCandidates(next)[0].id!==weak.id;i++)next.variation.seed=String(i)
  const draft=draftOptions(next,library).find(o=>o.plan.candidateId===weak.id)!
  const first=await renderStudioSlide(library,{...next,candidates:[weak],plan:draft.plan})
  const options=await renderStudioOptions(library,next,undefined,{limit:1})
  return {firstScore:first.quality!.score,firstId:orderedCandidates(next)[0].id,weakId:weak.id,selected:fastOption({...next,options}).plan.candidateId,expected:base.id}
 },{work,library:sourceStyleFixture()})
 expect(result.firstId).toBe(result.weakId)
 expect(result.firstScore).toBeLessThan(94)
 expect(result.selected).toBe(result.expected)
})
