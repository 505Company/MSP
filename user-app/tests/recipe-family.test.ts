import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { templateRecipeFixture } from './fixtures/template-recipe'
import { familyRecipeCases } from '../lib/presentations/recipes/family-cases'
import { templateCandidates, validateTemplateProposal } from '../lib/presentations/recipes/template-contract'
import { templateExtractionTask } from '../lib/presentations/recipes/template-task'
import { pilotBudget, readTemplatePilot, reservePilotRequest } from '../lib/presentations/recipes/template-pilot'

test('second-family allowance is independent, atomic and cannot replenish either previous budget', async () => {
  const { bucket, data } = memoryBucket()
  for (let i = 0; i < 12; i++) await reservePilotRequest(bucket, 'fixture')
  for (let i = 0; i < 6; i++) await reservePilotRequest(bucket, 'fixture', 'structural-1')
  const before = [...data].map(([k, v]) => [k, v.value])
  const race = await Promise.allSettled(Array.from({ length: 16 }, () => reservePilotRequest(bucket, 'fixture', 'family-2')))
  assert.ok(race.filter(r => r.status === 'fulfilled').length <= 12)
  while ((await pilotBudget(bucket, 'fixture', 'family-2')).used < 12) await reservePilotRequest(bucket, 'fixture', 'family-2')
  await assert.rejects(reservePilotRequest(bucket, 'fixture', 'family-2'), /предел/)
  assert.deepEqual(await pilotBudget(bucket, 'fixture', 'family-2'), { used: 12, limit: 12 })
  assert.deepEqual([...data].filter(([k]) => k.includes('/pilot-1/')).map(([k, v]) => [k, v.value]), before)
})
test('second-family source excludes the first source slide and never widens validator membership', () => {
  const { snapshot, proposal } = templateRecipeFixture(), options = { excludeSlideIds: ['s01'], limit: 5, additionalFamily: true }
  assert.equal(templateCandidates(snapshot, options).length, 0)
  assert.throws(() => validateTemplateProposal(proposal, snapshot, templateCandidates(snapshot, options).map(c => c.slide.id)))
  const task = templateExtractionTask(snapshot, [], options), data = task.messages[1].content
  assert.ok(Array.isArray(data)); assert.ok(data[0].type === 'text' && data[0].text.includes('Второе семейство'))
  assert.ok(task.messages[0].content.toString().includes('2–8'))
})
test('new family cases are deterministic, distinguish every item, and do not silently trim long content', () => {
  for (const count of [2, 3, 4, 6, 8]) for (const ordinals of [false, true]) {
    const cases = familyRecipeCases(count, ordinals)
    assert.deepEqual(cases, familyRecipeCases(count, ordinals))
    assert.ok(cases.every(c => c.synthetic && c.itemCount === count && c.fragments.length === 2 + count * (ordinals ? 3 : 2)))
    const sizes = cases.map(c => c.fragments.reduce((n, f) => n + f.text.length, 0))
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2])
    for (const c of cases) assert.equal(new Set(c.fragments.map(f => f.id)).size, c.fragments.length)
  }
  assert.throws(() => familyRecipeCases(1, false)); assert.throws(() => familyRecipeCases(9, true))
})
test('reading the second family does not reuse the first extraction or write anything', async () => {
  const { bucket, data } = memoryBucket(), { snapshot } = templateRecipeFixture()
  await bucket.put('visual/fixture/manifest.json', JSON.stringify({ snapshot, previews: [] }))
  const before = structuredClone([...data]), second = await readTemplatePilot(bucket, 'fixture', 'family-2')
  assert.equal(second.recipe, null); assert.deepEqual(second.cases, [])
  assert.deepEqual(second.budget, { used: 0, limit: 12 }); assert.deepEqual([...data], before)
})
