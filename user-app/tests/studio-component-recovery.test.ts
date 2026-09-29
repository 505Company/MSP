import {test} from 'node:test'
import assert from 'node:assert/strict'
import {strictComponentFixture} from './fixtures/studio-components'
import {memoryBucket} from './helpers/memory-bucket'
import {reflowStudioRun,studioKey} from '../lib/presentations/studio/storage'

test('explicit creative retry revalidates only this frozen unit replies without model requests',async()=>{
 const {run,packet,reply}=strictComponentFixture(),{bucket}=memoryBucket()
 run.slides=[];run.status='blocked';run.modelRequests=8;run.semantic={source:'Frozen',strategy:'components',status:'pending',units:[{id:packet.id,packet,status:'failed',attempts:3,error:'Old adapter rejected this response'}]}
 const project={schemaVersion:1,id:run.projectId,revision:crypto.randomUUID(),name:'Новая редакция',text:'Другой текст',uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
 await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
 const prefix=`presentation-studio/${run.projectId}/${run.revision}/semantic/${packet.id}/responses/`,bad=structuredClone(reply);bad.blocks[1].fields[0].ids=['f1']
 await bucket.put(prefix+'00-valid.json',JSON.stringify({content:JSON.stringify(reply),finishReason:'stop'}));await bucket.put(prefix+'99-invalid.json',JSON.stringify({content:JSON.stringify(bad),finishReason:'stop'}))
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No model call permitted')}
 try{const recovered=await reflowStudioRun(bucket,run.projectId,run.revision)
  assert.equal(recovered.modelRequests,8);assert.equal(recovered.semantic!.units![0].status,'complete');assert.equal(recovered.semantic!.units![0].revalidatedResponse,prefix+'00-valid.json')
  assert.equal(recovered.slides[0].strictComponents,undefined);assert.ok(recovered.slides[0].candidates[0].fixedComponents);assert.ok(recovered.slides[0].candidates.length>1);assert.equal(recovered.slides[0].content.title,packet.atoms[0].text);assert.deepEqual(recovered.slides[0].flexNodes,reply.nodes)
  assert.deepEqual(recovered.semantic!.units![0].proof!.atoms,packet.atoms.map(a=>a.id))
 }finally{globalThis.fetch=originalFetch}
})
