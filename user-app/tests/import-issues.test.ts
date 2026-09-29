import test from 'node:test'
import assert from 'node:assert/strict'
import { labCatalog } from '../component-lab/fixtures'
import { importIssueView, reconstructionOmissions } from '../lib/design-system/import-issues'
import { RECONSTRUCTION_VERSION, type ReconstructionResult } from '../lib/design-system/reconstruction-contract'

test('a qualified component accounts for a historical omission without rewriting history', () => {
  const catalog = labCatalog(), template = catalog.families[0].variants[0]
  catalog.qualification!.catalogId = catalog.id
  const omission = { name: 'Skipped card', elementIds: [...template.sourceIds], slides: [template.slide], reason: 'Missing field' }
  const before = JSON.stringify({ catalog, omission }), result = importIssueView([omission], catalog)
  assert.equal(result.omissions.length, 0)
  assert.deepEqual(result.accounted.map(a => a.componentId), [template.id])
  assert.equal(JSON.stringify({ catalog, omission }), before)
})

test('partial overlap, wrong slide, missing qualification and mere compositions do not hide omissions', () => {
  for (const mode of ['partial', 'slide', 'unqualified', 'stale', 'composition', 'empty'] as const) {
    const catalog = labCatalog(), template = catalog.families[0].variants[0]
    catalog.qualification!.catalogId = catalog.id
    const omission = { name: 'Skipped card', elementIds: [...template.sourceIds], slides: [template.slide], reason: 'Missing field' }
    if (mode === 'partial') omission.elementIds.push('missing-caption')
    if (mode === 'slide') omission.slides = [999]
    if (mode === 'unqualified') catalog.qualification!.checks.find(c => c.id === template.id)!.passed = false
    if (mode === 'stale') catalog.qualification!.catalogId = 'stale'
    if (mode === 'composition') template.kind = 'composition'
    if (mode === 'empty') omission.elementIds = []
    assert.equal(importIssueView([omission], catalog).omissions.length, 1, mode)
  }
})

test('failed graphics appear in omissions but intentionally retained photos do not', () => {
  const photo: ReconstructionResult = { id: 'photo', name: 'Photo', description: '', status: 'retained', reason: 'Source photo preserved', candidate: { id: 'photo', name: 'Photo', sourceIds: ['image'], componentIds: [], slides: [2] } }
  const failed = { ...photo, id: 'failed', recognitionIssue: 'QWEN_HTTP_400', reason: 'Image rejected' }
  const result = reconstructionOmissions({ version: RECONSTRUCTION_VERSION, id: 'graphics', sourceCatalogId: 'source', editableCatalogId: 'cards', results: [photo, failed] })
  assert.deepEqual(result, [{ name: 'Photo', elementIds: ['image'], slides: [2], reason: 'Image rejected' }])
})
