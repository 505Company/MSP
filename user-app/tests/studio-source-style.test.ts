import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sourceStyleFixture} from './fixtures/studio-source-style'
import {studioTheme,studioSurface} from '../lib/presentations/studio/theme'
import {accentPalette} from '../lib/presentations/studio/brand-accents'
import {contrast} from '../lib/presentations/studio/color-zones'
import {fastContent} from '../lib/presentations/studio/fast-content'
import {contentBackground} from '../lib/presentations/studio/visual-design'
import {candidatesFor} from '../lib/presentations/studio/recipes'


test('the observed slide fill wins over the lightest or most frequent palette color',()=>{
  const library=sourceStyleFixture(),theme=studioTheme(library)
  assert.equal(theme.background,'#000000')
  assert.equal(theme.ink,'#FFFFFF')
  assert.ok(contrast(studioSurface(library,'panel').background,studioSurface(library,'panel').ink)>=4.5)
  assert.ok(contrast(studioSurface(library,'panel').background,theme.background)>=1.6)
  assert.ok(contrast(studioSurface(library,'accent').background,studioSurface(library,'accent').ink)>=3)
  // Source fill is evidence even when the raw palette doesn't contain it.
  library.tokens.colors=library.tokens.colors.filter(c=>c.hex!=='#000000')
  assert.equal(studioTheme(library).background,'#000000')
})

test('minor chart-series colors do not replace the dominant brand accent',()=>{
  const library=sourceStyleFixture()
  const colors=accentPalette(library,'#000000')
  assert.ok(colors.includes('#0077FF'))
  assert.ok(!colors.includes('#EB4250'))
})

test('content uses observed artwork only when the measured ink leaves it free',()=>{
  const library=sourceStyleFixture()
  assert.ok(contentBackground(library,[{x:40,y:40,w:1000,h:500}]))
  assert.equal(contentBackground(library,[{x:0,y:0,w:1920,h:1080}]),undefined)
})

test('diagram arrows and unnamed interior rules never become free-standing background ornaments',()=>{
  const library=sourceStyleFixture(),art=library.backgrounds!.artworks[0]
  const before=structuredClone(library.backgrounds)
  assert.ok(contentBackground(library,[]))
  assert.deepEqual(library.backgrounds,before)
  art.name='Линия таймлайна'
  assert.equal(contentBackground(library,[]),undefined)
  art.name='Google Shape 123'
  art.placements[0].bounds={x:0,y:300,width:750,height:8}
  assert.equal(contentBackground(library,[]),undefined)
  // The same proportions at the edge may be a legitimate brand ribbon.
  art.placements[0].bounds.y=0
  assert.ok(contentBackground(library,[]))
})

test('recipe separators reserve more space than text around legitimate source art',()=>{
  const library=sourceStyleFixture(),rule={x:1400,y:60,w:3,h:960}
  assert.ok(contentBackground(library,[rule]))
  assert.equal(contentBackground(library,[],[],undefined,[rule]),undefined)
  assert.ok(contentBackground(library,[],[],undefined,[{...rule,x:1320}]))
})

test('standalone consecutive ordinals are short steps, not five unrelated metrics',()=>{
  const library=sourceStyleFixture()
  const [slide]=fastContent('# Маршрут\n01\nНайти направление\n02\nСравнить варианты\n03\nСобрать маршрут\n04\nЗабронировать поездку\n05\nПолучать подсказки уже на месте\n\nВсе этапы связаны между собой.',library)
  assert.equal(slide.blocks.filter(b=>b.kind==='metric').length,0)
  assert.deepEqual(slide.blocks.filter(b=>b.kind==='step').map(b=>b.fields.marker),['01','02','03','04','05'])
  assert.equal(slide.blocks.at(-1)?.fields.text,'Все этапы связаны между собой.')
  const candidates=candidatesFor(slide)
  assert.ok(candidates.some(c=>c.id==='composition/journey'))
  assert.ok(!candidates.some(c=>c.id==='composition/journey/mirror'))
})

test('a before/after comparison preserves both text groups and their reading order',()=>{
  const [slide]=fastContent('# Раньше\nСначала направление\nПотом билеты\nПотом гостиница\nСейчас\nВсё планируется вместе.\nПользователь видит весь маршрут.',sourceStyleFixture())
  assert.equal(slide.blocks.length,3)
  assert.equal(slide.blocks[1].fields.text,'Сначала направление\nПотом билеты\nПотом гостиница')
  assert.equal(slide.blocks[1].placement,'left')
  assert.deepEqual(slide.blocks[2].fields,{heading:'Сейчас',body:'Всё планируется вместе.\nПользователь видит весь маршрут.'})
  assert.equal(slide.blocks[2].placement,'right')
})
