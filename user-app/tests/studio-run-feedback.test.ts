import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compactPackets} from '../lib/presentations/studio/compact-content'
import {displayStudioError,needsStudioReparse,studioSlideFeedback} from '../lib/presentations/studio/run-feedback'
import {studioFixture} from './fixtures/studio'

test('a shared provider failure is displayed once while distinct slide errors retain their numbers',()=>{
  const unavailable='DeepInfra сейчас недоступен. Запрос модели не отправлен.'
  assert.equal(displayStudioError(Array.from({length:6},(_,i)=>`${i+1}: ${unavailable}`).join('\n')),unavailable)
  assert.equal(displayStudioError('1: Ошибка таблицы\n2: Ошибка графика'),'1: Ошибка таблицы\n2: Ошибка графика')
})

test('failed semantic slides retain their positions even without render work',()=>{
  const run=studioFixture('smart'),source='# Первый\nТекст.\n---\n# Второй\nТекст.\n---\n# Третий\nТекст.'
  const packets=compactPackets(source),work=run.slides[0]
  run.semantic={source,status:'pending',units:packets.map((packet,i)=>({id:packet.id,packet,status:i===1?'failed':'complete',attempts:1,...i===1?{error:'unknown-or-duplicate-fragment:f2'}:{}}))}
  run.slides=[0,2].map(i=>({...work,content:{...work.content,id:packets[i].id,title:packets[i].atoms[0].text}}))
  const feedback=studioSlideFeedback(run)
  assert.deepEqual(feedback.map(s=>[s.id,s.title]),[['slide-1','Первый'],['slide-2','Второй'],['slide-3','Третий']])
  assert.equal(feedback[1].work,undefined)
  assert.equal(displayStudioError(feedback[1].error!),'Модель пропустила или повторила часть содержания. Слайд не собран.')
  assert.equal(needsStudioReparse(run),false)
})

test('changed parser requests explicit regeneration without changing frozen packets or successful runs',()=>{
  const run=studioFixture('smart'),source='Слайд 1\nТаблица\nИмя\tЗначение\nА\t42',packet=compactPackets(source)[0]
  run.semantic={source,status:'pending',units:[{id:packet.id,packet:{...packet,tables:[]},status:'failed',attempts:2}]}
  const before=JSON.stringify(run)
  assert.equal(needsStudioReparse(run),true)
  assert.equal(JSON.stringify(run),before)
  run.status='complete'
  assert.equal(needsStudioReparse(run),false)
  assert.equal(displayStudioError('[{"validation":"regex","code":"invalid_string"}]'),'Модель вернула неверные ссылки на блоки. Слайд не собран.')
  assert.equal(displayStudioError('Недостаточно места'),'Недостаточно места')
})
