import test from 'node:test'
import assert from 'node:assert/strict'
import {artDirectedCandidates} from '../lib/presentations/studio/art-direction'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {normalizeText} from '../lib/presentations/studio/material'
import {studioFixture} from './fixtures/studio'
import {fastOption} from '../lib/presentations/studio/options'
import {compositionSignature} from '../lib/presentations/studio/compositions'
import type {DesignOption} from '../lib/presentations/studio/contract'

test('directions change the headline region and preserve every bound block without overlapping',()=>{
 const content=normalizeText('# Что делает продукт удобным\n\nПонятный маршрут\n\nПрозрачная цена\n\nХорошая навигация\n\nБыстрое бронирование\n\nАктуальная информация\n\nПоддержка в поездке')[0],library=studioFixture().library
 const candidates=artDirectedCandidates(content,candidatesFor(content),library),fast=candidates.find(c=>c.id==='composition/list-grid')!
 assert.ok(fast)
 for(const direction of ['balanced','creative']){
  const c=candidates.find(c=>c.recipeId===fast.recipeId&&c.artDirection===direction)!
  assert.ok(c);assert.notEqual(compositionSignature(c),compositionSignature(fast))
  assert.deepEqual(c.slots.flatMap(s=>s.blocks).sort(),content.blocks.map(b=>b.id).sort())
  for(const [i,a] of c.slots.entries())for(const b of c.slots.slice(i+1))assert.ok(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)<=Math.max(a.rect.x,b.rect.x)||Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)<=Math.max(a.rect.y,b.rect.y),c.id)
 }
})
test('an equally readable mode direction is selected instead of the shared plain layout',()=>{
 const work=studioFixture().slides[0],base=work.candidates[0],direction={...base,id:base.id+'/poster',artDirection:'creative' as const}
 const option=(id:string,score:number)=>({id,label:id,signature:id,plan:{candidateId:id,components:{},primary:[],rationale:''},receipt:{slideId:work.content.id,candidateId:id,passed:true,preview:'',html:'',blockIds:[],issues:[],warnings:[],elapsedMs:0,components:[],text:[],quality:{score,reasons:[]}}} as DesignOption)
 const varied={...work,candidates:[base,direction],variation:{mode:'creative' as const,seed:'generation',sourceKey:'brief'},options:[option(base.id,100),option(direction.id,96)]}
 assert.equal(fastOption(varied).id,direction.id)
 varied.options[1].receipt!.quality!.score=68
 assert.equal(fastOption(varied).id,base.id,'a direction never overrides a substantially more readable result')
})
