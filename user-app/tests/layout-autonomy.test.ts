import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { layoutInput } from './fixtures/layout'
import { addBankStyle, createProject, updateProject } from '../lib/workspace/storage'
import type { LayoutContext } from '../lib/presentations/layout-context'
import { enqueueLayoutJob, claimLayoutJob, updateLayoutJob, readLayoutJob, publicLayoutJob } from '../lib/presentations/layout-jobs'
import { limitLayoutRequests, readLayoutBudget, reserveLayoutRequest } from '../lib/presentations/layout-budget'

async function fixture() {
  const store = memoryBucket(), input = layoutInput()
  const style = { id: input.uploadId, name: 'Test style', fileName: 'fixture.pptx', sourceId: 'source', createdAt: new Date().toISOString(), slideCount: 1, componentCount: 0, styleCount: 1, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Autonomous generation', uploadId: style.id, text: input.content[0].text }, style)
  const context: LayoutContext = { projectId: project.id, uploadId: style.id, sourceRevision: project.revision, materialId: 'material', inputId: 'input', prefix: `presentation-layouts/${project.id}/input`, inputs: [input] }
  return { ...store, context, project }
}
test('presentation jobs survive the editor, have one owner and fence expired leases', async () => {
  const { bucket, context } = await fixture()
  await enqueueLayoutJob(bucket, context, false, 1000)
  const owners = await Promise.all([claimLayoutJob(bucket, 'a', 2000), claimLayoutJob(bucket, 'b', 2000)])
  assert.equal(owners.filter(Boolean).length, 1)
  const first = owners.find(Boolean)!
  assert.equal((await enqueueLayoutJob(bucket, context, false, 3000))!.leaseToken, first.leaseToken)
  assert.equal(await claimLayoutJob(bucket, 'c', 4000), null)
  const second = await claimLayoutJob(bucket, 'c', first.leaseUntil! + 1)
  assert.ok(second); assert.notEqual(first.leaseToken, second.leaseToken)
  await assert.rejects(updateLayoutJob(bucket, context.projectId, first.leaseToken!, { complete: true }, first.leaseUntil! + 2), /владение/)
  const done = await updateLayoutJob(bucket, context.projectId, second.leaseToken!, { complete: true }, first.leaseUntil! + 3)
  assert.equal(done!.status, 'complete')
  assert.equal('leaseToken' in publicLayoutJob(first)!, false)
})
test('presentation retries stay bounded across reloads; an explicit retry preserves the spent budget', async () => {
  const { bucket, context } = await fixture(); let now = 1000
  await enqueueLayoutJob(bucket, context, false, now)
  await reserveLayoutRequest(bucket, context, context.inputs[0].slideId)
  for (let i = 0; i < 3; i++) {
    const job = await claimLayoutJob(bucket, 'worker', now); assert.ok(job)
    const failed = await updateLayoutJob(bucket, context.projectId, job.leaseToken!, { error: 'Network', retryable: true }, now + 1)
    assert.equal(failed!.status, i === 2 ? 'blocked' : 'retrying')
    now = (failed!.retryAt ?? now) + 1
  }
  assert.equal(await claimLayoutJob(bucket, 'worker', now + 100000), null)
  assert.equal((await enqueueLayoutJob(bucket, context, false, now))!.status, 'blocked')
  assert.equal((await enqueueLayoutJob(bucket, context, true, now))!.status, 'queued')
  assert.equal((await readLayoutBudget(bucket, context)).used, 1)
})
test('changing project content cancels stale jobs and rejects late completion', async () => {
  const { bucket, context, project } = await fixture()
  await enqueueLayoutJob(bucket, context, false, 1000)
  const job = await claimLayoutJob(bucket, 'worker', 2000); assert.ok(job)
  await updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: 'New source text' })
  await assert.rejects(updateLayoutJob(bucket, project.id, job.leaseToken!, { complete: true }, 3000), /Проект изменился/)
  assert.equal(await claimLayoutJob(bucket, 'worker', job.leaseUntil! + 1), null)
  assert.equal((await readLayoutJob(bucket, project.id))?.status, 'cancelled')
})
test('atomic request budgets cap each slide and the complete run, and cannot be replenished', async () => {
  const { bucket, context } = await fixture()
  context.inputs.push({ ...context.inputs[0], slideId: 'slide-2' })
  await limitLayoutRequests(bucket, context, 8)
  for (let i = 0; i < 5; i++) await reserveLayoutRequest(bucket, context, 'slide-1')
  const race = await Promise.allSettled([reserveLayoutRequest(bucket, context, 'slide-1'), reserveLayoutRequest(bucket, context, 'slide-1')])
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
  await reserveLayoutRequest(bucket, context, 'slide-2'); await reserveLayoutRequest(bucket, context, 'slide-2')
  await assert.rejects(reserveLayoutRequest(bucket, context, 'slide-2'), /предел/)
  await limitLayoutRequests(bucket, context, 120)
  assert.deepEqual(await readLayoutBudget(bucket, context), { used: 8, limit: 8, slides: { 'slide-1': 6, 'slide-2': 2 } })
})
