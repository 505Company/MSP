import {test} from 'node:test'
import assert from 'node:assert/strict'
import {strictComponentFixture} from './fixtures/studio-components'
import {studioTextInstance} from '../browser/studio-text'

test('colored native text panels retain internal whitespace without changing the library',()=>{
 const {library}=strictComponentFixture(),source=library.editable[0],before=structuredClone(source)
 const b={id:'b1',kind:'text' as const,role:'title' as const,fields:{text:'Проверка внутренних отступов'},source:'Проверка внутренних отступов'}
 const {template}=studioTextInstance(source,{id:source.id,kind:'editable',fields:{title:'text'}},b,900,400,0)
 const bounds=template.sourceLayout!.text[0].element.bounds
 assert.ok(bounds.x>=24&&bounds.y>=24);assert.ok(bounds.x+bounds.width<=876);assert.deepEqual(source,before)
})
