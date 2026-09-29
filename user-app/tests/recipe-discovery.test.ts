import test from 'node:test'
import assert from 'node:assert/strict'
import { discoveryFixture, discoveryConfig, discoveryProtocolReport, providerReply } from './fixtures/recipe-discovery'
import { changeDiscoveryJob, claimDiscoveryJob, commandDiscoveryJob, DISCOVERY_LEASE_MS, enqueueDiscoveryJob, ownedDiscoveryJob, publicDiscoveryJob, readDiscoveryJobs, reserveDiscoveryRequest, updateDiscoveryJob } from '../lib/presentations/recipes/discovery-jobs'
import { advanceDiscovery, readDiscoveryEvidence } from '../lib/presentations/recipes/discovery-workflow'
import { readRecipeRegistry, availableRecipes, recipeEligibility } from '../lib/presentations/recipes/library'
import { cancelUpload } from '../lib/uploads/cancellation-server'
import { validateDiscoveryExtraction } from '../lib/presentations/recipes/discovery-task'
import { comparisonFixture } from './fixtures/template-comparison'
import { readModelRun } from '../lib/uploads/model-run'
import { workerHeartbeat, workerIsAvailable } from '../lib/uploads/processing-jobs'

async function running(f: Awaited<ReturnType<typeof discoveryFixture>>, limit = 24) {
  await enqueueDiscoveryJob(f.bucket, f.uploadId, { id: crypto.randomUUID(), limit })
  return (await claimDiscoveryJob(f.bucket, 'test-worker'))!
}
async function finish(f: Awaited<ReturnType<typeof discoveryFixture>>, job: Awaited<ReturnType<typeof running>>) {
  for (let i = 0; i < 40; i++) {
    const next = await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)
    if (next.value.done) { await updateDiscoveryJob(f.bucket, f.uploadId, job.leaseToken!, { complete: true }); return }
    if (next.value.render) await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig, { stepId: next.value.stepId!, value: await discoveryProtocolReport(next.value.render) })
    await next.execute?.()
  }
  assert.fail('Unbounded workflow')
}

