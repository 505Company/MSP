import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeLayoutFixture,sourceText} from './fixtures/native-layout'
import {validateEditableReply} from '../lib/design-system/editable-contract'
import {compileEditableProposal} from '../lib/design-system/editable-source'

function fixture(){
 const {snapshot,proposal}=nativeLayoutFixture('metric')
 snapshot.elements=[0,1,2].flatMap(i=>[
  {...snapshot.elements[0],id:`panel${i}`,properties:{...snapshot.elements[0].properties,bounds:{x:i*310,y:10,width:300,height:160}}},
  sourceText(`value${i}`,`${i+1}%`,i*310+20,30,180,80,70),
  sourceText(`caption${i}`,`Пояснение ${i+1}`,i*310+20,135,220,38,20),
 ])
 proposal.sourceIds=snapshot.elements.map(e=>e.id);proposal.data={items:[1,2,3].map(i=>({value:`${i}%`}))}
 return {snapshot,reply:{slides:[{slide:1,blocks:[proposal],note:''}]}}
}
test('a model metric collection becomes source-backed metrics plus composition, preserving captions',()=>{
 const {snapshot,reply}=fixture(),before=structuredClone(reply),result=validateEditableReply(reply,snapshot,[1],[])
 assert.deepEqual(reply,before)
 const metrics=result.slides[0].blocks.filter(b=>b.kind==='metric')
 assert.equal(metrics.length,3);assert.deepEqual(result.slides[0].blocks.at(-1)!.memberIds,metrics.map(b=>b.id))
 for(const [i,m] of metrics.entries()){
  assert.deepEqual(m.sourceIds,[`panel${i}`,`value${i}`,`caption${i}`]);assert.equal(m.data.items![0].text,`Пояснение ${i+1}`)
  assert.ok(compileEditableProposal(m,1,snapshot,'job',[]).sourceLayout)
 }
})
test('ambiguous panels, duplicate sources, and unknown IDs do not get repaired into accepted metrics',()=>{
 for(const change of ['overlap','duplicate','unknown']){
  const {snapshot,reply}=fixture()
  if(change==='overlap')snapshot.elements[3].properties.bounds=snapshot.elements[0].properties.bounds
  else reply.slides[0].blocks[0].sourceIds.push(change==='duplicate'?'value0':'missing')
  assert.throws(()=>validateEditableReply(reply,snapshot,[1],[]))
 }
})
