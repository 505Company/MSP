import {test,expect} from './workspace-fixture'
import {groupedReplies} from '../fixtures/studio-content-groups'
import {studioFixture} from '../fixtures/studio'
import {validateCompact} from '../../lib/presentations/studio/compact-content'
import {candidatesFor} from '../../lib/presentations/studio/recipes'
import {draftOptions} from '../../lib/presentations/studio/options'
import {receiptPreservesFields} from '../../lib/presentations/studio/field-bindings'
import {minimumReadableSize} from '../../lib/presentations/studio/readability'

test('sixteen model splits and a mirror render whole source groups without dropping words or overlap',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const library=studioFixture().library,{packet,replies}=groupedReplies()
 for(const [index,reply] of [...replies,replies[15]].entries()){
  const {content}=validateCompact(reply,packet),candidates=candidatesFor(content).filter(c=>c.id===`composition/source-groups-4${index===16?'/mirror':''}`),work={content,candidates,bindings:{}}
  expect(candidates).toHaveLength(1)
  const receipt=await page.evaluate(async({library,work})=>{
   const path='/browser/studio-generation.ts'
   return (await import(path) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,work)
  },{library,work:{...work,plan:draftOptions(work,library)[0].plan}})
  expect(receipt.passed,`split ${index}: ${receipt.issues.join('; ')}`).toBe(true)
  for(const b of content.blocks){expect(receiptPreservesFields(b,receipt.text)).toBe(true);expect(receipt.text.filter(t=>t.blockId===b.id).every(t=>t.size>=minimumReadableSize(b,t.field))).toBe(true)}
  const body=content.blocks.filter(b=>b.role==='body')
  for(const a of body)for(const b of body)if(a.sourceGroup!.id===b.sourceGroup!.id)expect(receipt.layout![a.id].x).toBeCloseTo(receipt.layout![b.id].x,0)
  const ordered=[...body].sort((a,b)=>a.sourceGroup!.order-b.sourceGroup!.order)
  expect(receipt.layout![ordered[0].id].x<receipt.layout![ordered.at(-1)!.id].x).toBe(index!==16)
 }
})
