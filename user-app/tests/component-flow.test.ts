import test from 'node:test'
import assert from 'node:assert/strict'
import {flowFixture} from './fixtures/component-flow'
import {COMPONENT_FLOW_VERSION,proposeComponentFlow,flowProfileKey,qualifiedComponentFlow,componentCapabilities} from '../lib/design-system/component-adaptation'
import {saveComponentAdaptation} from '../lib/design-system/component-adaptation-storage'
import {memoryBucket} from './helpers/memory-bucket'
import type {EditableCatalog} from '../lib/design-system/editable-contract'
import {flowCases} from '../lib/design-system/component-adaptation'

test('only a simple native number and caption panel proposes flow; graphics and compound cards remain fixed',()=>{
 const t=flowFixture(),before=structuredClone(t)
 assert.ok(proposeComponentFlow(t));assert.deepEqual(t,before)
 assert.equal(componentCapabilities(t).mode,'fixed-native');assert.equal(componentCapabilities(t,proposeComponentFlow(t)).colors,false)
 for(const graphic of ['<svg><image href="photo.png"/></svg>','<svg><path d="M0 0L100 100Z"/></svg>','<svg><ellipse rx="100"/></svg>'])assert.equal(proposeComponentFlow({...t,sourceLayout:{...t.sourceLayout!,graphic}}),null)
 assert.equal(proposeComponentFlow({...t,kind:'chart'}),null)
})
test('flow admission needs the full qualification matrix and ties evidence to immutable source content',async()=>{
 const t=flowFixture(),catalog={id:'c'.repeat(64),families:[{variants:[t]}],qualification:{checks:[{id:t.id,passed:true}]}} as unknown as EditableCatalog
 const report:import('../lib/design-system/component-adaptation').ComponentFlowReport={version:COMPONENT_FLOW_VERSION,catalogId:catalog.id,checks:[{id:t.id,name:t.name,profile:await flowProfileKey(t),passed:true,issues:[],cases:flowCases.map(c=>({name:c.name,width:c.width,height:400,expected:c.expected,passed:c.expected,issues:c.expected?[]:['flow-size-contract'],pixels:c.expected?[200,300]:[]}))}]}
 const {bucket}=memoryBucket();await saveComponentAdaptation(bucket,'style',catalog,report)
 assert.ok(await qualifiedComponentFlow(t,report));assert.equal(await qualifiedComponentFlow({...t,data:{...t.data,text:'Different source'}},report),null)
 const bad=structuredClone(report);bad.checks[0].cases.pop();await assert.rejects(()=>saveComponentAdaptation(bucket,'style',catalog,bad))
 const noPixels=structuredClone(report);noPixels.checks[0].cases[0].pixels=[0,100];await assert.rejects(()=>saveComponentAdaptation(bucket,'style',catalog,noPixels))
})

test('an adaptive number slot cannot be filled only through its optional unit alias',async()=>{
 const {componentBindingIssues}=await import('../lib/presentations/adaptive-components'),t=flowFixture()
 t.sourceLayout!.text[0].binding={field:'metric'}
 const input={components:[t],componentFlows:{[t.id]:proposeComponentFlow(t)!},content:[{id:'n',text:'73%'},{id:'c',text:'Пользователи'}]} as unknown as import('../lib/presentations/layout-contract').LayoutInput
 const issue=componentBindingIssues({id:t.id,fields:[{path:'unit',fragments:['n']},{path:'text',fragments:['c']}]},['n','c'],input)
 assert.ok(issue.includes('component-number-field-required'))
})
