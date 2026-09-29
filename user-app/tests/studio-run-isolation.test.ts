import {test} from 'node:test'
import assert from 'node:assert/strict'
import {studioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {mutateStudioRun,readStudioRun,studioKey,startStudioRun} from '../lib/presentations/studio/storage'

test('an already started fast run finishes its frozen revision while another mode edits the project',async()=>{
  const fast=studioFixture(),smart={...studioFixture('smart'),revision:crypto.randomUUID()}, {bucket}=memoryBucket()
  const project={schemaVersion:1,id:fast.projectId,revision:smart.revision,name:'Параллельные режимы',text:'Новая версия',uploadId:smart.library.uploadId,styleName:smart.library.name,createdAt:fast.createdAt,updatedAt:fast.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${project.id}.json`,JSON.stringify(project))
  for(const run of [fast,smart])await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  const saved=await mutateStudioRun(bucket,fast.projectId,fast.revision,run=>{run.status='complete'})
  assert.equal(saved.status,'complete');assert.equal(saved.modelRequests,0)
  assert.equal((await readStudioRun(bucket,smart.projectId,smart.revision))!.status,smart.status)
  await assert.rejects(startStudioRun(bucket,fast.projectId,fast.revision),/изменился/)
  await bucket.put(`workspace/projects/${project.id}.json`,JSON.stringify({...project,archivedAt:fast.createdAt}))
  await assert.rejects(mutateStudioRun(bucket,fast.projectId,fast.revision,()=>{}),/архив|найден/)
})
