import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { labTemplate } from '../component-lab/fixtures'
import { digest, sourceCandidate } from '../lib/component-lab/source'
import { applyRules } from '../lib/component-lab/rules'
import { behaviorFor, rulesSchema } from '../lib/component-lab/contract'
import { ComponentRuleConflict, readPinnedRuleProfile, readRuleHistory, saveRuleRevision } from '../lib/component-lab/storage'
import { googleFontAlternative } from '../lib/component-lab/font-policy'

const settings = rulesSchema.parse({ states: { vertical: { textAlign: 'center', position: 'center' } } })
test('font replacements are explicit, constrained and preserve the source typography', async () => {
  const p = (await sourceCandidate(labTemplate(), 'a')).profile!, before = structuredClone(p)
  const rules = { states: {}, fontReplacements: [{ source: 'Play', family: 'Noto Sans' }] }
  const replaced = await applyRules(p, rules)
  assert.deepEqual(p, before); assert.deepEqual(replaced.source, p.source)
  assert.deepEqual(replaced.fields.map(f => f.font), ['Noto Sans', 'Noto Sans'])
  assert.deepEqual(replaced.fields.map(f => ({ ...f, font: 'Play' })), p.fields)
  assert.notEqual(replaced.fingerprint, (await applyRules(p, { states: {} })).fingerprint)
  await assert.rejects(() => applyRules(p, { ...rules, fontReplacements: [{ source: 'Unknown', family: 'Noto Sans' }] }))
  await assert.rejects(() => applyRules(p, { ...rules, fontReplacements: [...rules.fontReplacements, ...rules.fontReplacements] }))
  await assert.rejects(() => applyRules(p, { ...rules, fontReplacements: [{ source: 'Play', family: 'Arbitrary font' }] }))
  assert.equal(googleFontAlternative('Example Sans'), 'Noto Sans'); assert.equal(googleFontAlternative('Acme Serif'), 'Noto Serif')
  assert.equal(googleFontAlternative('Custom Mono'), 'Roboto Mono'); assert.equal(googleFontAlternative('Wingdings'), undefined)
})
test('rules change only their selected state and preserve source identity, content, colors and type', async () => {
  const p = (await sourceCandidate(labTemplate(), 'a'.repeat(64))).profile!, before = structuredClone(p)
  assert.equal(p.fingerprint, await digest({ version: 'component-box-2', source: labTemplate(), catalogId: 'a'.repeat(64) }), 'Renderer changes must preserve the address of saved rules and drafts')
  const changed = await applyRules(p, settings)
  assert.deepEqual(p, before); assert.deepEqual(changed.fields, p.fields); assert.deepEqual(changed.source, p.source)
  assert.equal(behaviorFor(changed, 'vertical').textAlign, 'center'); assert.equal(behaviorFor(changed, 'horizontal').textAlign, 'source')
  assert.notEqual(p.fingerprint, changed.fingerprint)
  assert.equal((await applyRules(p, settings)).fingerprint, changed.fingerprint)
  assert.equal(behaviorFor({ ...changed, behavior: { vertical: { ...settings.states.vertical!, padding: undefined, gap: undefined } } }, 'vertical').padding, p.padding)
  await assert.rejects(() => applyRules(p, { states: { vertical: { padding: 0 } } }))
  await assert.rejects(() => applyRules(p, { states: {}, arbitraryHtml: '<script/>' }))
  const simple = (await sourceCandidate(labTemplate('text'), 'a')).profile!
  await assert.rejects(() => applyRules(simple, { states: { horizontal: {} } }))
})
test('saved rules survive reopening, retain history and isolate uploads, sources and components', async () => {
  const { bucket, data } = memoryBucket(), upload = crypto.randomUUID(), p = (await sourceCandidate(labTemplate(), 'a')).profile!
  const sourceKey = 'protected/source.json'; await bucket.put(sourceKey, 'untouched')
  const first = await saveRuleRevision(bucket, upload, p, { source: p.fingerprint, baseRevision: null, rules: settings })
  const second = await saveRuleRevision(bucket, upload, p, { source: p.fingerprint, baseRevision: first.id, rules: { states: {} } })
  assert.equal(second.number, 2); assert.equal(second.parent, first.id); assert.equal(first.technical, 'not-tested'); assert.equal(second.generationAdmission, false)
  assert.deepEqual((await readRuleHistory(bucket, upload, p)).versions, [second, first])
  assert.equal((await readRuleHistory(bucket, crypto.randomUUID(), p)).head, null)
  const other = (await sourceCandidate(labTemplate('numbered'), 'a')).profile!
  assert.equal((await readRuleHistory(bucket, upload, other)).head, null)
  assert.equal((await readRuleHistory(bucket, upload, { ...p, fingerprint: 'b'.repeat(64) })).head, null)
  assert.equal(data.get(sourceKey)?.value, 'untouched')
  await assert.rejects(() => readPinnedRuleProfile(bucket, upload, p, first.id), /не прошла/)
  await assert.rejects(() => saveRuleRevision(bucket, upload, p, { source: 'b'.repeat(64), baseRevision: second.id, rules: settings }), /Исходник изменился/)
})
test('concurrent rule saves use compare-and-swap and cannot overwrite a newer revision', async () => {
  const { bucket } = memoryBucket(), upload = crypto.randomUUID(), p = (await sourceCandidate(labTemplate(), 'a')).profile!
  const results = await Promise.allSettled([settings, { states: {} }].map(rules => saveRuleRevision(bucket, upload, p, { source: p.fingerprint, baseRevision: null, rules })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof ComponentRuleConflict))
  assert.equal((await readRuleHistory(bucket, upload, p)).versions.length, 1)
  await assert.rejects(() => saveRuleRevision(bucket, upload, p, { source: p.fingerprint, baseRevision: null, rules: settings }), ComponentRuleConflict)
})
