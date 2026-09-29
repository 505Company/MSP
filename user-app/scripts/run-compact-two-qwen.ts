import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { diagnosticBucket, digest, inventory, loadJson, saveJson } from './pixel-pilot-store'
import { beginModelRun, type ModelRun } from '../lib/uploads/model-run'
import { routeraiConfig } from '../lib/uploads/routerai'
import { modelIdentity, structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { pixelComponentCatalog, validatePixelBrief, validatePixelPlan, type PixelEnvironment } from '../lib/presentations/pixel-contract'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import { compactDesignerTask, compactTypesetterTask, compactDiagnosticTask, taskSize, COMPACT_TWO_QWEN_VERSION } from '../lib/presentations/compact-two-qwen-task'
import type { PixelReport } from '../browser/pixel-layout'

const sourceDir = 'outputs/diagnostics/qwen-pixel-service', root = 'outputs/diagnostics/qwen-fast-comparison/compact-v1'
const origin = 'http://127.0.0.1:5184', request = process.argv.includes('--request'), slide = process.argv.includes('--slide')
const mode = slide ? 'slide' : 'probe', output = `${root}/${mode}`
const startedAt = new Date().toISOString(), started = performance.now(), elapsed = () => Math.round(performance.now() - started)
if (request && await loadJson(`${output}/run-start.json`)) throw Error('This named run already started: no replay or budget reset')
const snapshot = await loadJson(`${sourceDir}/source.json`), budgetBefore = await loadJson(`${sourceDir}/experiment.json`)
if (digest(snapshot) !== budgetBefore.identity.sourceHash) throw Error('Frozen source changed')
const prior = await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen/prepared.json')
const env: PixelEnvironment = { input: snapshot.input, compositions: snapshot.compositions, fontTokens: prior.fontTokens }
const preview = 'data:image/png;base64,' + (await readFile(`${sourceDir}/library.png`)).toString('base64')
const designer = compactDesignerTask(env, preview), probe = compactDiagnosticTask(designer)
const oldBrief = await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen-resumed/designer-reused.json')
const oldEvidence = await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen-resumed/text-evidence.json')
const illustrativeTypesetter = compactTypesetterTask(env, oldBrief.brief, oldBrief.briefHash, oldEvidence)
const sizes = {
  designer: { before: taskSize(await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen/designer-request.json')), after: taskSize(designer) },
  typesetter: { before: taskSize(await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen-resumed/typesetter-request.json')), after: taskSize(illustrativeTypesetter) },
  probe: taskSize(probe), note: 'Typesetter comparison uses the same earlier brief/evidence only to measure packet size; a new slide uses a fresh designer.' }
const identity = { version: COMPACT_TWO_QWEN_VERSION, sourceHash: digest(snapshot), designerTaskHash: digest(designer), probeTaskHash: digest(probe), fontTokens: env.fontTokens }
const previous = await loadJson(`${root}/prepared.json`)
if (previous && digest(previous) !== digest(identity)) throw Error('Prepared compact request changed: use a new version')
await mkdir(root, { recursive: true })
if (!previous) {
  await saveJson(`${root}/prepared.json`, identity)
  await saveJson(`${root}/designer-request.json`, designer)
  await saveJson(`${root}/probe-request.json`, probe)
  await saveJson(`${root}/typesetter-example-request.json`, illustrativeTypesetter)
  await saveJson(`${root}/sizes.json`, sizes)
}
if (!request) { console.log(JSON.stringify({ prepared: true, modelCalls: 0, root, sizes })); process.exit(0) }
const requiredUsed = slide ? 27 : 26
if (budgetBefore.used !== requiredUsed || ![26, 29].includes(budgetBefore.maxRequests)) throw Error('Unexpected shared budget: no reset or automatic retry')
if (slide) {
  const probeResult = await loadJson(`${root}/probe/result.json`), review = await loadJson(`${root}/probe/review.json`)
  // The probe observed writes from a concurrently running, unrelated import.
  // Retain its failed global-inventory assertion; accept only the separately
  // reviewed transport result, tied to these exact records and frozen source.
  const reviewedTransport = review?.transportPassed && review.resultHash === digest(probeResult) && review.frozenSourceUnchanged
  if (!probeResult?.technicalPass || probeResult.failure || (!probeResult.passed && !reviewedTransport)) throw Error('A successful small transport diagnostic must precede the slide')
}
const lock = await open(`${sourceDir}/running.lock`, 'wx')
const protectedRows = () => inventory().filter(r => !/^(processing-worker|fonts)\//.test(r.key)), before = protectedRows()
const config = { ...routeraiConfig(process.env), timeoutMs: slide ? 240_000 : 120_000 }, bucket = diagnosticBucket(output)
const stages: { stage: string; elapsedMs: number; finishedAtMs: number }[] = [], runs: ModelRun[] = []
const browserErrors: string[] = [], blocked: string[] = []
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, rendered: PixelReport | undefined, failure: string | undefined
let newRequests = 0, probePassed = false
try {
  await saveJson(`${output}/run-start.json`, { ...identity, startedAt, mode, budgetBefore: { used: budgetBefore.used, limit: budgetBefore.maxRequests },
    maxNewRequests: slide ? 2 : 1, authorization: 'User said «ок, делаем» to the selected sequence: fix diagnostics, compact both tasks, run a small diagnostic, then retry the full slide. At most one diagnostic and one two-call slide; no retries.' })
  await saveJson(`${output}/inventory-before.json`, before)
  const execute = async <T>(name: string, task: StructuredRequest, validate: (value: unknown) => T) => {
    await saveJson(`${output}/${name}-request.json`, task)
    await saveJson(`${output}/${name}-parameters.json`, structuredGeneration(task, config))
    const mark = performance.now()
    const job = await beginModelRun({ bucket, prefix: name, task, config, version: COMPACT_TWO_QWEN_VERSION,
      scope: { diagnostic: true, role: name, sourceHash: identity.sourceHash }, validate,
      beforeRequest: async () => {
        const budget = await loadJson(`${sourceDir}/experiment.json`)
        if (budget.used !== budget.reservations.length || budget.used !== requiredUsed + newRequests || newRequests >= (slide ? 2 : 1)) throw Error('Per-run allowance exhausted or shared counter changed')
        if (budget.maxRequests === 26 && !slide && budget.used === 26) {
          budget.maxRequests = 29
          budget.allowanceEvents.push({ at: new Date().toISOString(), previous: 26, limit: 29, usedUnchanged: 26,
            reason: 'Fresh user «ок, делаем» explicitly accepts the selected diagnostics/compaction/small-check/then-full-slide sequence. Bounded to one 2048-token diagnostic plus one two-Qwen slide, with no retries.' })
        }
        if (budget.maxRequests !== 29 || budget.used >= 29) throw Error('Current allowance exhausted')
        budget.used++; newRequests++
        budget.reservations.push({ prefix: `fast-comparison/compact-v1/${mode}/${name}`, at: new Date().toISOString() })
        await saveJson(`${sourceDir}/experiment.json`, budget)
        console.log(JSON.stringify({ stage: name, sharedUsed: budget.used, sharedLimit: budget.maxRequests, elapsedMs: elapsed() }))
      } })
    try { await job.execute?.() }
    finally {
      runs.push(job.run); stages.push({ stage: name, elapsedMs: Math.round(performance.now() - mark), finishedAtMs: elapsed() })
      await saveJson(`${output}/progress.json`, { stages, runs, newRequests })
    }
    if (job.run.status !== 'complete') throw Error(`Incomplete ${name}`)
    await saveJson(`${output}/${name}-response.json`, job.run.result)
    console.log(JSON.stringify({ stage: name, status: job.run.status, observation: job.run.provenance?.observation, usage: job.run.provenance?.usage }))
    return job.run.result!
  }
  if (!slide) {
    const expected = { sourceCount: env.input.content.length, firstId: env.input.content[0].id, lastId: env.input.content.at(-1)!.id, componentCount: pixelComponentCatalog(env).length }
    await saveJson(`${output}/expected.json`, expected)
    await execute('context-check', probe, raw => {
      if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 4 || Object.entries(expected).some(([k, v]) => (raw as Record<string, unknown>)[k] !== v)) throw new SemanticValidationError(['context-diagnostic-mismatch'])
      return raw
    })
    probePassed = true
  } else {
    browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    page.on('pageerror', e => browserErrors.push(e.message))
    await page.route('**/*', route => {
      const r = route.request(), url = new URL(r.url())
      if (url.origin === origin && ['GET', 'HEAD'].includes(r.method()) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
      blocked.push(`${r.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
    })
    await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
    await page.goto(`${origin}/processing-worker`)
    const fonts = await page.evaluate(async input => {
      const path = '/browser/layout-fonts.ts'
      return (await (await import(path) as typeof import('../browser/layout-fonts')).prepareLayoutFonts(input)).fontTokens
    }, snapshot.input)
    if (digest(fonts) !== digest(env.fontTokens)) throw Error('Available fonts changed after preparation')
    stages.push({ stage: 'source-fonts-browser', elapsedMs: elapsed(), finishedAtMs: elapsed() })
    const brief = await execute('designer', designer, raw => validatePixelBrief(raw, env, layoutStates.map(s => s.id)))
    const measuredAt = performance.now()
    const evidence = await page.evaluate(async ({ env, brief }) => {
      const path = '/browser/pixel-text-evidence.ts'
      return (await import(path) as typeof import('../browser/pixel-text-evidence')).measurePixelTextEvidence(env, brief)
    }, { env, brief })
    await saveJson(`${output}/text-evidence.json`, evidence)
    stages.push({ stage: 'text-measurements', elapsedMs: Math.round(performance.now() - measuredAt), finishedAtMs: elapsed() })
    const briefHash = digest(brief)
    const plan = await execute('typesetter', compactTypesetterTask(env, brief, briefHash, evidence), raw => validatePixelPlan(raw, brief, briefHash, env))
    const renderAt = performance.now(), planHash = digest(plan)
    rendered = await page.evaluate(async ({ env, brief, plan, planHash }) => {
      const path = '/browser/pixel-layout.ts'
      return (await import(path) as typeof import('../browser/pixel-layout')).renderPixelLayout(env, brief, plan, planHash)
    }, { env, brief, plan, planHash })
    const { preview: png, ...report } = rendered
    await writeFile(`${output}/slide.png`, Buffer.from(png.split(',')[1], 'base64')); await saveJson(`${output}/measurement.json`, report)
    stages.push({ stage: 'render-and-checks', elapsedMs: Math.round(performance.now() - renderAt), finishedAtMs: elapsed() })
  }
} catch (e) { failure = String(e); console.log(JSON.stringify({ failure, elapsedMs: elapsed() })) }
finally {
  const elapsedMs = elapsed()
  await browser?.close(); await lock.close(); await unlink(`${sourceDir}/running.lock`)
  const after = protectedRows(), unchanged = digest(before) === digest(after), budget = await loadJson(`${sourceDir}/experiment.json`)
  await saveJson(`${output}/inventory-after.json`, after)
  const technicalPass = slide ? !!rendered?.passed && !!rendered.geometryUnchanged : probePassed
  const passed = technicalPass && unchanged && !failure && !browserErrors.length && !blocked.length
  const result = { version: COMPACT_TWO_QWEN_VERSION, mode, startedAt, finishedAt: new Date().toISOString(), elapsedMs,
    passed, technicalPass, targetMs: slide ? 300_000 : null, generationWithinTarget: slide ? passed && elapsedMs <= 300_000 : null,
    visualReview: rendered ? 'pending-local-inspection' : 'not-run-no-png', failure, newRequests, sharedUsed: budget.used, sharedLimit: budget.maxRequests,
    sourceHash: identity.sourceHash, model: modelIdentity(config), stages, runs, unchanged, browserErrors, blocked,
    modelAnswerReused: false, sourceSnapshotReused: true, coldBrowser: slide, manualSlideEdits: false, applicationWritesByThisRun: 0,
    measurement: slide ? 'Fresh designer and typesetter, cold browser/fonts, text measurements and PNG technical checks. Earlier diagnostic and later visual inspection excluded.'
      : 'Short context-reading diagnostic using the compact designer input, reasoning=low, max_tokens=2048. Not a slide-generation benchmark.' }
  await saveJson(`${output}/result.json`, result)
  await saveJson(`${output}/preservation.json`, { beforeHash: digest(before), afterHash: digest(after), unchanged })
  console.log(JSON.stringify({ passed, mode, elapsedMs, newRequests, sharedUsed: budget.used, output }))
  if (!passed) process.exitCode = 1
}
