import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { measuredStudioFixture, studioFixture } from './fixtures/studio'
import { generationPreview, listStudioGenerations } from '../lib/presentations/studio/generations'
import { studioKey, applyStudioOption } from '../lib/presentations/studio/storage'
import { recordStudioHistory,readStudioHistory } from '../lib/presentations/studio/history'
import { studioSlides } from '../lib/presentations/studio/context'
import { draftOptions } from '../lib/presentations/studio/options'
import { componentFlexTask } from '../lib/presentations/studio/component-flex'
import { strictComponentFixture } from './fixtures/studio-components'
import { orderedCandidates } from '../lib/presentations/studio/variation'

test('gallery omits export HTML without changing the saved generation or its options', () => {
  const run = measuredStudioFixture('fast'), before = JSON.stringify(run), preview = generationPreview(run)
  assert.equal(preview.previewOnly, true)
  assert.ok(preview.slides.every(s => s.options?.every(o => !o.receipt?.html)))
  assert.ok(Object.values(preview.results).every(r => !r.html))
  assert.deepEqual(preview.slides.map(s => s.options?.map(o => o.receipt?.preview)), run.slides.map(s => s.options?.map(o => o.receipt?.preview)))
  assert.equal(JSON.stringify(run), before)
})

test('cover exploration prefers unused library artwork before generic text layouts', () => {
  const work = studioFixture().slides[0], base = work.candidates[0]
  work.variation = { seed: 'cover-run', mode: 'balanced', sourceKey: 'brief' }
  work.previousDesigns = [{ signature: 'old', recipe: 'composition/library-cover', label: 'Previous', background: 'used', components: [], regions: [] }]
  work.candidates = [base, ...['used', 'fresh-1', 'fresh-2'].map(id => ({ ...base, id: `composition/library-cover/${id}`, recipeId: 'composition/library-cover', backgroundId: id }))]
  const candidates = orderedCandidates(work)
  assert.deepEqual(new Set(candidates.slice(0, 2).map(c => c.backgroundId)), new Set(['fresh-1', 'fresh-2']))
  assert.equal(candidates.at(-1)?.id, base.id)
})

test('history discovers old revisions in chronological order, labels all three modes, never writes or starts jobs', async () => {
  const { bucket, data } = memoryBucket(), base = studioFixture()
  const runs = ['fast', 'balanced', 'creative'].map((mode, i) => ({ ...base, revision: crypto.randomUUID(), createdAt: `2026-09-29T0${i}:00:00Z`, mode: mode === 'fast' ? 'fast' as const : 'smart' as const, ...(mode === 'creative' ? { semantic: { source: '', status: 'complete' as const, strategy: 'components' as const } } : {}) }))
  for (const run of runs.reverse()) await bucket.put(studioKey(run.projectId, run.revision), JSON.stringify(run))
  await bucket.put(`presentation-studio/${base.projectId}/${base.revision}/before-brand-accents-2.json`, JSON.stringify(base))
  const before = JSON.stringify([...data]), summaries = await listStudioGenerations(bucket, base.projectId)
  assert.deepEqual(summaries.map(g => g.mode), ['fast', 'balanced', 'creative'])
  assert.equal(JSON.stringify([...data]), before)
  assert.ok(summaries.every(g => !('library' in g) && !('results' in g)))
  await assert.rejects(listStudioGenerations(bucket, '../another-project'))
})

test('different modes share design history by original brief, independent of semantic block shape', async () => {
  const { bucket } = memoryBucket(), run = measuredStudioFixture('fast')
  const variation = { seed: run.revision, mode: 'fast' as const, sourceKey: 'same-original-brief' }
  const [first] = await studioSlides(bucket, run.projectId, run.library, [run.slides[0].content], 'all', variation)
  Object.assign(run.slides[0], { contentKey: first.contentKey, diversityKey: first.diversityKey })
  applyStudioOption(run, run.slides[0].content.id, run.slides[0].options![0].id)
  await recordStudioHistory(bucket, run)
  const modified = structuredClone(first.content); modified.blocks[0].emphasis = 'primary'
  const [next] = await studioSlides(bucket, run.projectId, run.library, [modified], 'all', { ...variation, mode: 'balanced', seed: 'next' })
  assert.notEqual(next.contentKey, first.contentKey)
  assert.equal(next.diversityKey, first.diversityKey)
  assert.equal(next.previousDesigns?.length, 1)
  assert.equal(next.history?.length, 1)
})

test('parallel generation checkpoints do not repeatedly count already selected designs',async()=>{
 const {bucket}=memoryBucket(),a=measuredStudioFixture('fast'),b=structuredClone(a);b.revision=crypto.randomUUID()
 for(const run of [a,b]){
  run.slides[0].contentKey='same-content';run.slides[0].diversityKey='same-slide'
  applyStudioOption(run,run.slides[0].content.id,run.slides[0].options![0].id)
 }
 for(let i=0;i<4;i++){await recordStudioHistory(bucket,a);await recordStudioHistory(bucket,b)}
 const history=await readStudioHistory(bucket,a.projectId)
 assert.equal(history.entries.length,2)
 assert.deepEqual(new Set(history.entries.map(e=>e.revision)),new Set([a.revision,b.revision]))
})

test('new generations explore compatible compositions, retrying a saved generation is deterministic', () => {
  const run = studioFixture(), work = run.slides[0], sequences: string[] = []
  for (const mode of ['fast', 'balanced', 'creative'] as const) {
    const varied = { ...work, variation: { seed: 'repeatable-revision', mode, sourceKey: 'brief' } }
    const options = draftOptions(varied, run.library)
    assert.deepEqual(options, draftOptions(varied, run.library))
    sequences.push(options.map(o => o.plan.candidateId).join(','))
  }
  assert.equal(new Set(sequences).size, 3)
  assert.equal(work.variation, undefined)
})

test('creative prompt receives previous layout and components while preserving its semantic validation', () => {
  const { packet, library, reply } = strictComponentFixture()
  const context = { variation: { seed: 'new', mode: 'creative' as const, sourceKey: 'brief' }, previousDesigns: [{ signature: 'old', recipe: 'composition/spotlight', label: 'Old cover', components: ['used-component'], regions: [{ x: 48, y: 48, w: 800, h: 500 }] }] }
  const spec = componentFlexTask(packet, library, undefined, context)
  const payload = JSON.parse(spec.task.messages[1].content as string)
  assert.deepEqual(payload.previousDesigns, context.previousDesigns)
  assert.equal(payload.generationVariant, 'new')
  assert.deepEqual(spec.validate(reply).work.content, componentFlexTask(packet, library).validate(reply).work.content)
})
