/** Local read-only replay. The page has no app scripts, and every write/model
 * request is blocked. Diagnostics are saved outside application storage. */
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { applicationSnapshot, saveJson, loadJson } from './pixel-pilot-store'
import { compileEditableSlides, readEditableCatalog } from '../lib/design-system/editable-analysis'
import { sourceCandidate } from '../lib/component-lab/source'
import { applyRules, emptyRules } from '../lib/component-lab/rules'
import { auditSourceFidelity } from '../lib/component-lab/fidelity'
import { catalogCandidates } from '../lib/component-lab/candidates'
import { validateProof } from '../lib/component-lab/proof'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION, type EditableReply } from '../lib/design-system/editable-contract'
import { contentHash } from '../lib/design-system/catalog'
import type { EditableCatalog } from '../lib/design-system/editable-contract'
import type { PreparationJob } from '../lib/component-lab/preparation-jobs'

const upload = process.argv[2], output = process.argv[3]
if (!/^[a-f0-9-]{36}$/.test(upload ?? '') || !output?.startsWith('outputs/')) throw Error('Usage: audit-rejected-components.ts UPLOAD outputs/DIRECTORY')
const snapshot = applicationSnapshot()
let catalog = await readEditableCatalog(snapshot.bucket, upload)
// An older compiler's immutable catalog is still useful diagnostic evidence.
// Read it explicitly; never publish or relabel its old qualification as current.
if (!catalog) {
 const pointer = await snapshot.read(`editable-systems/${upload}/${EDITABLE_VERSION}/current.json`)
 if (pointer) {
  catalog = await snapshot.read(pointer.key) as EditableCatalog
  const reports = snapshot.rows.filter(r => r.key.startsWith(`editable-systems/${upload}/${EDITABLE_VERSION}/qualifications/${catalog!.id}/`)).sort((a, b) => b.key.localeCompare(a.key, 'en', { numeric: true }))
  if (reports[0]) catalog.qualification = await snapshot.read(reports[0].key)
 }
}
if (!catalog?.qualification) throw Error('No qualified catalog')
const jobs = await snapshot.read(`component-preparation/${upload}/jobs.json`) as PreparationJob[]
let rejected = jobs.filter(j => j.input && (process.argv.includes('--all-adaptive') || j.result && !j.result.generationAdmission))
const failed = new Set(catalog.qualification.checks.filter(c => !c.passed).map(c => c.id))
if (process.argv.includes('--recompile')) {
 const manifest = await snapshot.read(`visual/${upload}/manifest.json`)
 const parts = await Promise.all(snapshot.rows.filter(r => r.key.startsWith(`editable-systems/${upload}/${EDITABLE_VERSION}/${catalog.sourceRevision}/parts/`)).map(r => snapshot.read(r.key)))
 if (!parts.length) throw Error('No saved recognition parts')
 parts.sort((a, b) => a.slides[0] - b.slides[0])
 const compiled = await compileEditableSlides(manifest.snapshot, parts.flatMap(p => (p.reply as EditableReply).slides), upload)
 await saveJson(`${output}/recompiled.json`, compiled)
 catalog.families = compiled.families
 const omissions = [...parts.flatMap(p => p.omissions ?? []), ...compiled.omissions]
 catalog.id = await contentHash({ version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, revision: catalog.sourceRevision, families: compiled.families, coverage: compiled.coverage, ...(omissions.length ? { omissions } : {}) })
 catalog.compilerVersion = EDITABLE_COMPILER_VERSION
 for (const job of rejected) {
  const template = catalog.families.flatMap(f => f.variants).find(t => t.id === job.componentId)
  if (!template) throw Error(`No recompiled ${job.componentId}`)
  const candidate = await sourceCandidate(template, catalog.id)
  if (!candidate.profile || !candidate.content) throw Error(`${job.componentId}: ${candidate.reason}`)
  job.input = { ...job.input!, profile: await applyRules(candidate.profile, job.input!.rules), content: candidate.content }
 }
}
if (process.argv.includes('--refresh-profiles')) {
 const candidates = await catalogCandidates(snapshot.bucket, upload, catalog)
 await saveJson(`${output}/source-candidates.json`, candidates.map(c => ({ id: c.template.id, name: c.template.name, reason: c.reason, family: 'profile' in c ? c.profile?.family : undefined })))
 rejected = []
 for (const c of candidates) {
  if (!('profile' in c) || !c.profile || !c.content) continue
  const previous = jobs.find(j => j.componentId === c.template.id)!
  const rules = previous.input?.rules ?? emptyRules(), profile = await applyRules(c.profile, rules)
  const fidelity = await auditSourceFidelity(c.template, profile, c.content)
  await saveJson(`${output}/${c.template.id}-fidelity.json`, fidelity)
  rejected.push({ ...previous, input: { ...previous.input, profile, rules, content: c.content, assets: previous.input?.assets ?? [], fontSource: previous.input?.fontSource ?? '', ruleRevision: previous.input?.ruleRevision ?? null } })
 }
}
if (process.argv.includes('--html-only')) rejected = []
const templates = catalog.families.flatMap(f => f.variants).filter(t => failed.has(t.id))
const bundle = await build({ stdin: { contents: `export {sourceFonts} from './browser/component-lab/fonts'; export {checkQuality,qualityProof} from './browser/component-lab/qualification'; export {measureComponent,pixelEvidence,renderCommittedComponent} from './browser/component-lab/measure'; export {qualifyEditableCatalog} from './lib/design-system/editable-qualification'; export {renderEditableHtml} from './lib/design-system/editable-render'; export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';`, resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Audit', write: false })
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
await mkdir(output, { recursive: true })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
 await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.pathname === '/__read-only-component-audit') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>' })
  if (url.origin !== 'http://127.0.0.1:5184' || request.method() !== 'GET' || !/^\/(fonts\/|api\/(uploads\/[^/]+\/(assets\/|fonts)|fonts\/google))/.test(url.pathname)) return route.abort('blockedbyclient')
  return route.continue()
 })
 await page.goto('http://127.0.0.1:5184/__read-only-component-audit')
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const results = []
 for (const job of rejected) {
  const result = await page.evaluate(async ({ input, upload, matrix }) => {
   const api = (window as unknown as { Audit: typeof import('../browser/component-lab/fonts') & typeof import('../browser/component-lab/measure') & typeof import('../browser/component-lab/qualification') }).Audit
   const host = document.createElement('div'); document.body.replaceChildren(host)
   const fonts = await api.sourceFonts(upload, input.profile, true)
   const profile = input.profile
   const measured = await api.measureComponent(profile, input.content, { width: profile.maxWidth, maxHeight: profile.maxHeight, widthMode: 'fill', heightMode: 'hug' }, fonts, { target: host })
   const pixels = measured.chosen && await api.pixelEvidence(host.firstElementChild as HTMLElement, measured.chosen, fonts)
   const proof = matrix ? api.qualityProof(await api.checkQuality(profile, fonts)) : undefined
   return { status: measured.status, issues: measured.issues, pixels, artwork: fonts.artwork, html: host.innerHTML, proof }
  }, { input: job.input!, upload, matrix: process.argv.includes('--matrix') })
  const { artwork, html, ...summary } = result
  await saveJson(`${output}/${job.componentId}-replay.json`, summary)
  await writeFile(`${output}/${job.componentId}.html`, html)
  if (artwork) {
   await writeFile(`${output}/${job.componentId}-artwork.svg`, Buffer.from(artwork.url.split(',')[1], 'base64'))
  }
  await page.screenshot({ path: `${output}/${job.componentId}.png` })
  results.push({ id: job.componentId, ...summary })
  console.log(job.componentId, result.status, result.pixels?.artwork, result.pixels?.passed)
  if (result.proof) {
   const checked = await validateProof(job.input!.profile, result.proof)
   await saveJson(`${output}/${job.componentId}-matrix.json`, checked)
   console.log('matrix', job.componentId, checked.technical, checked.coverage)
  }
 }
 await saveJson(`${output}/adaptive-replay.json`, results)
 const report = await page.evaluate(async catalog => {
  const api = (window as unknown as { Audit: typeof import('../lib/design-system/editable-qualification') }).Audit
  return api.qualifyEditableCatalog(catalog)
 }, process.argv.includes('--all-html') ? catalog : { ...catalog, families: [{ ...catalog.families[0], variants: templates }] })
 await saveJson(`${output}/html-replay.json`, report)
 console.log('HTML', report.checks.length, 'passed', report.checks.filter(c => c.passed).length, 'failed', report.checks.filter(c => !c.passed))
 const proposals = await loadJson(`${output}/refinement-candidates.json`) as { slide: number; candidate: { catalog: EditableCatalog } }[] | null
 if (proposals) {
  const checks = []
  for (const proposal of proposals) {
   const report = await page.evaluate(async catalog => (window as unknown as { Audit: typeof import('../lib/design-system/editable-qualification') }).Audit.qualifyEditableCatalog(catalog), proposal.candidate.catalog)
   checks.push({ slide: proposal.slide, report })
   console.log('Saved refinement', proposal.slide, report.checks.length, 'passed', report.checks.filter(c => c.passed).length)
  }
  await saveJson(`${output}/refinement-qualification.json`, checks)
 }
} finally { await browser.close() }