test('a single atomic queue deduplicates starts and never refills the budget on retry or GET', async () => {
  const f = await discoveryFixture(), request = { id: crypto.randomUUID(), limit: 8 }
  const [a, b] = await Promise.all([enqueueDiscoveryJob(f.bucket, f.uploadId, request), enqueueDiscoveryJob(f.bucket, f.uploadId, request)])
  assert.equal(a.id, b.id); assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId)).length, 1)
  await assert.rejects(enqueueDiscoveryJob(f.bucket, f.uploadId, { ...request, limit: 10 }), /бюджет/)
  await assert.rejects(enqueueDiscoveryJob(f.bucket, f.uploadId, { id: crypto.randomUUID(), limit: 8 }), /текущее/)
  const claimed = (await claimDiscoveryJob(f.bucket, 'worker'))!
  await reserveDiscoveryRequest(f.bucket, claimed, claimed.leaseToken!, 'synthetic')
  await updateDiscoveryJob(f.bucket, f.uploadId, claimed.leaseToken!, { error: 'Test interruption', retryable: false })
  const before = structuredClone([...f.data])
  const read = await readDiscoveryJobs(f.bucket, f.uploadId); publicDiscoveryJob(read[0]); await readDiscoveryEvidence(f.bucket, read[0])
  assert.deepEqual([...f.data], before)
  assert.equal('leaseToken' in publicDiscoveryJob(read[0]), false)
  await commandDiscoveryJob(f.bucket, f.uploadId, claimed.id, 'resume')
  assert.equal((await enqueueDiscoveryJob(f.bucket, f.uploadId, request)).budget.used, 1)
})
test('leases prevent concurrent workers, expire safely and block abandoned jobs after bounded recovery', async () => {
  const f = await discoveryFixture(), now = Date.now(), job = await running(f)
  assert.equal(await claimDiscoveryJob(f.bucket, 'second', now), null)
  let current = job
  for (let i = 1; i <= 2; i++) {
    current = (await claimDiscoveryJob(f.bucket, `worker-${i}`, now + i * (DISCOVERY_LEASE_MS + 100)))!
    assert.notEqual(current.leaseToken, job.leaseToken)
  }
  await assert.rejects(ownedDiscoveryJob(f.bucket, f.uploadId, job.id, job.leaseToken!), /владение/)
  assert.equal(await claimDiscoveryJob(f.bucket, 'last', now + 3 * (DISCOVERY_LEASE_MS + 100)), null)
  assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId))[0].status, 'blocked')
})
test('a worker must advertise recipe capability; later heartbeats preserve it but another worker cannot inherit it', async () => {
  const f = await discoveryFixture(), now = Date.now()
  await workerHeartbeat(f.bucket, 'old-worker', now, ['presentation'])
  assert.equal(await workerIsAvailable(f.bucket, now, 'recipes'), false)
  await workerHeartbeat(f.bucket, 'new-worker', now, ['presentation', 'recipes'])
  await workerHeartbeat(f.bucket, 'new-worker', now + 1000)
  assert.equal(await workerIsAvailable(f.bucket, now + 2000, 'recipes'), true)
  await workerHeartbeat(f.bucket, 'another-worker', now + 3000)
  assert.equal(await workerIsAvailable(f.bucket, now + 3000, 'recipes'), false)
})
test('concurrent reservations and the clarification call share the exact persistent cap', async t => {
  const f = await discoveryFixture(), job = await running(f, 1)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerReply({ bad: true }) })
  const started = await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)
  await assert.rejects(started.execute!(), /предел|Предел/)
  assert.equal(calls, 1)
  const attempts = await Promise.allSettled([reserveDiscoveryRequest(f.bucket, job, job.leaseToken!, 'a'), reserveDiscoveryRequest(f.bucket, job, job.leaseToken!, 'b')])
  assert.ok(attempts.every(r => r.status === 'rejected'))
  await updateDiscoveryJob(f.bucket, f.uploadId, job.leaseToken!, { error: 'Budget exhausted', retryable: true })
  await assert.rejects(commandDiscoveryJob(f.bucket, f.uploadId, job.id, 'resume'), /исчерпан/)
  assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId))[0].budget.used, 1)
})
test('one job autonomously extracts, binds, measures, reviews and registers only a pending candidate', async t => {
  const f = await discoveryFixture(), beforeSource = f.data.get(`visual/${f.uploadId}/manifest.json`)!.value, job = await running(f)
  t.mock.method(globalThis, 'fetch', f.fetchModel)
  // A renderer restart after the first paid call uses the saved extraction.
  await (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).execute!()
  await updateDiscoveryJob(f.bucket, f.uploadId, job.leaseToken!, { error: 'Synthetic worker loss', retryable: false })
  await commandDiscoveryJob(f.bucket, f.uploadId, job.id, 'resume')
  const resumed = (await claimDiscoveryJob(f.bucket, 'replacement-worker'))!
  await finish(f, resumed)
  assert.equal(f.calls(), 8)
  const saved = (await readDiscoveryJobs(f.bucket, f.uploadId))[0]
  assert.equal(saved.status, 'complete'); assert.equal(saved.result?.technical, 'passed'); assert.equal(saved.budget.used, 8)
  const registry = await readRecipeRegistry(f.bucket, f.uploadId)
  assert.equal(registry.entries.length, 1); assert.equal(registry.entries[0].artistic, 'pending'); assert.equal(registry.entries[0].enabled, false)
  assert.deepEqual((await recipeEligibility(f.bucket, f.uploadId, registry.entries[0], false)).reasons, [])
  assert.deepEqual(await availableRecipes(f.bucket, f.uploadId), [])
  assert.equal(f.data.get(`visual/${f.uploadId}/manifest.json`)!.value, beforeSource)
  const beforeRead = structuredClone([...f.data]); await readDiscoveryEvidence(f.bucket, saved); assert.deepEqual([...f.data], beforeRead)
  const second = await enqueueDiscoveryJob(f.bucket, f.uploadId, { id: crypto.randomUUID(), limit: 24 })
  assert.deepEqual(second.candidateSlideIds, [])
  await finish(f, (await claimDiscoveryJob(f.bucket, 'next-worker'))!)
  assert.equal(f.calls(), 8)
})
test('an unsupported family is an explicit bounded result, not a fabricated recipe', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', async () => providerReply({ profile: 'unsupported', proposal: null, reason: 'Нет равноправных текстовых блоков.' }))
  await finish(f, job)
  assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId))[0].budget.used, 1)
  assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId))[0].result?.technical, 'unsupported')
  assert.equal((await readRecipeRegistry(f.bucket, f.uploadId)).entries.length, 0)
})
test('a rejected extraction goes to one bounded model alternative and can end unsupported without user intervention', async t => {
  const f = await discoveryFixture(), job = await running(f); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    if (calls <= 2) return providerReply({ invalid: true })
    const task = JSON.parse(init!.body as string)
    assert.ok(task.messages.at(-1).content.includes('previousRejected'))
    return providerReply({ profile: 'unsupported', proposal: null, reason: 'Оставшиеся слайды имеют неподдерживаемые количественные поля.' })
  })
  await finish(f, job)
  const saved = (await readDiscoveryJobs(f.bucket, f.uploadId))[0], evidence = await readDiscoveryEvidence(f.bucket, saved)
  assert.equal(saved.result?.technical, 'unsupported'); assert.equal(saved.budget.used, 3)
  assert.equal(evidence.extractions[0]?.status, 'failed'); assert.equal(evidence.extractions[1]?.status, 'complete')
})
test('an old unsupported profile does not permanently exclude sources after an executor upgrade', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', async () => providerReply({ profile: 'unsupported', proposal: null, reason: 'Unsupported test profile.' }))
  await finish(f, job)
  await changeDiscoveryJob(f.bucket, f.uploadId, job.id, saved => ({ ...saved, version: 'recipe-discovery-old' }))
  const next = await enqueueDiscoveryJob(f.bucket, f.uploadId, { id: crypto.randomUUID(), limit: 24 })
  assert.deepEqual(next.candidateSlideIds, job.candidateSlideIds)
  assert.ok(next.candidateSlideIds.length > 0)
})
test('two invalid full extraction attempts finish rejected and never fabricate a library version', async t => {
  const f = await discoveryFixture(), job = await running(f); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerReply({ invalid: true }) })
  await finish(f, job)
  assert.equal(calls, 4)
  const saved = (await readDiscoveryJobs(f.bucket, f.uploadId))[0]
  assert.equal(saved.result?.technical, 'failed'); assert.equal(saved.result?.recipeId, undefined); assert.equal(saved.status, 'complete')
  assert.equal((await readRecipeRegistry(f.bucket, f.uploadId)).entries.length, 0)
})
test('a failed reconstruction is retained as a disabled draft without wasting three binding requests', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (JSON.parse(init!.body as string).response_format.json_schema.name === 'template_recipe_review') return providerReply({ verdict: 'revise', issues: ['Synthetic visual mismatch'] })
    return f.fetchModel(url, init)
  })
  await finish(f, job)
  const saved = (await readDiscoveryJobs(f.bucket, f.uploadId))[0], registry = await readRecipeRegistry(f.bucket, f.uploadId)
  assert.equal(saved.budget.used, 2); assert.equal(saved.result?.technical, 'failed'); assert.equal(registry.entries[0].enabled, false)
  assert.ok((await recipeEligibility(f.bucket, f.uploadId, registry.entries[0])).reasons.includes('technical-not-passed'))
})
test('a text profile cannot silently discard paired percentages as optional notes', async () => {
  const f = await comparisonFixture()
  assert.throws(() => validateDiscoveryExtraction({ profile: 'repeated-text', proposal: f.proposal, reason: 'wrong' }, f.snapshot, ['s01']), /проверку/i)
  assert.equal(validateDiscoveryExtraction({ profile: 'paired-percent', proposal: f.proposal, reason: 'pairs' }, f.snapshot, ['s01']).profile, 'paired-percent')
})
test('source changes and deletion fence requests; cancel is still available after source removal', async () => {
  const f = await discoveryFixture(), job = await running(f)
  await f.bucket.put(`visual/${f.uploadId}/manifest.json`, JSON.stringify({ ...f.visual, snapshot: { ...f.source.snapshot, name: 'Changed' } }))
  await assert.rejects(reserveDiscoveryRequest(f.bucket, job, job.leaseToken!, 'extract'), /Источник изменился/)
  await f.bucket.delete(`visual/${f.uploadId}/manifest.json`)
  assert.equal((await commandDiscoveryJob(f.bucket, f.uploadId, job.id, 'cancel')).status, 'cancelled')
  const g = await discoveryFixture(), other = await running(g)
  await cancelUpload(g.bucket, g.uploadId)
  assert.equal((await readDiscoveryJobs(g.bucket, g.uploadId))[0].status, 'cancelled')
  await assert.rejects(reserveDiscoveryRequest(g.bucket, other, other.leaseToken!, 'extract'))
  assert.equal(await claimDiscoveryJob(g.bucket, 'new-worker'), null)
})
test('cancelling during a model call prevents clarification and publication', async t => {
  const f = await discoveryFixture(), job = await running(f); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; await commandDiscoveryJob(f.bucket, f.uploadId, job.id, 'cancel'); return providerReply({ invalid: true }) })
  await assert.rejects((await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).execute!(), /владение/)
  assert.equal(calls, 1); assert.equal((await readRecipeRegistry(f.bucket, f.uploadId)).entries.length, 0)
  assert.equal((await readDiscoveryJobs(f.bucket, f.uploadId))[0].budget.used, 1)
})
test('stale or fabricated reconstruction evidence is rejected without visual spend', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', f.fetchModel)
  await (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).execute!()
  const next = (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).value
  const report = await discoveryProtocolReport(next.render!)
  await assert.rejects(advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig, { stepId: 'other', value: report }), /другому этапу/)
  report.measurements[0].text = 'changed source'
  await assert.rejects(advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig, { stepId: next.stepId!, value: report }))
  assert.equal(f.calls(), 1)
})
test('saved review cannot be reused with modified PNG or measurement inputs', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', f.fetchModel)
  await (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).execute!()
  const next = (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).value
  await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig, { stepId: next.stepId!, value: await discoveryProtocolReport(next.render!) })
  await (await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)).execute!()
  const view = await readDiscoveryEvidence(f.bucket, job), check = view.checks[0], run = (await readModelRun(f.bucket, `${check.prefix}/review`))!
  const key = `${check.prefix}/review/inputs/${run.inputHash}.json`
  await f.bucket.put(key, JSON.stringify({ task: {} }))
  await assert.rejects(advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig), /другим измерениям/)
  assert.equal(f.calls(), 2)
})
test('cancellation while qualification hashes are being stored fences the final registry commit', async t => {
  const f = await discoveryFixture(), job = await running(f)
  t.mock.method(globalThis, 'fetch', f.fetchModel)
  while (f.calls() < 8) {
    const next = await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig)
    if (next.value.render) await advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig, { stepId: next.value.stepId!, value: await discoveryProtocolReport(next.value.render) })
    await next.execute?.()
  }
  const put = f.bucket.put.bind(f.bucket)
  t.mock.method(f.bucket, 'put', async (key: string, value: string, options?: R2PutOptions) => {
    const result = await put(key, value, options)
    if (key.includes('/bundles/')) await commandDiscoveryJob(f.bucket, f.uploadId, job.id, 'cancel')
    return result
  })
  await assert.rejects(advanceDiscovery(f.bucket, f.uploadId, job.id, job.leaseToken!, discoveryConfig), /владение/)
  assert.equal((await readRecipeRegistry(f.bucket, f.uploadId)).entries.length, 0)
})
