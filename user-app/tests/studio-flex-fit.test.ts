import {test} from 'node:test'
import assert from 'node:assert/strict'
import {flexCandidate,type FlexNode} from '../lib/presentations/studio/component-flex'
import {fitMeasuredFlex} from '../lib/presentations/studio/flex-fit'
import type {ContentBlock} from '../lib/presentations/studio/contract'

test('measured flex redistributes space within thirty percent without changing the model tree',()=>{
  const nodes:FlexNode[]=[{id:'n1',parent:'',direction:'column',block:'',weight:1,gap:24},...[1,2,3].map(i=>({id:`n${i+1}`,parent:'n1',direction:'leaf' as const,block:`b${i}`,weight:1,gap:0}))]
  const blocks:ContentBlock[]=[1,2,3].map(i=>({id:`b${i}`,kind:'text',role:'body',fields:{text:'Текст'},source:'Текст'}))
  const original=flexCandidate(nodes,blocks),before=structuredClone(original),fitted=fitMeasuredFlex(nodes,original,{b1:{height:380},b2:{height:260},b3:{height:250}})!
  assert.ok(fitted);assert.deepEqual(original,before);assert.equal(fitted.slots[0].rect.h,380)
  for(const [i,slot]of fitted.slots.entries()){assert.deepEqual(slot.blocks,original.slots[i].blocks);assert.ok(slot.rect.h>=original.slots[i].rect.h*.7-.01&&slot.rect.h<=original.slots[i].rect.h*1.3+.01);if(i)assert.ok(slot.rect.y>=fitted.slots[i-1].rect.y+fitted.slots[i-1].rect.h+23.99)}
  assert.ok(Math.abs(fitted.slots.at(-1)!.rect.y+fitted.slots.at(-1)!.rect.h-1032)<.01)
  assert.equal(fitMeasuredFlex(nodes,original,{b1:{height:500}}),undefined)
  assert.equal(fitMeasuredFlex(nodes,original,{b1:{height:380},b2:{height:380},b3:{height:380}}),undefined)
})
