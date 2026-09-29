import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { refinementFixture, refinementConfig, passingReport } from './fixtures/refinement'
import { requestRefinement, advanceRefinement, refinementCandidate, reportRefinement, completeRefinement, undoRefinement } from '../lib/design-system/refinement'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { readRefinementRegistry } from '../lib/design-system/refinement-storage'
import { recheckPublishedRefinements } from '../lib/design-system/refinement-recheck'

async function publishedFixture(t: TestContext) {
  const f = await refinementFixture()
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(f.reply) } }] }), { status: 200 }))
  const job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  await reportRefinement(f.bucket, f.id, job.id, passingReport((await refinementCandidate(f.bucket, f.id, job.id))!.catalog))
  await completeRefinement(f.bucket, f.id, job.id)
  return { ...f, job }
}

test('a completed published addition survives a compiler upgrade only after a fresh local check', async t => {
  const f = await publishedFixture(t)
  const registry = await readRefinementRegistry(f.bucket, f.id)
  const evidence = new Map([...f.data].map(([key, entry]) => [key, entry.value]))
  const base = { ...f.base, id: 'd'.repeat(64) }; base.qualification = passingReport(base)
  await f.bucket.put(f.baseKey, JSON.stringify(base))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('must not call a model') })
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, base.id)
  let work = await recheckPublishedRefinements(f.bucket, f.id)
  assert.ok(work.candidate, 'the published saved reply must be recompiled for a fresh check')
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, base.id, 'unqualified replay stays private')
  await assert.rejects(() => recheckPublishedRefinements(f.bucket, f.id, passingReport(f.base)), /изменилось|изменился/)
  while (work.candidate) work = await recheckPublishedRefinements(f.bucket, f.id, passingReport(work.candidate.catalog))
  assert.equal(work.complete, true)
  const current = (await readEditableCatalog(f.bucket, f.id))!
  assert.notEqual(current.id, base.id)
  assert.ok(current.families.flatMap(f => f.variants).some(v => v.id === 'original'))
  assert.ok(current.families.flatMap(f => f.variants).length > base.families.flatMap(f => f.variants).length)
  assert.equal(current.refinement!.baseId, base.id)
  assert.deepEqual(await readRefinementRegistry(f.bucket, f.id), registry, 'publication history and undo lineage stay unchanged')
  for (const [key, value] of evidence) if (key !== f.baseKey) assert.equal(f.data.get(key)!.value, value, key)
  assert.deepEqual(await recheckPublishedRefinements(f.bucket, f.id), work, 'completed local replay is idempotent')
  await undoRefinement(f.bucket, f.id, current.id)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, base.id)
  assert.equal((await recheckPublishedRefinements(f.bucket, f.id)).candidate, null, 'undo must not resurrect the old addition')
})

test('a failed current qualification never reuses the former passing report', async t => {
  const f = await publishedFixture(t), base = { ...f.base, id: 'd'.repeat(64) }; base.qualification = passingReport(base)
  await f.bucket.put(f.baseKey, JSON.stringify(base))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('must not call a model') })
  let work = await recheckPublishedRefinements(f.bucket, f.id)
  while (work.candidate) {
    const report = passingReport(work.candidate.catalog)
    report.checks.forEach(c => { c.passed = c.source = c.changed = false; c.issues = ['Reproduced overflow'] })
    work = await recheckPublishedRefinements(f.bucket, f.id, report)
  }
  assert.equal(work.complete, true)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, base.id)
  assert.equal((await recheckPublishedRefinements(f.bucket, f.id)).candidate, null, 'failed results are not endlessly rerun')
})

test('published replay refuses a changed source and waits for an active user request', async t => {
  const f = await publishedFixture(t), base = { ...f.base, id: 'd'.repeat(64) }; base.qualification = passingReport(base)
  await f.bucket.put(f.baseKey, JSON.stringify(base))
  const queued = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: base.id, note: '' })
  assert.deepEqual(await recheckPublishedRefinements(f.bucket, f.id), { complete: false, candidate: null })
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).pending, queued.id)
  const { cancelRefinement } = await import('../lib/design-system/refinement')
  await cancelRefinement(f.bucket, f.id, queued.id)
  await f.bucket.put(f.baseKey, JSON.stringify({ ...base, sourceRevision: 'new-source' }))
  await assert.rejects(() => recheckPublishedRefinements(f.bucket, f.id), /Исходник изменился/)
})

test('multiple published corrections replay in order and remain individually undoable', async t => {
  const f = await publishedFixture(t), first = (await readEditableCatalog(f.bucket, f.id))!
  const target = first.families.flatMap(f => f.variants).find(v => v.id !== 'original' && v.kind === 'metric')!
  const job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'feedback', catalogId: first.id, templateId: target.id, feedback: 'incomplete', note: '' })
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  const candidate = (await refinementCandidate(f.bucket, f.id, job.id))!
  await reportRefinement(f.bucket, f.id, job.id, passingReport(candidate.catalog))
  await completeRefinement(f.bucket, f.id, job.id)
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).history.length, 2)
  const base = { ...f.base, id: 'd'.repeat(64) }; base.qualification = passingReport(base)
  await f.bucket.put(f.baseKey, JSON.stringify(base))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('must not call a model') })
  let work = await recheckPublishedRefinements(f.bucket, f.id), checks = 0
  while (work.candidate) { checks++; work = await recheckPublishedRefinements(f.bucket, f.id, passingReport(work.candidate.catalog)) }
  assert.equal(checks, 2)
  await undoRefinement(f.bucket, f.id, (await readEditableCatalog(f.bucket, f.id))!.id)
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).history.length, 1)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.refinement!.requestId, f.job.id, 'undo immediately restores the checked prefix')
  work = await recheckPublishedRefinements(f.bucket, f.id)
  while (work.candidate) work = await recheckPublishedRefinements(f.bucket, f.id, passingReport(work.candidate.catalog))
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.refinement!.requestId, f.job.id)
})
