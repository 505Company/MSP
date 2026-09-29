import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryBucket} from './helpers/memory-bucket'
import {measuredStudioFixture} from './fixtures/studio'
import {pruneStudioGenerations} from '../lib/presentations/studio/prune'
import {listStudioGenerations} from '../lib/presentations/studio/generations'
import {assertStudioProject,readStudioRun,studioKey,studioCancellationKey} from '../lib/presentations/studio/storage'
import {readStudioHistory} from '../lib/presentations/studio/history'
import {summarizeProject,readProjectPresentation} from '../lib/workspace/project-summary'
import type {PresentationProject} from '../lib/workspace/types'

async function fixture(){
  const {bucket,data}=memoryBucket(),base=JSON.parse(JSON.stringify(measuredStudioFixture('fast'))) as ReturnType<typeof measuredStudioFixture>
  base.status='complete';for(const s of base.slides)base.results[s.content.id]=s.options![0].receipt!
  const runs=[]
  for(let i=0;i<6;i++){
    const run=structuredClone(base);run.revision=crypto.randomUUID();run.createdAt=new Date(i*1000).toISOString()
    run.mode=i%3===0?'fast':'smart'
    if(run.mode==='smart')run.semantic={source:'content',status:'complete',strategy:i%3===1?'recipes':'components'}
    await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run));runs.push(run)
  }
  const project={id:base.projectId,revision:runs[0].revision,text:'Current editable draft',generationMode:'fast'} as PresentationProject
  await bucket.put(`workspace/projects/${base.projectId}.json`,JSON.stringify(project))
  await bucket.put('uploads/source/design-system.json','{"unchanged":true}')
  await bucket.put(`studio-jobs/${runs[0].revision}.json`,JSON.stringify({id:runs[0].revision,status:'running'}))
  await bucket.put(`presentation-studio/${base.projectId}/history.json`,JSON.stringify({entries:runs.map(r=>({revision:r.revision,contentKey:r.revision,signature:'a',optionId:'o'}))}))
  return {bucket,data,runs,project}
}

test('explicit cleanup keeps the latest in every mode and leaves projects and design systems byte-identical',async()=>{
  const {bucket,data,runs,project}=await fixture(),projectBefore=data.get(`workspace/projects/${project.id}.json`),styleBefore=data.get('uploads/source/design-system.json')
  const result=await pruneStudioGenerations(bucket,project.id)
  assert.deepEqual(new Set(result.kept),new Set(runs.slice(3).map(r=>r.revision)))
  assert.deepEqual(result.removed,runs.slice(0,3).map(r=>r.revision))
  assert.equal((await listStudioGenerations(bucket,project.id)).length,3)
  for(const old of runs.slice(0,3)){
    assert.equal(await readStudioRun(bucket,project.id,old.revision),null)
    const backup=await bucket.get(`deleted-presentations/${project.id}/${old.revision}/run.json`)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(await backup!.arrayBuffer())),old)
    assert.ok(await bucket.head(studioCancellationKey(project.id,old.revision)))
    await assert.rejects(assertStudioProject(bucket,old),/остановлена/)
  }
  for(const kept of runs.slice(3))assert.deepEqual(await readStudioRun(bucket,project.id,kept.revision),kept)
  assert.equal(await bucket.head(`studio-jobs/${runs[0].revision}.json`),null)
  assert.deepEqual(data.get(`workspace/projects/${project.id}.json`),projectBefore)
  assert.deepEqual(data.get('uploads/source/design-system.json'),styleBefore)
  assert.deepEqual((await readStudioHistory(bucket,project.id)).entries.map(e=>e.revision),runs.slice(3).map(r=>r.revision))
  assert.deepEqual((await pruneStudioGenerations(bucket,project.id)).removed,[])
  const before=structuredClone([...data]),summary=await summarizeProject(bucket,project)
  assert.equal(summary.status,'changed');assert.equal(summary.readyCount,2)
  assert.ok(summary.previewUrl?.includes(runs[5].revision))
  assert.ok(summary.previewUrl?.endsWith('slideId=slide-1'))
  assert.ok((await readProjectPresentation(bucket,project.id))?.slides[0].image.includes(runs[5].revision))
  assert.deepEqual([...data],before)
})

test('a failed backup cannot delete any part of that generation',async()=>{
  const {bucket,runs,project}=await fixture(),put=bucket.put.bind(bucket)
  bucket.put=(async(key:string,...args:unknown[])=>{if(key.startsWith('deleted-presentations/'))throw Error('Storage unavailable');return (put as (...args:unknown[])=>Promise<unknown>)(key,...args)}) as R2Bucket['put']
  await assert.rejects(pruneStudioGenerations(bucket,project.id),/Storage unavailable/)
  assert.deepEqual(await readStudioRun(bucket,project.id,runs[0].revision),runs[0])
  assert.equal((await listStudioGenerations(bucket,project.id)).length,6)
})

test('a run created after the cleanup inventory is retained',async()=>{
  const {bucket,runs,project}=await fixture(),put=bucket.put.bind(bucket),newRun={...runs[3],revision:crypto.randomUUID(),createdAt:new Date(999999).toISOString()}
  let inserted=false
  bucket.put=(async(key:string,...args:unknown[])=>{if(!inserted&&key.endsWith('/cancelled.json')){inserted=true;await put(studioKey(project.id,newRun.revision),JSON.stringify(newRun))}return (put as (...args:unknown[])=>Promise<unknown>)(key,...args)}) as R2Bucket['put']
  await pruneStudioGenerations(bucket,project.id)
  assert.deepEqual(await readStudioRun(bucket,project.id,newRun.revision),newRun)
})
