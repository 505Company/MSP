import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labCatalog } from '../component-lab/fixtures'
import { memoryBucket } from './helpers/memory-bucket'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../lib/design-system/editable-contract'
import { sourceCandidate } from '../lib/component-lab/source'
import { saveRuleRevision, readRuleHistory } from '../lib/component-lab/storage'
import { cancelUpload } from '../lib/uploads/cancellation-server'
import { claimPreparation, commandPreparation, enqueuePreparation, finishPreparation, ownedPreparation, publicPreparationJob, readPreparationJobs, updatePreparation } from '../lib/component-lab/preparation-jobs'

async function fixture() {
  const { bucket, data } = memoryBucket(), upload = crypto.randomUUID(), catalog = labCatalog()
  catalog.version = EDITABLE_VERSION; catalog.compilerVersion = EDITABLE_COMPILER_VERSION
  const sourceKey = `editable-systems/${upload}/fixture.json`
  await bucket.put(sourceKey, JSON.stringify(catalog))
  await bucket.put(`editable-systems/${upload}/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: sourceKey }))
  return { bucket, data, upload, catalog, sourceKey }
}
test('preparation is idempotent, separate from the source/rules and admits only supported qualified variants', async () => {
  const { bucket, upload, catalog, sourceKey } = await fixture(), original = await (await bucket.get(sourceKey))!.text()
  catalog.families[2].variants[0].sourceLayout!.graphic += '<image href="asset"/>'
  await bucket.put(sourceKey, JSON.stringify(catalog))
  const [a, b] = await Promise.all([enqueuePreparation(bucket, upload), enqueuePreparation(bucket, upload)])
  assert.deepEqual(a.map(j => j.id), b.map(j => j.id)); assert.equal(a.length, 3)
  assert.equal(a.filter(j => j.status === 'queued').length, 2); assert.equal(a[2].status, 'unsupported')
  assert.ok(a[2].reason); assert.equal('leaseToken' in publicPreparationJob(a[0]), false); assert.equal('input' in publicPreparationJob(a[0]), false)
  const profile = a[0].input!.profile
  assert.equal((await readRuleHistory(bucket, upload, profile)).head, null)
  assert.equal(await (await bucket.get(sourceKey))!.text(), JSON.stringify(catalog)); assert.notEqual(original, JSON.stringify(catalog), 'Only fixture setup changed source')
})
test('catalog additions refresh a stale blocked preparation queue without accepting late work', async () => {
  const { bucket, upload, catalog, sourceKey } = await fixture()
  const previous = await enqueuePreparation(bucket, upload, undefined, 1000)
  const running = (await claimPreparation(bucket, 'old-worker', 2000))!
  catalog.id = 'f'.repeat(64)
  assert.notEqual(catalog.id, running.catalogId)
  catalog.qualification!.catalogId = catalog.id
  await bucket.put(sourceKey, JSON.stringify(catalog))
  // Reproduce a queue left on the pre-refinement catalog by the old worker.
  await bucket.put(`component-preparation/${upload}/jobs.json`, JSON.stringify(previous.map((j, i) => ({ ...j, status: i === 1 ? 'cancelled' : 'blocked', reason: 'Исходная библиотека изменилась.' }))))
  const next = await claimPreparation(bucket, 'new-worker', 3000)
  assert.ok(next, 'The refreshed catalog must have a runnable job, not stay blocked forever')
  assert.equal(next.catalogId, catalog.id)
  assert.equal(next.attempts, 0)
  assert.notEqual(next.id, running.id)
  await assert.rejects(() => ownedPreparation(bucket, upload, running.id, running.leaseToken!, 3001), /владение/)
  assert.ok((await readPreparationJobs(bucket, upload)).every(j => j.catalogId === catalog.id))
  assert.equal((await readPreparationJobs(bucket, upload))[1].status, 'cancelled', 'Refreshing other jobs must not resume an explicit cancellation')
  assert.equal(await (await bucket.get(sourceKey))!.text(), JSON.stringify(catalog), 'Refreshing jobs never changes the catalog')
})
test('an unsupported profile refreshes its diagnosis without restarting unchanged completed work', async () => {
  const { bucket, upload, catalog, sourceKey } = await fixture()
  catalog.families[2].variants[0].kind = 'chart'
  await bucket.put(sourceKey, JSON.stringify(catalog))
  const jobs = await enqueuePreparation(bucket, upload, undefined, 1000), reason = jobs[2].reason
  jobs[2].reason = 'Reason from an older adapter'; jobs[0].status = 'complete'
  await bucket.put(`component-preparation/${upload}/jobs.json`, JSON.stringify(jobs))
  const next = await enqueuePreparation(bucket, upload, undefined, 2000)
  assert.equal(next[2].reason, reason); assert.equal(next[2].id, jobs[2].id)
  assert.equal(next[2].status, 'unsupported'); assert.deepEqual(next[0], jobs[0])
})
test('a matrix has one owner, resumes after a lost worker and fences the expired owner', async () => {
  const { bucket, upload, catalog, sourceKey } = await fixture(); catalog.families = catalog.families.slice(0, 1); await bucket.put(sourceKey, JSON.stringify(catalog))
  await enqueuePreparation(bucket, upload, undefined, 1000)
  const claims = await Promise.all([claimPreparation(bucket, 'a', 2000), claimPreparation(bucket, 'b', 2000)])
  assert.equal(claims.filter(Boolean).length, 1)
  const first = claims.find(Boolean)!, renewed = (await updatePreparation(bucket, upload, first.leaseToken!, {}, 3000))[0]
  assert.ok(renewed.leaseUntil! > first.leaseUntil!)
  assert.equal(await claimPreparation(bucket, 'c', 4000), null)
  const next = (await claimPreparation(bucket, 'c', renewed.leaseUntil! + 1))!
  assert.notEqual(next.leaseToken, first.leaseToken)
  await assert.rejects(() => updatePreparation(bucket, upload, first.leaseToken!, { complete: true }, renewed.leaseUntil! + 2), /владение/)
  await assert.rejects(() => updatePreparation(bucket, upload, next.leaseToken!, { complete: true }, renewed.leaseUntil! + 2), /не сохранена/)
})
test('new manual rules invalidate late work, preserve rule history and enqueue only the changed component', async () => {
  const { bucket, upload, catalog } = await fixture()
  const jobs = await enqueuePreparation(bucket, upload), running = (await claimPreparation(bucket, 'a'))!
  const p = (await sourceCandidate(catalog.families[0].variants[0], catalog.id)).profile!
  const saved = await saveRuleRevision(bucket, upload, p, { source: p.fingerprint, baseRevision: null, rules: { states: { vertical: { textAlign: 'center' } } } })
  await assert.rejects(() => ownedPreparation(bucket, upload, running.id, running.leaseToken!), /Настройки/)
  const next = await enqueuePreparation(bucket, upload)
  assert.notEqual(next[0].id, running.id); assert.equal(next[0].input!.ruleRevision, saved.id)
  assert.deepEqual(next.slice(1).map(j => j.id), jobs.slice(1).map(j => j.id))
  await assert.rejects(() => finishPreparation(bucket, upload, running.id, running.leaseToken!, {}), /владение/)
  assert.equal((await readRuleHistory(bucket, upload, p)).head, saved.id)
})
test('source/font changes, cancellation and bounded retries cannot publish a stale success', async () => {
  const { bucket, upload } = await fixture(); await enqueuePreparation(bucket, upload)
  const job = (await claimPreparation(bucket, 'a'))!
  await bucket.put(`source-fonts/${upload}/v2/manifest.json`, JSON.stringify({ fonts: [] }))
  await assert.rejects(() => ownedPreparation(bucket, upload, job.id, job.leaseToken!), /шрифты/)
  await commandPreparation(bucket, upload, job.id, 'cancel')
  await assert.rejects(() => updatePreparation(bucket, upload, job.leaseToken!, {}), /владение/)
  await enqueuePreparation(bucket, upload)
  await cancelUpload(bucket, upload)
  assert.equal(await claimPreparation(bucket, 'b'), null)
  assert.ok((await readPreparationJobs(bucket, upload)).every(j => j.status === 'cancelled'))
  await assert.rejects(() => enqueuePreparation(bucket, upload), /удал/)
  const other = await fixture(); other.catalog.families = other.catalog.families.slice(0, 1); await other.bucket.put(other.sourceKey, JSON.stringify(other.catalog)); await enqueuePreparation(other.bucket, other.upload)
  let now = Date.now()
  for (let i = 0; i < 3; i++) {
    const claimed = (await claimPreparation(other.bucket, 'worker', now))!
    const [failed] = await updatePreparation(other.bucket, other.upload, claimed.leaseToken!, { error: 'Resource unavailable', retryable: true }, now + 1)
    assert.equal(failed.status, i < 2 ? 'retrying' : 'blocked'); now = failed.retryAt! + 1
  }
  assert.equal(await claimPreparation(other.bucket, 'worker', now + 100000), null)
  assert.equal((await enqueuePreparation(other.bucket, other.upload))[0].status, 'blocked', 'A page visit never resets failures')
})
