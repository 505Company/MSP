import test from 'node:test'
import assert from 'node:assert/strict'
import {structuredCompositions,structuredPattern} from '../lib/presentations/studio/structured-compositions'
import {fieldsPreserved,structuredPrimitive} from '../lib/presentations/studio/field-bindings'
import {withMirrors} from '../lib/presentations/studio/recipe-variants'
import type {ContentBlock,ContentSlide} from '../lib/presentations/studio/contract'
import type {PrimitiveNode} from '../lib/presentations/studio/recipes'
const block=(id:string,fields:Record<string,string>,role:ContentBlock['role']='body'):ContentBlock=>({id,kind:fields.heading?'feature':'text',role,fields,source:Object.values(fields).join('\n')})
const title=block('title',{text:'Проект без потери связей'},'title')
const slide=(blocks:ContentBlock[]):ContentSlide=>({id:'slide-1',title:title.source,blocks:[title,...blocks],directions:[]})
const leaves=(n:PrimitiveNode):PrimitiveNode[]=>n.field?[n]:(n.children??[]).flatMap(leaves)

test('colon sections retain their heading, exact field spans and left-to-right sequence',()=>{
 const content=slide([block('a',{heading:'Подготовка:',body:'выбрать команду'}),block('b',{heading:'оценить сроки',body:'распределить роли'}),block('c',{heading:'Выполнение:',body:'провести встречу'}),block('d',{text:'проверить результат'})])
 const candidates=structuredCompositions(content),recipe=candidates.find(c=>c.recipeId==='composition/section-columns')!
 assert.deepEqual(recipe.slots.map(s=>s.blocks),[['title'],['a','b'],['c','d']])
 assert.equal(withMirrors([recipe],content).length,1)
 for(const b of content.blocks.slice(1)){
  const fields=leaves(structuredPrimitive(b,'section',1)).map(n=>({field:n.field!,sourceRange:n.sourceRange,value:n.sourceRange?b.fields[n.field!].slice(n.sourceRange.start,n.sourceRange.end):b.fields[n.field!]}))
  assert.ok(fieldsPreserved(b,fields))
 }
})
test('alternating names and numeric details are paired, rather than presented as independent facts',()=>{
 const content=slide([block('a',{text:'Исследование'}),block('b',{text:'От 2 до 4 дней'}),block('c',{text:'Разработка'}),block('d',{text:'От 7 до 14 дней'}),block('e',{text:'Проверка'}),block('f',{text:'Менее 24 часов'})])
 assert.equal(structuredPattern(content)?.kind,'pairs')
 for(const c of structuredCompositions(content)){
  assert.deepEqual(c.slots.flatMap(s=>s.blocks).sort(),content.blocks.map(b=>b.id).sort())
  for(const [i,a] of c.slots.entries())for(const b of c.slots.slice(i+1))assert.ok(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)<=Math.max(a.rect.x,b.rect.x)||Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)<=Math.max(a.rect.y,b.rect.y))
 }
})
test('full sentences are prose, while short list items keep a separate concluding paragraph',()=>{
 const content=slide([block('a',{text:'Объяснение, которое должно остаться абзацем.'}),...['Запрос','Решение','Проверка'].map((text,i)=>block('p'+i,{text})),block('end',{text:'Общий вывод относится ко всему списку.'})])
 const pattern=structuredPattern(content);assert.equal(pattern?.kind,'list')
 if(pattern?.kind!=='list')throw Error('missing list')
 assert.deepEqual(pattern.items.map(b=>b.id),['p0','p1','p2'])
 for(const c of structuredCompositions(content))assert.deepEqual(c.slots.find(s=>s.region==='takeaway')?.blocks,['end'])
})
