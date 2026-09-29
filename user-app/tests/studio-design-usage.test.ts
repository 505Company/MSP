import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compactPackets,validateCompact} from '../lib/presentations/studio/compact-content'
import {fastContentReply} from '../lib/presentations/studio/fast-content'
import {libraryCoverCandidates,backgroundDesigns} from '../lib/presentations/studio/visual-design'
import {buildBackgroundCatalog} from '../lib/design-system/backgrounds'
import {backgroundFixture} from './fixtures/backgrounds'
import {studioFixture} from './fixtures/studio'
import {strictComponentFixture} from './fixtures/studio-components'
import {componentFlexTask,flexCandidate} from '../lib/presentations/studio/component-flex'
import {fitMeasuredFlex} from '../lib/presentations/studio/flex-fit'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {respectsPlacement} from '../lib/presentations/studio/recipe-variants'
import type {ContentSlide} from '../lib/presentations/studio/contract'

test('three metrics on one side and a conclusion below all metrics retain a compatible composition',()=>{
 const slide:ContentSlide={id:'slide-6',title:'Сезонность',directions:[],blocks:[
  {id:'b1',kind:'text',role:'title',source:'Сезонность',fields:{text:'Сезонность'}},
  ...['+23%','9 из 12 месяцев','−17 п.п.'].map((value,i)=>({id:`b${i+2}`,kind:'metric' as const,role:'body' as const,placement:'right' as const,source:value+'\nПояснение',fields:{value,caption:'Пояснение'}})),
  {id:'b5',kind:'text',role:'footer',placement:'bottom',source:'Вывод после показателей',fields:{text:'Вывод после показателей'}},
 ]}
 const before=JSON.stringify(slide),candidates=candidatesFor(slide)
 assert.ok(candidates.length,'a bottom conclusion must not exclude every layout with right-hand metrics')
 assert.ok(candidates.every(c=>respectsPlacement(c,slide)));assert.equal(JSON.stringify(slide),before)
})

test('fast mode preserves multiline title, TSV values, metric fields and requested chart without a model',()=>{
 const packets=compactPackets('Слайд 1\nСамостоятельные поездки растут,\nа привычки меняются\nСегмент\tДоля\nСемьи\t24%\nПары\t31%\n67% ищут несколько направлений\n\nСлайд 2\nСпрос по месяцам\nСлева — линейный график «Спрос»:\nМесяц\t2024\t2026\nЯнварь\t12\t19\nФевраль\t15\t21')
 const results=packets.map(p=>validateCompact(fastContentReply(p),p))
 assert.equal(results.length,2);assert.equal(results[0].content.title,'Самостоятельные поездки растут,\nа привычки меняются')
 assert.deepEqual(results[0].content.blocks.find(b=>b.kind==='metric')?.fields,{value:'67%',caption:'ищут несколько направлений'})
 assert.deepEqual(Object.values(results[0].materials)[0].data.rows,[['Семьи','24%'],['Пары','31%']])
 assert.equal(Object.values(results[1].materials)[0].config.chartType,'line');assert.equal(results[1].content.blocks.at(-1)?.placement,'left')
})
test('library covers keep the observed artwork and allocate all text outside it',()=>{
 const run=studioFixture('fast','# Путешествия\n\nПонятный сервис\n\nИсточник: 2026'),f=backgroundFixture()
 run.library.backgrounds=buildBackgroundCatalog(f.snapshot,f.library,'test')
 const before=structuredClone(run.library.backgrounds),designs=backgroundDesigns(run.library),covers=libraryCoverCandidates(run.slides[0].content,run.library)
 assert.ok(covers.length);assert.equal(covers[0].backgroundId,designs[0].id)
 for(const slot of covers[0].slots){assert.ok(slot.rect.x>=48);assert.ok(slot.rect.x+slot.rect.w<=1392);assert.ok(slot.rect.y+slot.rect.h<=1032)}
 assert.deepEqual(run.library.backgrounds,before)
})
test('creative block ordering does not reject a valid title placed last in the response',()=>{
 const {packet,library,reply}=strictComponentFixture(),normal=componentFlexTask(packet,library).validate(reply).work
 const reversed={...reply,blocks:[reply.blocks[1],reply.blocks[0]],nodes:reply.nodes.map(n=>({...n,block:n.block==='b1'?'b2':n.block==='b2'?'b1':n.block}))}
 const result=componentFlexTask(packet,library).validate(reversed).work
 assert.deepEqual(result.content,normal.content);assert.deepEqual(result.flexNodes,normal.flexNodes);assert.equal(result.candidates[0].recipeId,'component-flex')
})
test('creative measured flow may use more than thirty percent while preserving siblings and margins',()=>{
 const {packet,library,reply}=strictComponentFixture(),work=componentFlexTask(packet,library).validate(reply).work
 const c=flexCandidate(work.flexNodes!,work.content.blocks),fit=fitMeasuredFlex(work.flexNodes!,c,{b1:{height:500},b2:{height:100}},true)!
 assert.ok(fit);assert.equal(fit.slots[0].rect.h,500);assert.equal(fit.slots[0].rect.y,48)
 assert.equal(fit.slots[1].rect.y,580);assert.ok(Math.abs(fit.slots[1].rect.y+fit.slots[1].rect.h-1032)<.1)
})
