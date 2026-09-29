import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { sourceCandidate } from '../lib/component-lab/source'
import { MINIMUM_TEXT_CONTRAST, type ComponentProfile, type ComponentRules } from '../lib/component-lab/contract'
import { saveRuleRevision, readRuleHistory, readPinnedRuleProfile } from '../lib/component-lab/storage'
import { memoryBucket } from '../tests/helpers/memory-bucket'
import type { QualityReport } from '../browser/component-lab/qualification'
import type { EditableCatalog } from '../lib/design-system/editable-contract'

// Reuse a real browser measurement; exercise the production storage module
// against a temporary bucket. Never POST to the user's component API.
const folder = 'outputs/diagnostics/component-lab'
const evidence = JSON.parse(await readFile(`${folder}/report.json`, 'utf8')) as { profile: ComponentProfile; rules: ComponentRules; report: QualityReport }
const upload = process.argv[2]
if (!upload) throw Error('Pass the upload ID')
const response = await fetch(`http://127.0.0.1:5197/api/uploads/${encodeURIComponent(upload)}/editable-system`)
if (!response.ok) throw Error('Catalog read failed')
const { catalog } = await response.json() as { catalog: EditableCatalog }
const t = catalog.families.flatMap(f => f.variants).find(t => t.id === evidence.profile.id)!
const source = (await sourceCandidate(t, catalog.id)).profile!
const proof = { version: evidence.report.version, profile: evidence.report.profile, minimumContrast: MINIMUM_TEXT_CONTRAST, cases: evidence.report.cases.map(c => ({ id: c.id, status: c.measurement.status, ...(c.measurement.chosen ? { chosen: c.measurement.chosen } : {}), ...(c.evidence ? { pixels: c.evidence.pixels } : {}) })) }
const { bucket } = memoryBucket()
const saved = await saveRuleRevision(bucket, upload, source, { source: source.fingerprint, baseRevision: null, rules: evidence.rules, proof })
assert.equal(saved.technical, 'passed')
const reopened = await readRuleHistory(bucket, upload, source)
assert.equal(reopened.head, saved.id)
const pinned = await readPinnedRuleProfile(bucket, upload, source, saved.id)
assert.deepEqual(pinned.profile, evidence.profile)
const changed = structuredClone(evidence.rules); changed.states.vertical!.position = 'bottom'
await assert.rejects(() => saveRuleRevision(bucket, upload, source, { source: source.fingerprint, baseRevision: saved.id, rules: changed, proof }), /изменились/)
assert.equal((await readRuleHistory(bucket, upload, source)).head, saved.id)
const result = { component: source.id, catalog: catalog.id, storage: 'temporary R2-compatible bucket', savedAndReopened: true, pinnedProfileMatchesBrowser: true, staleProofRejected: true, productionWrites: 0, modelCalls: 0 }
await writeFile(`${folder}/rules-storage-check.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
