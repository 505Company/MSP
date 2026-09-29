import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { diagnosticBucket, digest, inventory, loadJson, saveJson } from './pixel-pilot-store'
import { beginModelRun, readModelRun, type ModelRun } from '../lib/uploads/model-run'
import { routeraiConfig } from '../lib/uploads/routerai'
import { modelIdentity, structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { validatePixelBrief, validatePixelPlan, type PixelEnvironment } from '../lib/presentations/pixel-contract'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import { fastTwoQwenProfile, fastTwoDesignerTask, fastTwoTypesetterTask } from '../lib/presentations/fast-two-qwen-task'
import type { PixelReport } from '../browser/pixel-layout'

const sourceDir = 'outputs/diagnostics/qwen-pixel-service', resumeTypesetter = process.argv.includes('--resume-typesetter')
const output = `outputs/diagnostics/qwen-fast-comparison/${resumeTypesetter ? 'two-qwen-resumed' : 'two-qwen'}`
const origin = 'http://127.0.0.1:5184', request = process.argv.includes('--request')
if (request && await loadJson(`${output}/run-start.json`)) throw Error('This named run already started; no replay or budget reset')
const startedAt = new Date().toISOString(), started = performance.now(), elapsed = () => Math.round(performance.now() - started)
const snapshot = await loadJson(`${sourceDir}/source.json`), budgetBefore = await loadJson(`${sourceDir}/experiment.json`)
if (!snapshot || digest(snapshot) !== budgetBefore.identity.sourceHash) throw Error('The frozen source changed')
const protectedRows = () => inventory().filter(r => !/^(processing-worker|fonts)\//.test(r.key)), before = protectedRows()
await mkdir(output, { recursive: true })
const lock = await open(`${sourceDir}/running.lock`, 'wx'), config = { ...routeraiConfig(process.env), timeoutMs: fastTwoQwenProfile.transportTimeoutMs }
const bucket = diagnosticBucket(output), runs: ModelRun[] = [], stages: { stage: string; elapsedMs: number; finishedAtMs: number }[] = []
let reusedDesigner: { runId: string; prefix: string; briefHash: string; sourceHash: string } | undefined
let newRequests = 0, failure: string | undefined, rendered: PixelReport | undefined
const browserErrors: string[] = [], blocked: string[] = []
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  if (request) {
    if (budgetBefore.maxRequests !== 26 || budgetBefore.used !== (resumeTypesetter ? 25 : 24)) throw Error('Requires the explicitly approved 24→26 allowance, without a budget reset')
    await saveJson(`${output}/run-start.json`, { startedAt, sourceHash: digest(snapshot), budgetBefore: { used: budgetBefore.used, limit: budgetBefore.maxRequests },
      profile: fastTwoQwenProfile, resumeTypesetter, authorization: 'User explicitly approved increasing 24→26 and requested two sequential Qwen roles trying to finish within five minutes.' })
  }
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
  const fontTokens = await page.evaluate(async input => {
    const path = '/browser/layout-fonts.ts'
    const { prepareLayoutFonts } = await import(path) as typeof import('../browser/layout-fonts')
    return (await prepareLayoutFonts(input)).fontTokens
  }, snapshot.input)
  const env: PixelEnvironment = { input: snapshot.input, compositions: snapshot.compositions, fontTokens }
  let retainedBrief: ReturnType<typeof validatePixelBrief> | undefined
  if (resumeTypesetter) {
    const failed = await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen/result.json')
    if (!failed?.failure || failed.newRequests !== 1 || failed.runs[0]?.status !== 'failed') throw Error('Resume requires a preserved terminal failure of the fresh designer')
    const selection = await loadJson(`${sourceDir}/designer-selected.json`)
    const previous = await readModelRun(diagnosticBucket(sourceDir), selection.prefix)
    if (previous?.status !== 'complete' || previous.scope.sourceHash !== digest(snapshot) || digest(previous.model) !== digest(modelIdentity(config))) throw Error('No verified designer for the identical source and provider')
    retainedBrief = validatePixelBrief(previous.result, env, layoutStates.map(s => s.id))
    reusedDesigner = { runId: previous.id, prefix: selection.prefix, briefHash: digest(retainedBrief), sourceHash: digest(snapshot) }
    await saveJson(`${output}/designer-reused.json`, { ...reusedDesigner, brief: retainedBrief, originalRunChanged: false, newDesignerRequests: 0, note: 'Resumed from the earlier completed designer after the new designer timed out. This is not a cold two-call result.' })
  }
  const preview = 'data:image/png;base64,' + (await readFile(`${sourceDir}/library.png`)).toString('base64')
  const design = fastTwoDesignerTask(env, preview)
  const identity = { version: fastTwoQwenProfile.version, sourceHash: digest(snapshot), taskHash: resumeTypesetter ? null : digest(design), reusedDesigner, model: modelIdentity(config), fontTokens, profile: fastTwoQwenProfile }
  const saved = await loadJson(`${output}/prepared.json`)
  if (saved && digest(saved) !== digest(identity)) throw Error('Prepared designer request changed')
  if (!saved) await saveJson(`${output}/prepared.json`, identity)
  if (!resumeTypesetter) {
    await saveJson(`${output}/designer-request.json`, design)
    await saveJson(`${output}/designer-parameters.json`, structuredGeneration(design, config))
  }
  stages.push({ stage: 'source-fonts-browser', elapsedMs: elapsed(), finishedAtMs: elapsed() })
  if (!request) console.log(JSON.stringify({ prepared: true, modelCalls: 0, output, sourceHash: identity.sourceHash, fontTokens }))
  else {
    const execute = async <T>(prefix: string, task: StructuredRequest, validate: (raw: unknown) => T) => {
      if (await readModelRun(bucket, prefix)) throw Error('A model stage cannot be replayed')
      await saveJson(`${output}/${prefix}-request.json`, task)
      const mark = performance.now()
      const current = await beginModelRun({ bucket, prefix, task, config, version: fastTwoQwenProfile.version,
        scope: { diagnostic: true, sourceHash: identity.sourceHash, role: prefix },
        validate: raw => { try { return validate(raw) } catch (e) { if (e instanceof SemanticValidationError) throw e; throw new SemanticValidationError([String(e).slice(0, 2500)]) } },
        beforeRequest: async () => {
          const budget = await loadJson(`${sourceDir}/experiment.json`)
          if (budget.used !== budget.reservations.length || budget.maxRequests !== 26 || budget.used >= 26 || newRequests >= (resumeTypesetter ? 1 : 2)) throw Error('Approved allowance exhausted')
          budget.used++; newRequests++; budget.reservations.push({ prefix: `fast-comparison/${resumeTypesetter ? 'two-qwen-resumed' : 'two-qwen'}/${prefix}`, at: new Date().toISOString() })
          await saveJson(`${sourceDir}/experiment.json`, budget)
          console.log(JSON.stringify({ stage: prefix, newRequests, sharedUsed: budget.used, sharedLimit: budget.maxRequests, elapsedMs: elapsed() }))
        } })
      try { await current.execute?.() }
      finally {
        runs.push(current.run)
        stages.push({ stage: prefix, elapsedMs: Math.round(performance.now() - mark), finishedAtMs: elapsed() })
        await saveJson(`${output}/progress.json`, { stages, runs, newRequests })
      }
      if (current.run.status !== 'complete') throw Error(JSON.stringify(current.run.error))
      await saveJson(`${output}/${prefix}-response.json`, current.run.result)
      return current.run.result!
    }
    const brief = retainedBrief ?? await execute('designer', design, raw => validatePixelBrief(raw, env, layoutStates.map(s => s.id)))
    const measuredAt = performance.now()
    const evidence = await page.evaluate(async ({ env, brief }) => {
      const path = '/browser/pixel-text-evidence.ts'
      const { measurePixelTextEvidence } = await import(path) as typeof import('../browser/pixel-text-evidence')
      return measurePixelTextEvidence(env, brief)
    }, { env, brief })
    await saveJson(`${output}/text-evidence.json`, evidence)
    stages.push({ stage: 'text-measurements', elapsedMs: Math.round(performance.now() - measuredAt), finishedAtMs: elapsed() })
    const briefHash = digest(brief), typesetting = fastTwoTypesetterTask(env, brief, briefHash, evidence)
    await saveJson(`${output}/typesetter-parameters.json`, structuredGeneration(typesetting, config))
    const plan = await execute('typesetter', typesetting, raw => validatePixelPlan(raw, brief, briefHash, env))
    const renderAt = performance.now(), planHash = digest(plan)
    rendered = await page.evaluate(async ({ env, brief, plan, planHash }) => {
      const path = '/browser/pixel-layout.ts'
      const { renderPixelLayout } = await import(path) as typeof import('../browser/pixel-layout')
      return renderPixelLayout(env, brief, plan, planHash)
    }, { env, brief, plan, planHash })
    const { preview: png, ...report } = rendered
    await writeFile(`${output}/slide.png`, Buffer.from(png.split(',')[1], 'base64'))
    await saveJson(`${output}/measurement.json`, report)
    stages.push({ stage: 'render-and-geometry-checks', elapsedMs: Math.round(performance.now() - renderAt), finishedAtMs: elapsed() })
    console.log(JSON.stringify({ technicalPass: rendered.passed, geometryUnchanged: rendered.geometryUnchanged, issues: rendered.issues, elapsedMs: elapsed() }))
  }
} catch (e) { failure = String(e); console.log(JSON.stringify({ failure, elapsedMs: elapsed() })) }
finally {
  const completedAtMs = elapsed()
  await browser?.close(); await lock.close(); await unlink(`${sourceDir}/running.lock`)
  if (request) {
    const after = protectedRows(), unchanged = digest(before) === digest(after), budget = await loadJson(`${sourceDir}/experiment.json`)
    const technicalPass = !!rendered?.passed && rendered.geometryUnchanged && unchanged && !failure && !browserErrors.length && !blocked.length
    const result = { version: fastTwoQwenProfile.version, mode: resumeTypesetter ? 'two-qwen-resumed' : 'two-qwen', startedAt, finishedAt: new Date().toISOString(), elapsedMs: completedAtMs,
      targetMs: fastTwoQwenProfile.targetMs, withinTarget: completedAtMs <= fastTwoQwenProfile.targetMs, technicalPass,
      generationWithinTarget: technicalPass && completedAtMs <= fastTwoQwenProfile.targetMs, visualReview: rendered ? 'pending-local-inspection' : 'not-run-no-png',
      failure, sourceHash: digest(snapshot), model: modelIdentity(config), profile: fastTwoQwenProfile,
      newRequests, sharedUsed: budget.used, sharedLimit: budget.maxRequests, unchanged, browserErrors, blocked, stages,
      runs: runs.map(r => ({ id: r.id, status: r.status, cacheHit: r.cacheHit, error: r.error, provenance: r.provenance, attempts: r.attempts })),
      sourceSnapshotReused: true, modelAnswerReused: resumeTypesetter, reusedDesigner, coldBrowser: true, manualSlideEdits: false, productionProjectChanged: false,
      measurement: resumeTypesetter
        ? 'Fresh browser/fonts, reuse of the earlier completed designer brief for the identical source, browser text measurements, fresh Qwen typesetter, exact PNG rendering and local technical checks. Earlier designer time, the failed fresh designer attempt and subsequent Codex visual inspection are outside this resumed-generation clock.'
        : 'Fresh browser/fonts, fresh Qwen designer, browser text measurements, fresh Qwen typesetter, exact PNG rendering and local technical checks. Library import, source fragmentation and subsequent Codex visual inspection are outside this generation clock.' }
    await saveJson(`${output}/result.json`, result)
    await saveJson(`${output}/preservation.json`, { beforeHash: digest(before), afterHash: digest(after), unchanged })
    console.log(JSON.stringify({ technicalPass, generationWithinTarget: result.generationWithinTarget, elapsedMs: completedAtMs, newRequests, output }))
    if (!result.generationWithinTarget) process.exitCode = 1
  } else if (failure) process.exitCode = 1
}
