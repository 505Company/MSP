import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { diagnosticBucket, digest, inventory, loadJson, saveJson } from './pixel-pilot-store'
import { beginModelRun, readModelRun, type ModelRun } from '../lib/uploads/model-run'
import { routeraiConfig } from '../lib/uploads/routerai'
import { modelIdentity, structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { adaptiveReviewTask } from '../lib/presentations/adaptive-task'
import { validateAdaptiveFit, type AdaptiveRender } from '../lib/presentations/adaptive-layout'
import { pixelReviewTask, pixelReviewSchema, pixelClarification } from '../lib/presentations/pixel-task'
import type { PixelEnvironment } from '../lib/presentations/pixel-contract'
import type { PixelReport } from '../browser/pixel-layout'
import { FAST_SLIDE_VERSION, fastSlideProfile, fastAdaptiveTask, fastPixelTask, fastGeneration, validateFastAdaptive, validateFastPixel,
  adaptiveVisibleInput, adaptiveDirectionIssues, canRepairFastSlide, type FastSlideMode, type FastAdaptive } from '../lib/presentations/fast-slide-task'

const sourceDir = 'outputs/diagnostics/qwen-pixel-service'
const root = 'outputs/diagnostics/qwen-fast-comparison'
const mode = process.argv.find(a => a.startsWith('--mode='))?.slice(7) as FastSlideMode
if (!['autolayout', 'pixel'].includes(mode)) throw Error('Pass --mode=autolayout or --mode=pixel, optionally --request')
const revision = process.argv.includes('--revision=2') ? 2 : 1
const runName = `${mode}${revision === 2 ? '-2' : ''}`
const request = process.argv.includes('--request'), output = `${root}/${runName}`, origin = 'http://127.0.0.1:5184'
const planOnly = process.argv.includes('--plan-only'), requestCap = planOnly ? 1 : fastSlideProfile.maxRequestsPerRun
if (revision === 2 && !(await loadJson(`${root}/${mode}/result.json`))?.failure) throw Error('Revision 2 requires a preserved failed calibration run')
if (request && await loadJson(`${output}/run-start.json`)) throw Error('This live run already exists; no silent replay or allowance reset')
const startedAt = new Date().toISOString(), started = performance.now()
const snapshot = await loadJson(`${sourceDir}/source.json`)
if (!snapshot) throw Error('The original frozen source is required')
const originalBudget = await loadJson(`${sourceDir}/experiment.json`)
if (digest(snapshot) !== originalBudget.identity.sourceHash) throw Error('Original snapshot changed')
await mkdir(output, { recursive: true })
// Shared paid allowance and browser renderer: exclude concurrent pixel pilots.
const lock = await open(`${sourceDir}/running.lock`, 'wx')
const protectedRows = () => inventory().filter(r => !/^(processing-worker|fonts)\//.test(r.key))
const before = protectedRows()
const elapsed = () => Math.round(performance.now() - started)
const beforeBudget = originalBudget.used
const config = { ...routeraiConfig(process.env), timeoutMs: fastSlideProfile.transportTimeoutMs }
const bucket = diagnosticBucket(output), runs: ModelRun[] = [], stages: { stage: string; elapsedMs: number; finishedAtMs: number }[] = []
const browserErrors: string[] = [], blocked: string[] = []
let localRequests = 0, technicalPass = false, review: { verdict: 'pass' | 'revise'; issues: string[] } | undefined
let failure: string | undefined, pngAtMs: number | undefined, selectedAttempt: number | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  if (request) await saveJson(`${output}/run-start.json`, { startedAt, sourceHash: digest(snapshot), mode, beforeBudget, profile: fastSlideProfile, requestCap, planOnly, authorization: 'User requested both live comparisons, including permission to transmit this text, library and PNG to RouterAI/DeepInfra.' })
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
  const preview = 'data:image/png;base64,' + (await readFile(`${sourceDir}/library.png`)).toString('base64')
  let task = mode === 'autolayout' ? fastAdaptiveTask(env, preview) : fastPixelTask(env, preview)
  const identity = { version: FAST_SLIDE_VERSION, mode, revision, sourceHash: digest(snapshot), taskHash: digest(task), model: modelIdentity(config), profile: fastSlideProfile, fontTokens }
  const saved = await loadJson(`${output}/prepared.json`)
  if (saved && digest(saved) !== digest(identity)) throw Error('Prepared task identity changed')
  if (!saved) await saveJson(`${output}/prepared.json`, identity)
  await saveJson(`${output}/plan-request.json`, task)
  await saveJson(`${output}/request-parameters.json`, structuredGeneration(task, config))
  stages.push({ stage: 'source-fonts-browser', elapsedMs: elapsed(), finishedAtMs: elapsed() })
  if (!request) console.log(JSON.stringify({ prepared: true, mode, modelCalls: 0, sourceHash: identity.sourceHash, fontTokens, output }))
  else {
    const execute = async <T>(prefix: string, nextTask: StructuredRequest, validate: (raw: unknown) => T) => {
      if (await readModelRun(bucket, prefix)) throw Error(`Existing stage ${prefix} cannot be replayed`)
      await saveJson(`${output}/${prefix}-request.json`, nextTask)
      const mark = performance.now()
      const current = await beginModelRun({ bucket, prefix, task: nextTask, config, version: FAST_SLIDE_VERSION, scope: { diagnostic: true, mode, sourceHash: identity.sourceHash },
        validate: raw => { try { return validate(raw) } catch (e) { if (e instanceof SemanticValidationError) throw e; throw new SemanticValidationError([String(e).slice(0, 2000)]) } },
        beforeRequest: async () => {
          const budget = await loadJson(`${sourceDir}/experiment.json`)
          if (budget.used !== budget.reservations.length || budget.used >= budget.maxRequests || localRequests >= requestCap) throw Error('Shared allowance exhausted')
          budget.used++; localRequests++; budget.reservations.push({ prefix: `fast-comparison/${runName}/${prefix}`, at: new Date().toISOString() })
          await saveJson(`${sourceDir}/experiment.json`, budget)
          console.log(JSON.stringify({ mode, stage: prefix, localRequests, sharedUsed: budget.used, sharedLimit: budget.maxRequests, elapsedMs: elapsed() }))
        } })
      try { await current.execute?.() }
      finally {
        runs.push(current.run)
        stages.push({ stage: prefix, elapsedMs: Math.round(performance.now() - mark), finishedAtMs: elapsed() })
        await saveJson(`${output}/progress.json`, { stages, localRequests, runs })
      }
      if (current.run.status !== 'complete') throw Error(JSON.stringify(current.run.error))
      await saveJson(`${output}/${prefix}-response.json`, current.run.result)
      return current.run.result!
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prefix = `plan-${attempt}`
      let plan: FastAdaptive | ReturnType<typeof validateFastPixel>
      try {
        plan = await execute(prefix, task, raw => mode === 'autolayout' ? validateFastAdaptive(raw, env) : validateFastPixel(raw, env, digest))
      } catch (error) {
        const run = runs.at(-1)
        if (planOnly || attempt !== 1 || run?.error?.code !== 'SEMANTIC_VALIDATION' || !canRepairFastSlide(mode, elapsed())) throw error
        const response = await loadJson(`${output}/model/${prefix}/responses/${run.id}.json`)
        if (!response?.content) throw error
        task = pixelClarification(task, response.content, run.error.issues ?? [run.error.message])
        console.log(JSON.stringify({ mode, stage: 'semantic-repair', elapsedMs: elapsed(), issues: run.error.issues }))
        continue
      }
      const mark = performance.now()
      let rendered: AdaptiveRender | PixelReport, issues: string[], reviewTask: StructuredRequest
      if (mode === 'autolayout') {
        const adaptive = plan as FastAdaptive, input = adaptiveVisibleInput(env.input, adaptive.directions), planHash = digest(adaptive.plan)
        const result = await page.evaluate(async ({ input, plan, planHash }) => {
          const path = '/browser/adaptive-layout.ts', fontsPath = '/browser/layout-fonts.ts'
          const { fitAdaptiveLayout } = await import(path) as typeof import('../browser/adaptive-layout')
          const { prepareLayoutFonts } = await import(fontsPath) as typeof import('../browser/layout-fonts')
          const fonts = await prepareLayoutFonts(input)
          return fitAdaptiveLayout(input, plan, planHash, { fontCss: Object.values(fonts.css).join('\n') })
        }, { input, plan: adaptive.plan, planHash })
        validateAdaptiveFit(result.fit, adaptive.plan, input, planHash, result.preview)
        issues = [...result.fit.trials.at(-1)!.issues, ...adaptiveDirectionIssues(env.input, adaptive, result.fit)]
        technicalPass = result.fit.passed && !issues.length
        rendered = result
        reviewTask = adaptiveReviewTask(input, adaptive.plan, result.fit, result.preview)
        reviewTask.messages.push({ role: 'user', content: JSON.stringify({ originalSource: env.input.content, directions: adaptive.directions, instruction: 'Проверь также явное исходное размещение карточек. Цвета исходной графики не меняются. Краткий ответ, только наблюдаемые дефекты.' }) })
      } else {
        const pixel = plan as ReturnType<typeof validateFastPixel>, planHash = digest(pixel.plan)
        const result = await page.evaluate(async ({ env, brief, plan, planHash }) => {
          const path = '/browser/pixel-layout.ts'
          const { renderPixelLayout } = await import(path) as typeof import('../browser/pixel-layout')
          return renderPixelLayout(env, brief, plan, planHash)
        }, { env, ...pixel, planHash })
        rendered = result; technicalPass = result.passed && result.geometryUnchanged; issues = result.issues
        reviewTask = pixelReviewTask(env, pixel.brief, pixel.plan, result)
      }
      pngAtMs = elapsed(); selectedAttempt = attempt
      await writeFile(`${output}/slide-${attempt}.png`, Buffer.from(rendered.preview.split(',')[1], 'base64'))
      const { preview: png, ...report } = rendered
      await saveJson(`${output}/measurement-${attempt}.json`, { ...report, directionAndGeometryIssues: issues, technicalPass })
      stages.push({ stage: `render-${attempt}`, elapsedMs: Math.round(performance.now() - mark), finishedAtMs: elapsed() })
      console.log(JSON.stringify({ mode, stage: `render-${attempt}`, technicalPass, issues, elapsedMs: elapsed() }))
      if (!technicalPass) {
        if (!planOnly && attempt === 1 && canRepairFastSlide(mode, elapsed())) {
          task = pixelClarification(task, JSON.stringify(plan), issues)
          task.messages.push({ role: 'user', content: [{ type: 'text', text: JSON.stringify({ measurements: report, instruction: 'Исправь только выявленные нарушения. Новый полный план; не сокращай исходник и не меняй библиотечную графику.' }) }, { type: 'image_url', image_url: { url: png } }] })
          continue
        }
        throw Error('Measured layout did not pass; retained unchanged for diagnosis')
      }
      if (planOnly) break
      review = await execute('review', fastGeneration(reviewTask, mode, true), raw => {
        const value = mode === 'pixel' ? pixelReviewSchema.parse(raw) : raw as { verdict: 'pass' | 'revise'; issues: string[] }
        if (!['pass', 'revise'].includes(value.verdict) || !Array.isArray(value.issues) || (value.verdict === 'pass') !== (value.issues.length === 0)) throw new SemanticValidationError(['inconsistent-review'])
        return value
      })
      break
    }
  }
} catch (e) { failure = String(e); console.log(JSON.stringify({ mode, failure, elapsedMs: elapsed() })) }
finally {
  const completedAtMs = elapsed()
  await browser?.close(); await lock.close(); await unlink(`${sourceDir}/running.lock`)
  if (request) {
    const after = protectedRows(), unchanged = digest(before) === digest(after)
    const finalBudget = await loadJson(`${sourceDir}/experiment.json`)
    const passed = technicalPass && review?.verdict === 'pass' && !failure && unchanged && !browserErrors.length && !blocked.length
    const report = { version: FAST_SLIDE_VERSION, mode, startedAt, finishedAt: new Date().toISOString(), elapsedMs: completedAtMs, pngAtMs,
      targetMs: fastSlideProfile.targetMs, withinTarget: completedAtMs <= fastSlideProfile.targetMs, passed,
      acceptedWithinTarget: passed && completedAtMs <= fastSlideProfile.targetMs, technicalPass, review, selectedAttempt, failure,
      sourceHash: digest(snapshot), sourceSnapshotReused: true, modelAnswerReused: false, coldBrowser: true, model: modelIdentity(config), profile: fastSlideProfile,
      newRequests: localRequests, requestCap, planOnly, awaitingVisualReview: planOnly && technicalPass, sharedUsed: finalBudget.used, sharedLimit: finalBudget.maxRequests, unchanged, browserErrors, blocked, stages,
      runs: runs.map(r => ({ id: r.id, status: r.status, cacheHit: r.cacheHit, error: r.error, provenance: r.provenance, attempts: r.attempts })),
      manualSlideEdits: false, productionProjectChanged: false, measurement: 'From process start, source read and fresh browser/font setup through fresh model generation, all repairs, rendering and completed visual model review. Library import and source fragmentation are already prepared.' }
    await saveJson(`${output}/result.json`, report)
    await saveJson(`${output}/preservation.json`, { beforeHash: digest(before), afterHash: digest(after), unchanged })
    console.log(JSON.stringify({ mode, passed, acceptedWithinTarget: report.acceptedWithinTarget, elapsedMs: completedAtMs, newRequests: localRequests, output }))
    if (!report.acceptedWithinTarget) process.exitCode = 1
  } else if (failure) process.exitCode = 1
}
