import { applicationSnapshot, digest, loadJson, saveJson } from './pixel-pilot-store'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { readScanRun } from '../lib/design-system/semantic-scan'
import { readCalibrationOmissions } from '../lib/design-system/calibration'
import { importIssueView } from '../lib/design-system/import-issues'
import type { PreparationJob, PreparedComponent } from '../lib/component-lab/preparation-jobs'

// Read-only replay. This bucket cannot publish catalog edits or call a model.
const [upload, output] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(upload ?? '') || !output) throw Error('Usage: check-import-omissions.ts <upload-id> <diagnostic-directory>')
const store = applicationSnapshot(), catalog = await readEditableCatalog(store.bucket, upload)
if (!catalog) throw Error('Editable catalog is unavailable')
const [scan, calibration, jobs, baseline] = await Promise.all([
  readScanRun(store.bucket, upload), readCalibrationOmissions(store.bucket, upload),
  store.read(`component-preparation/${upload}/jobs.json`) as Promise<PreparationJob[]>,
  loadJson(`${output}/before.json`) as Promise<{ checkedAt: string; hashes: Record<string, string> } | null>,
])
const view = importIssueView([...scan?.omissions ?? [], ...catalog.omissions ?? [], ...calibration], catalog)
const preparation = await Promise.all((jobs ?? []).filter(j => j.result).map(async job => {
  const result = await store.read(job.result!.key) as PreparedComponent
  return { id: job.componentId, name: job.name, admitted: result.generationAdmission, technical: result.technical,
    sourceFidelity: result.sourceFidelity, sourceStatus: result.source.check.status, sourcePassed: result.source.passed,
    minimumContrast: Math.min(...result.source.check.pixels?.map(p => p.contrast) ?? [21]), coverage: result.coverage }
}))
const hashes: Record<string, string> = {}
for (const row of store.rows.filter(r => r.key.includes(upload) && r.key.endsWith('.json'))) hashes[row.key] = digest(await store.read(row.key))
const changed = baseline ? Object.keys(baseline.hashes).filter(k => hashes[k] !== baseline.hashes[k]) : []
const added = baseline ? Object.keys(hashes).filter(k => !(k in baseline.hashes)) : []
const response = (k: string) => /\/responses\/|\/response\.json$/.test(k)
const job = await store.read(`processing-jobs/${upload}.json`)
const summary = {
  checkedAt: new Date().toISOString(), upload, importStatus: job?.status,
  catalog: { id: catalog.id, families: catalog.families.length, variants: catalog.families.reduce((n, f) => n + f.variants.length, 0),
    htmlPassed: catalog.qualification?.checks.filter(c => c.passed).length, htmlFailed: catalog.qualification?.checks.filter(c => !c.passed) },
  issues: view,
  preparation: { jobs: jobs?.length ?? 0, statuses: Object.fromEntries([...new Set(jobs?.map(j => j.status))].map(status => [status, jobs.filter(j => j.status === status).length])),
    admitted: preparation.filter(p => p.admitted).length, results: preparation },
  storage: { baseline: baseline?.checkedAt, compared: Object.keys(baseline?.hashes ?? {}).length, changed,
    immutableChanges: changed.filter(k => k !== `component-preparation/${upload}/jobs.json`), added,
    addedModelResponses: added.filter(response), changedModelResponses: changed.filter(response) },
}
await saveJson(`${output}/verification.json`, summary)
await saveJson(`${output}/after.json`, { checkedAt: summary.checkedAt, hashes })
console.log(JSON.stringify({ importStatus: summary.importStatus, catalog: summary.catalog, pending: view.omissions.length, accounted: view.accounted.length,
  preparation: { ...summary.preparation, results: undefined }, storage: { ...summary.storage, added: added.length } }, null, 2))
