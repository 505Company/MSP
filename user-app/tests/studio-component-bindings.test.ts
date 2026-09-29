import test from 'node:test'
import assert from 'node:assert/strict'
import {labTemplate} from '../component-lab/fixtures'
import {sourceCandidate} from '../lib/component-lab/source'
import {componentBindings} from '../lib/presentations/studio/bindings'
import {studioFixture} from './fixtures/studio'
import type {PreparedBox} from '../lib/presentations/prepared-components'

test('a semantic step binds to the library ordinal and caption without losing or duplicating fields',async()=>{
 const {library}=studioFixture(),source=await sourceCandidate(labTemplate('numbered'),'fixture')
 const profile={...source.profile!,family:'ordinal-caption' as const,fields:source.profile!.fields.filter(f=>f.role!=='title')}
 library.editable=[];library.prepared={step:{profile} as PreparedBox}
 const block={id:'step',role:'body' as const,kind:'step' as const,source:'02\nСравнить варианты',fields:{marker:'02',heading:'Сравнить варианты'}}
 const matches=componentBindings(block,library)
 assert.equal(matches.length,1)
 assert.deepEqual(matches[0].fields,Object.fromEntries(profile.fields.map(f=>[f.id,f.role==='ordinal'?'marker':'heading'])))
 assert.deepEqual(componentBindings({...block,fields:{...block.fields,body:'Дополнительное содержание'}},library),[],'no supplied field may be discarded')
 assert.deepEqual(componentBindings({...block,fields:{marker:'Заголовок',heading:'Текст'}},library),[],'an ordinal still requires a number')
})
