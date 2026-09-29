import {test} from 'node:test'
import assert from 'node:assert/strict'
import {componentFlexTask,flexCandidate} from '../lib/presentations/studio/component-flex'
import {draftOptions} from '../lib/presentations/studio/options'
import {strictComponentFixture} from './fixtures/studio-components'

test('a saved numeric block index resolves to the same leaf without bypassing content validation',()=>{
  const {library,packet,reply}=strictComponentFixture(),spec=componentFlexTask(packet,library)
  const legacy={...reply,nodes:reply.nodes.map(n=>({...n,block:n.block.replace(/^b/,'')}))}
  assert.deepEqual(spec.validate(legacy),spec.validate(reply))
  const duplicate=structuredClone(legacy);duplicate.blocks[1].fields[0].ids=['f1']
  assert.throws(()=>spec.validate(duplicate),/Смысловой разбор/)
  const foreign=structuredClone(legacy);foreign.nodes[2].block='81'
  assert.throws(()=>spec.validate(foreign))
})

test('the provider grammar enforces actual node and block identifiers',()=>{
  const {library,packet}=strictComponentFixture()
  const schema=componentFlexTask(packet,library).task.schema as {properties:{nodes:{items:{properties:Record<string,{enum:string[]}>}}}}
  const properties=schema.properties.nodes.items.properties
  assert.deepEqual(properties.block.enum,['','b1','b2'])
  assert.ok(properties.id.enum.includes('n1'));assert.ok(!properties.id.enum.includes('1'))
  assert.ok(properties.parent.enum.includes(''))
})

test('component-only Qwen plan binds every immutable fragment to an actual component and its flex leaf',()=>{
  const {library,packet,reply}=strictComponentFixture(),spec=componentFlexTask(packet,library),{work}=spec.validate(reply)
  assert.equal(work.strictComponents,true);assert.equal(work.candidates.length,1)
  assert.deepEqual(work.plan?.components,{b1:'native-title',b2:'native-text'})
  assert.deepEqual(draftOptions(work,library)[0].plan.components,work.plan?.components)
  assert.equal(work.content.blocks[1].fields.text,packet.atoms[1].text)
  const [a,b]=work.candidates[0].slots;assert.ok(a.rect.y+a.rect.h<=b.rect.y)
  const wrong=structuredClone(reply);wrong.blocks[1].component='invented';assert.throws(()=>spec.validate(wrong),/Компонент/)
  const lost=structuredClone(reply);lost.blocks[1].fields[0].ids=['f1'];assert.throws(()=>spec.validate(lost),/Смысловой разбор/)
  assert.throws(()=>flexCandidate([...reply.nodes,{...reply.nodes[2],id:'n9'}],work.content.blocks),/Flex/)
  const cycle=structuredClone(reply.nodes);cycle[1].parent='n3';cycle[2].parent='n2';assert.throws(()=>flexCandidate(cycle,work.content.blocks),/Flex/)
})

test('geometry repair freezes verified words and asks only for components and a free layout',()=>{
 const {library,packet,reply}=strictComponentFixture(),initial=componentFlexTask(packet,library).validate(reply).work
 const repair=componentFlexTask(packet,library,{blocks:initial.semanticBlocks,errors:'Needs more room',previous:initial.flexNodes})
 const schema=repair.task.schema as {properties:Record<string,unknown>}
 assert.ok(schema.properties.components);assert.equal(schema.properties.blocks,undefined)
 const result=repair.validate({components:initial.plan!.components,nodes:reply.nodes,background:'none'}).work
 assert.deepEqual(result.content,initial.content);assert.deepEqual(result.semanticBlocks,initial.semanticBlocks)
 assert.throws(()=>repair.validate({components:{b1:initial.plan!.components.b1},nodes:reply.nodes,background:'none'}),/блок/)
})
