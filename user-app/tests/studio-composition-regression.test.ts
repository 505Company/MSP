import {test} from 'node:test'
import assert from 'node:assert/strict'
import {oneDayText} from './fixtures/studio-one-day'
import {normalizeText} from '../lib/presentations/studio/material'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {studioTheme,studioFonts} from '../lib/presentations/studio/theme'
import {studioFixture} from './fixtures/studio'
import {componentBindings} from '../lib/presentations/studio/bindings'

test('plain-text brief reaches design as a hero metric, three points and a takeaway, not one generic card',()=>{
  const slides=normalizeText(oneDayText)
  assert.equal(slides.length,1)
  const s=slides[0]
  assert.equal(s.blocks.length,6,'Expected title, hero metric, three separate feature blocks and takeaway')
  assert.equal(s.blocks[0].fields.text,oneDayText.split('\n')[0].replace(/^9\. /,''))
  const metric=s.blocks.find(b=>b.kind==='metric')!
  assert.equal(metric.fields.value,'+1 день')
  assert.deepEqual(s.blocks.filter(b=>b.kind==='feature').map(b=>b.fields.heading),['Единая навигация','Персональные рекомендации','Гибкое бронирование'])
  assert.equal(s.blocks.at(-1)?.role,'footer')
  assert.ok(!s.blocks.some(b=>Object.values(b.fields).some(v=>/Слева огромно|Справа три пункта|минималистичный слайд|Внизу:/.test(v))))
  const candidates=candidatesFor(s)
  assert.ok(candidates.some(c=>c.recipeId!=='flex-mix'),'A designed recipe must be available before Qwen makes its choice')
  const first=candidates[0],hero=first.slots.find(slot=>slot.blocks.includes(metric.id))!
  const features=s.blocks.filter(b=>b.kind==='feature')
  assert.ok(features.every(b=>first.slots.find(slot=>slot.blocks.includes(b.id))!.rect.x>hero.rect.x),'The selected recipe must preserve the explicit left/right hierarchy')
  assert.ok(first.recipeId.startsWith('composition/'));assert.ok(first.sources?.includes('33:223/fact-explanations-01'))
  for(const candidate of candidates){
    assert.deepEqual(candidate.slots.flatMap(s=>s.blocks).sort(),s.blocks.map(b=>b.id).sort())
    const left=candidate.slots.find(slot=>slot.blocks.includes(metric.id))!
    assert.ok(features.every(b=>candidate.slots.find(slot=>slot.blocks.includes(b.id))!.rect.x>=left.rect.x+left.rect.w))
  }
})

test('layout markers work with Markdown too; ordinary prose beginning with a direction is retained',()=>{
  const original=normalizeText(oneDayText)[0],markdown=normalizeText(oneDayText.split('\n').map(l=>`**${l}**`).join('\n\n'))[0]
  assert.deepEqual(markdown.blocks,original.blocks)
  const prose=normalizeText('# Экскурсия\nСлева находится музей, справа начинается парк.')[0]
  assert.equal(prose.blocks[1].fields.text,'Слева находится музей, справа начинается парк.')
  assert.equal(prose.directions.length,0)
})

test('chart label frequency cannot replace the library display font; declared brand color beats the first chart series',()=>{
  const {library}=studioFixture()
  library.tokens.fonts.push({family:'Arial',sizes:[12,18,24],occurrences:9000})
  library.tokens.colors.unshift({hex:'#3782BA',occurrences:3000})
  library.rules=['Фирменный цвет — #00805E.']
  const theme=studioTheme(library)
  assert.equal(theme.font,'Play');assert.equal(theme.accent,'#00805E')
  assert.equal(studioFonts(library)[0].family,'Play')
  assert.equal(theme.title%4,0);assert.ok(theme.title>theme.body)
  library.tokens.fonts=[{family:'A Different Display Font',sizes:[32,72],occurrences:1}]
  library.tokens.colors=[{hex:'#FCFAF8',occurrences:1},{hex:'#4A2918',occurrences:2},{hex:'#AB4632',occurrences:3}]
  library.rules=['Primary brand color #AB4632']
  const other=studioTheme(library)
  assert.equal(other.font,'A Different Display Font');assert.equal(other.accent,'#AB4632')
  assert.notEqual(other.background,theme.background)
})

test('an ordinal stored as title is not offered to Qwen as an ordinary heading',()=>{
  const {library}=studioFixture(),block=normalizeText(oneDayText)[0].blocks[2]
  const template={id:'numbered-step',name:'Этап',description:'Номер в круге и пояснение',tags:['этап'],kind:'feature' as const,sourceIds:['ordinal','body'],memberIds:[],style:{font:'Play'},config:{},data:{title:'1',text:'Пояснение'},dataStatus:'native' as const,slide:1,width:260,height:180,graphicHtml:{},adaptation:{version:'component-intent-1' as const,family:'ordinal-caption' as const,fields:[{sourceId:'ordinal',part:'whole' as const,role:'ordinal' as const},{sourceId:'body',part:'whole' as const,role:'body' as const}],layouts:[{state:'vertical' as const,textAlign:'source' as const,position:'top' as const}],rationale:'Номер в круге'}}
  library.editable=[template]
  assert.deepEqual(componentBindings(block,library),[])
  library.editable=[{...template,id:'plain-heading',adaptation:{...template.adaptation,family:'title-body',fields:[{sourceId:'ordinal',part:'whole',role:'title'},{sourceId:'body',part:'whole',role:'body'}]}}]
  assert.equal(componentBindings(block,library)[0]?.id,'plain-heading')
})
