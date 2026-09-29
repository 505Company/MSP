import test from 'node:test'
import assert from 'node:assert/strict'
import { familyFixture } from '../component-lab/family-fixtures'
import { componentIntentSchema, intentIssues, sourceCoverage, updatedSourceCoverage } from '../lib/design-system/component-intent'
import { sourceCandidate } from '../lib/component-lab/source'
import { applyRules } from '../lib/component-lab/rules'
import { auditSourceFidelity } from '../lib/component-lab/fidelity'
import { readSourceScene } from '../lib/design-system/source-scene'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { compileEditableSlides, validateRecognitionReply } from '../lib/design-system/editable-analysis'
import type { EditableReply } from '../lib/design-system/editable-contract'

test('new import requires a ledger and compiles model semantics into native text fields without another model stage', async () => {
  const t = familyFixture('quote'), elements = t.sourceLayout!.text.map(s => ({ id: s.element.id, name: s.element.name, kind: 'text', slide: 1, properties: { ...s.element } }))
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'c'.repeat(64), name: 'Independent quote', slideCount: 1, assets: [], fonts: [{ family: 'Play', sizes: [40, 28], occurrences: 2 }], colors: [], limitations: [], slides: [{ id: 's01', number: 1, width: 1000, height: 600, part: 'ppt/slides/slide1.xml', text: '', warnings: [] }], elements }
  const { id, name, description, tags, sourceIds, memberIds, style, config, data } = t
  const adaptation = componentIntentSchema.parse({ version: 'component-intent-1', family: 'quote-author', fields: elements.map((e, i) => ({ sourceId: e.id, part: 'whole', role: i ? 'author' : 'quote' })), layouts: [{ state: 'vertical', textAlign: 'source', position: 'top' }], rationale: 'Quotation followed by its author' })
  const raw: EditableReply = { slides: [{ slide: 1, note: 'Every source object belongs to the quotation.', objectRoles: { background: [], decoration: [], context: [], unresolved: [] }, blocks: [{ id, name, description, tags, sourceIds, memberIds, style, config, data, kind: 'text', dataStatus: 'readable', adaptation }] }] }
  const before = JSON.stringify(raw), parsed = validateRecognitionReply(raw, snapshot, [1], [])
  const compiled = await compileEditableSlides(snapshot, parsed.slides, '00000000-0000-4000-a000-000000000001', [])
  const variant = compiled.families.flatMap(f => f.variants).find(v => v.id === id)!
  assert.deepEqual(variant.adaptation, adaptation); assert.ok(variant.sourceLayout)
  assert.equal((await sourceCandidate(variant, 'new-catalog')).profile?.family, 'quote-author')
  assert.equal(compiled.coverage[0].objects!.complete, true); assert.equal(JSON.stringify(raw), before)
  const missing = structuredClone(raw); delete missing.slides[0].objectRoles
  assert.throws(() => validateRecognitionReply(missing, snapshot, [1], []))
  const incomplete = structuredClone(raw); incomplete.slides[0].blocks[0].adaptation!.fields.pop()
  assert.throws(() => validateRecognitionReply(incomplete, snapshot, [1], []))
})

test('imported semantic intent controls field roles and default alignment, while manual rules take precedence', async () => {
  const t = familyFixture('bare')
  t.adaptation = componentIntentSchema.parse({ version: 'component-intent-1', family: 'number-caption', fields: t.sourceLayout!.text.map((s, i) => ({ sourceId: s.element.id, part: 'whole', role: i ? 'caption' : 'number' })), layouts: [{ state: 'vertical', textAlign: 'center', position: 'center' }], rationale: 'A single highlighted result and its explanation' })
  const before = JSON.stringify(t), c = await sourceCandidate(t, 'independent-source')
  assert.ok(c.profile, c.reason)
  const effective = await applyRules(c.profile, { states: {} })
  assert.deepEqual(effective.states, ['vertical']); assert.equal(effective.behavior?.vertical?.textAlign, 'center')
  const manual = await applyRules(c.profile, { states: { vertical: { textAlign: 'right' } } })
  assert.equal(manual.behavior?.vertical?.textAlign, 'right'); assert.equal(JSON.stringify(t), before)
  assert.equal((await auditSourceFidelity(t, effective, c.content!)).status, 'preserved')
  const recolored = structuredClone(effective); recolored.fields[0].color = '#ff0000'
  assert.equal((await auditSourceFidelity(t, recolored, c.content!)).status, 'failed')
})
test('source ledger distinguishes unresolved objects from complete coverage and rejects false ownership', () => {
  const t = familyFixture('bare'), elements = t.sourceLayout!.text.map(s => ({ id: s.element.id, name: s.element.name, kind: 'text', slide: 1, properties: { ...s.element } }))
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'a'.repeat(64), name: 'Independent example', slideCount: 1, assets: [], fonts: [], colors: [], limitations: [], slides: [{ id: 's01', number: 1, width: 1000, height: 600, part: 'ppt/slides/slide1.xml', text: '', warnings: [] }], elements }
  const scene = readSourceScene(snapshot), ids = elements.map(e => e.id)
  const slide = { blocks: [{ sourceIds: [ids[0]] }], objectRoles: { background: [], decoration: [], context: [], unresolved: [ids[1]] } }
  assert.equal(sourceCoverage(slide, ids, scene).complete, false)
  const oldLedger = sourceCoverage(slide, ids, scene), originalLedger = JSON.stringify(oldLedger)
  assert.equal(updatedSourceCoverage(oldLedger, [{ sourceIds: ids }], scene).complete, true)
  assert.equal(updatedSourceCoverage(oldLedger, slide.blocks, scene).complete, false)
  assert.equal(JSON.stringify(oldLedger), originalLedger)
  assert.deepEqual(sourceCoverage({ ...slide, objectRoles: undefined }, ids, scene).unassigned, [ids[1]])
  assert.equal(sourceCoverage({ blocks: [t], objectRoles: { background: [], decoration: [], context: [], unresolved: [] } }, ids, scene).complete, true)
  t.adaptation = { version: 'component-intent-1', family: 'number-caption', fields: [{ sourceId: 'foreign-object', part: 'whole', role: 'number' }], layouts: [{ state: 'vertical', textAlign: 'source', position: 'top' }], rationale: 'Invalid model output' }
  assert.ok(intentIssues(t as Parameters<typeof intentIssues>[0], scene).includes('unowned-adaptive-field:foreign-object'))
})
test('fidelity catches missing or distorted artwork, changed fonts and missing content', async () => {
  for (const kind of ['media', 'badge', 'quote'] as const) {
    const t = familyFixture(kind), c = await sourceCandidate(t, 'fidelity'), p = c.profile!
    assert.equal((await auditSourceFidelity(t, p, c.content!)).status, 'preserved')
    const changed = structuredClone(p); changed.fields[0].font = 'Invented font'
    assert.equal((await auditSourceFidelity(t, changed, c.content!)).status, 'failed')
    if (p.artwork) { const lost = structuredClone(p); delete lost.artwork; assert.equal((await auditSourceFidelity(t, lost, c.content!)).status, 'failed') }
    assert.equal((await auditSourceFidelity(t, p, { ...c.content, [p.fields[0].id]: 'Lost text' })).status, 'failed')
  }
})
