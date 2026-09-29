import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compositionCatalog,compositionsFor} from '../lib/presentations/studio/compositions'
import {normalizeText} from '../lib/presentations/studio/material'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {draftOptions,fastOption} from '../lib/presentations/studio/options'
import {studioSurface} from '../lib/presentations/studio/theme'
import {studioFixture} from './fixtures/studio'
import {recipeExamples} from './fixtures/studio-recipe-examples'
import {oneDayText} from './fixtures/studio-one-day'

test('semantic recipes preserve every block once, stay in frame, and retire the rejected layouts',()=>{
  assert.equal(new Set(compositionCatalog.map(c=>c.id)).size,compositionCatalog.length)
  for(const example of recipeExamples){
    const content=normalizeText(example.text)[0],c=candidatesFor(content).find(c=>c.id===example.recipe)!
    assert.ok(c,example.recipe)
    assert.deepEqual(c.slots.flatMap(s=>s.blocks).sort(),content.blocks.map(b=>b.id).sort())
    for(const [i,a] of c.slots.entries()){
      assert.ok(a.rect.w>0&&a.rect.h>0&&a.rect.x>=0&&a.rect.y>=0&&a.rect.x+a.rect.w<=1920&&a.rect.y+a.rect.h<=1080)
      for(const b of c.slots.slice(i+1))assert.ok(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)<=Math.max(a.rect.x,b.rect.x)||Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)<=Math.max(a.rect.y,b.rect.y),'overlapping regions')
    }
    assert.ok(!candidatesFor(content).some(c=>['composition/editorial','composition/column'].includes(c.id)))
  }
})

test('recipe eligibility is driven by content, and unpunctuated journey steps keep their original numbers',()=>{
  const journey=normalizeText(recipeExamples[3].text)[0]
  assert.deepEqual(journey.blocks.filter(b=>b.kind==='step').map(b=>b.fields.marker),['01','02','03','04','05'])
  assert.equal(journey.blocks.at(-1)!.fields.text.split('\n').length,3)
  assert.ok(!compositionsFor(normalizeText('# Пустой заголовок')[0]).length)
  assert.ok(!compositionsFor(normalizeText('# Содержание\n\nОдин абзац')[0]).some(c=>c.id==='composition/metrics'))
  const plain=normalizeText(oneDayText)[0]
  assert.deepEqual(compositionsFor(plain).filter(c=>!c.id.endsWith('evidence')).map(c=>c.id),['composition/mosaic','composition/spotlight','composition/ribbon'])
})

test('automatic deck filling varies compatible recipes and keeps the approved mosaic first',()=>{
  const run=studioFixture('fast',oneDayText),s=run.slides[0]
  s.options=draftOptions(s,run.library).slice(0,3).map(o=>({...o,receipt:{passed:true} as never}))
  const used:string[]=[]
  for(let i=0;i<3;i++)used.push(fastOption(s,used).plan.candidateId)
  assert.deepEqual(used,['composition/mosaic','composition/spotlight','composition/ribbon'])
})

test('primitive surfaces are sourced from the active palette, never VK literals',()=>{
  const {library}=studioFixture();library.tokens.colors=[{hex:'#FFF8ED',occurrences:1},{hex:'#742C18',occurrences:1},{hex:'#BB5339',occurrences:1},{hex:'#F1D9C7',occurrences:1}];library.rules=['Основной цвет #BB5339']
  assert.deepEqual(studioSurface(library,'accent'),{background:'#BB5339',ink:'#FFF8ED'})
  assert.equal(studioSurface(library,'panel').background,'#F1D9C7')
})
