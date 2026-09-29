import { open, unlink, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { diagnosticBucket, digest, inventory, loadJson, saveJson } from './pixel-pilot-store'
import { beginModelRun, type ModelRun } from '../lib/uploads/model-run'
import { routeraiConfig } from '../lib/uploads/routerai'
import { modelIdentity, structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { validatePixelBrief, validatePixelPlan, type PixelEnvironment, type PixelPlan } from '../lib/presentations/pixel-contract'
import { compactTypesetterTask, taskSize } from '../lib/presentations/compact-two-qwen-task'
import { pixelClarification } from '../lib/presentations/pixel-task'
import { pixelWireTask, decodePixelWire, quickPixelDesignerTask } from '../lib/presentations/pixel-wire'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { leanPixelDesignerTask, decodeLeanPixelBrief } from '../lib/presentations/lean-pixel-designer'
import { namedPixelTask, decodeNamedPixel } from '../lib/presentations/pixel-named-wire'
import { measuredPixelTask, decodeMeasuredPixel, type ComponentEvidence } from '../lib/presentations/pixel-measured-plan'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import type { PixelReport } from '../browser/pixel-layout'

// Independent, immutable experiment. It does not change production profiles.
const version = 'compact-slide-control-1', name = process.argv.find(a => a.startsWith('--name='))?.slice(7) ?? 'compact-no-thinking-1'
if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid run name')
const request = process.argv.includes('--request'), sourceDir = 'outputs/diagnostics/qwen-pixel-service'
const wire = process.argv.includes('--wire')
const lean = process.argv.includes('--lean'), thinkTypesetter = process.argv.includes('--think-typesetter')
const thinkDesigner = process.argv.includes('--think-designer')
const named = process.argv.includes('--named')
const measured = process.argv.includes('--measured')
if ((lean || thinkTypesetter || named || measured) && !wire) throw Error('Lean/reasoned/compact modes require wire preparation')
if (wire && name === 'compact-no-thinking-1') throw Error('Wire experiment needs its own name')
const output = `outputs/diagnostics/qwen-fast-comparison/${name}`, origin = 'http://127.0.0.1:5184'
const startedAt = new Date().toISOString(), started = performance.now(), elapsed = () => Math.round(performance.now() - started)
const maxNewRequests = 6, batchLimit = 48, targetMs = 300_000
const authorization = 'Fresh user: «уыеличивай лимит на сколько тебе нужно - согласовано. главное результат. что дальше? запусьтить тест презентации?» Broad approval to increase the request budget as needed; counters/history must be preserved.'
if (await loadJson(`${output}/run-start.json`)) throw Error('Named run already started; no replay/reset')
const snapshot = await loadJson(`${sourceDir}/source.json`), budgetBefore = await loadJson(`${sourceDir}/experiment.json`)
if (digest(snapshot) !== budgetBefore.identity.sourceHash) throw Error('Frozen source changed')
const prior = await loadJson('outputs/diagnostics/qwen-fast-comparison/two-qwen/prepared.json')
const env: PixelEnvironment = { input: snapshot.input, compositions: snapshot.compositions, fontTokens: prior.fontTokens }
const withoutThinking = (task: StructuredRequest): StructuredRequest => {
  const { reasoningEffort: _effort, ...rest } = task
  void _effort
  return { ...rest, thinking: false }
}
const baseline: StructuredRequest = await loadJson('outputs/diagnostics/qwen-fast-comparison/compact-v1/designer-request.json')
const designer = lean ? leanPixelDesignerTask(baseline, env) : wire ? quickPixelDesignerTask(baseline, env) : withoutThinking(baseline)
if (thinkDesigner) { designer.thinking = true; designer.reasoningEffort = 'low'; designer.maxTokens = 4096 }
const control = { baselineTaskHash: digest(baseline), controlTaskHash: digest(designer),
  exactSameMessages: digest(baseline.messages) === digest(designer.messages), exactSameSchema: digest(baseline.schema) === digest(designer.schema),
  change: wire ? 'Second experiment: shorter designer prose and explicit component-capacity constraints; typesetter returns numeric tables with measured component candidates.' : 'thinking:true,reasoningEffort:low → thinking:false,reasoningEffort absent; all other designer task fields are identical',
  typesetter: `${thinkTypesetter ? 'Thinking enabled, effort low, max 4096' : 'Thinking disabled'}; model still emits every geometry number. Not a production profile change.`, lean, thinkDesigner, named, measured }
if (!wire && digest(withoutThinking(baseline)) !== digest(designer)) throw Error('Invalid control')
const identity = { version, sourceHash: digest(snapshot), control, fontTokens: env.fontTokens }
const config = { ...routeraiConfig(process.env), timeoutMs: 180_000 }
const prepared = { ...identity, taskSize: taskSize(designer), generation: structuredGeneration(designer, config),
  plannedSeconds: { sourceAndFonts: 5, designer: 40, measurements: 5, typesetter: 90, targetedModelRepairReserve: 100, renderAndInspection: 60 },
  targetMs, maxNewRequests, authorization, budgetBefore: { used: budgetBefore.used, limit: budgetBefore.maxRequests } }
await saveJson(`${output}/prepared.json`, prepared)
if (!request) { console.log(JSON.stringify({ prepared: true, modelCalls: 0, output, control })); process.exit(0) }
const lock = await open(`${sourceDir}/running.lock`, 'wx')
const protectedRows = () => inventory().filter(r => !/^(processing-worker|fonts)\//.test(r.key))
const before = protectedRows(), bucket = diagnosticBucket(output)
const stages: { stage: string; elapsedMs: number; finishedAtMs: number }[] = [], runs: ModelRun[] = []
const browserErrors: string[] = [], blocked: string[] = []
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, rendered: PixelReport | undefined
let failure: string | undefined, newRequests = 0, planHash: string | undefined, pngHash: string | undefined
try {
  const budget = await loadJson(`${sourceDir}/experiment.json`)
  if (budget.used !== budgetBefore.used || budget.used !== budget.reservations.length) throw Error('Shared budget changed')
  const nextLimit = Math.max(batchLimit, budget.used + maxNewRequests)
  if (budget.maxRequests < nextLimit) {
    budget.allowanceEvents.push({ at: new Date().toISOString(), previous: budget.maxRequests, limit: nextLimit, usedUnchanged: budget.used, reason: authorization })
    budget.maxRequests = nextLimit
    await saveJson(`${sourceDir}/experiment.json`, budget)
  }
  await saveJson(`${output}/run-start.json`, { ...prepared, startedAt })
  await saveJson(`${output}/inventory-before.json`, before)
  const execute = async <T>(role: string, task: StructuredRequest, validate: (value: unknown) => T, clarify = false): Promise<T> => {
    await saveJson(`${output}/${role}-request.json`, task)
    await saveJson(`${output}/${role}-parameters.json`, structuredGeneration(task, config))
    const mark = performance.now()
    const job = await beginModelRun({ bucket, prefix: role, task, config, version,
      scope: { diagnostic: true, role, sourceHash: identity.sourceHash }, validate,
      ...(clarify ? { clarification: { version: `${version}-clarification`, request: (reply, issues) => pixelClarification(task, reply.content, issues) } } : {}),
      beforeRequest: async () => {
        const current = await loadJson(`${sourceDir}/experiment.json`)
        if (current.used !== current.reservations.length || current.used !== budgetBefore.used + newRequests || newRequests >= maxNewRequests || current.used >= current.maxRequests) throw Error('Run allowance exhausted or shared counter changed')
        current.used++; newRequests++
        current.reservations.push({ prefix: `fast-comparison/${name}/${role}`, at: new Date().toISOString() })
        await saveJson(`${sourceDir}/experiment.json`, current)
        console.log(JSON.stringify({ stage: role, sharedUsed: current.used, elapsedMs: elapsed() }))
      } })
    try { await job.execute?.() }
    finally {
      runs.push(job.run); stages.push({ stage: role, elapsedMs: Math.round(performance.now() - mark), finishedAtMs: elapsed() })
      await saveJson(`${output}/progress.json`, { stages, runs, newRequests })
      console.log(JSON.stringify({ stage: role, status: job.run.status, error: job.run.error, elapsedMs: elapsed(), observation: job.run.provenance?.observation }))
    }
    if (job.run.status !== 'complete') throw Error(`Incomplete ${role}`)
    await saveJson(`${output}/${role}-response.json`, job.run.result)
    return job.run.result!
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', e => browserErrors.push(e.message))
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url())
    if ((url.origin === origin && ['GET', 'HEAD'].includes(r.method())) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    blocked.push(`${r.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
  await page.goto(`${origin}/processing-worker`)
  const fonts = await page.evaluate(async input => {
    const path = '/browser/layout-fonts.ts'
    return (await (await import(path) as typeof import('../browser/layout-fonts')).prepareLayoutFonts(input)).fontTokens
  }, snapshot.input)
  if (digest(fonts) !== digest(env.fontTokens)) throw Error('Available fonts changed')
  stages.push({ stage: 'source-fonts-browser', elapsedMs: elapsed(), finishedAtMs: elapsed() })
  const brief = await execute('designer', designer, raw => lean ? decodeLeanPixelBrief(raw, env) : validatePixelBrief(raw, env, layoutStates.map(s => s.id)), true)
  const measuredAt = performance.now(), briefHash = digest(brief)
  const evidence = await page.evaluate(async ({ env, brief }) => {
    const path = '/browser/pixel-text-evidence.ts'
    return (await import(path) as typeof import('../browser/pixel-text-evidence')).measurePixelTextEvidence(env, brief)
  }, { env, brief })
  await saveJson(`${output}/text-evidence.json`, evidence)
  stages.push({ stage: 'text-measurements', elapsedMs: Math.round(performance.now() - measuredAt), finishedAtMs: elapsed() })
  let typesetter = wire ? pixelWireTask(env, brief, briefHash, evidence) : withoutThinking(compactTypesetterTask(env, brief, briefHash, evidence))
  let componentEvidence: ComponentEvidence | undefined
  if (thinkTypesetter) { typesetter.thinking = true; typesetter.reasoningEffort = 'low'; typesetter.maxTokens = 4096 }
  if (wire) {
    componentEvidence = await page.evaluate(async ({ env, brief }) => {
      const path = '/browser/pixel-component-evidence.ts'
      return (await import(path) as typeof import('../browser/pixel-component-evidence')).measurePixelComponentEvidence(env, brief)
    }, { env, brief })
    if (lean) for (const group of componentEvidence.groups) group.candidates = group.candidates.filter(c => [480, 640, 800].includes(c.width) && [0, 4].includes(c.step))
    await saveJson(`${output}/component-evidence.json`, componentEvidence)
    typesetter.messages.push({ role: 'user', content: JSON.stringify({ componentEvidence,
      instruction: 'Ниже фактические размеры вариантов каждой выбранной карточки. Выбираешь вариант и положение ты. Перенеси числа своего выбранного варианта в таблицы ответа точно, вместе с его fontStep/direction/всеми полями. Порядок fields этого справочника может отличаться от textOrder — сопоставляй по path/fragments. Не смешивай размеры разных вариантов/карточек. Допустим и собственный расчёт по прежним формулам, если он проходит те же проверки.' }) })
  }
  if (named) typesetter = namedPixelTask(typesetter, env, brief)
  if (measured) typesetter = measuredPixelTask(typesetter, env, brief, componentEvidence!)
  const validatePlan = (raw: unknown) => measured ? decodeMeasuredPixel(raw, env, brief, briefHash, componentEvidence!) : named ? decodeNamedPixel(raw, brief, briefHash, env) : wire ? decodePixelWire(raw, brief, briefHash, env) : validatePixelPlan(raw, brief, briefHash, env)
  const requestPlan = async (role: string, task: StructuredRequest): Promise<PixelPlan> => {
    for (let retry = 0; ; retry++) {
      const currentRole = retry ? `${role}-contract-repair-${retry}` : role
      try { return await execute(currentRole, task, validatePlan) }
      catch (error) {
        if (!(error instanceof SemanticValidationError) || retry >= 3 || newRequests >= maxNewRequests) throw error
        const last = runs.at(-1)!
        const raw = await loadJson(`${output}/model/${currentRole}/responses/${last.id}.json`)
        if (!raw?.content) throw error
        task = pixelClarification(typesetter, raw.content, error.issues)
        task.messages.push({ role: 'user', content: 'Проверка требует исправить ВСЕ нарушения. Нативные карточки не получают дополнительный фон/радиус: background=-1,radius=0. Для flow возьми фактический вариант из componentEvidence и полностью скопируй ВСЕ его относительные размеры и кегли; глобальные x/y выбери сам. Для текста title выбери рамку, вмещающую все измеренные строки; minimumHeight=lines*lineHeight+2. Проверь контраст и что правые карточки помещаются в 1080 по высоте.' })
      }
    }
  }
  let plan: PixelPlan = await requestPlan('typesetter', typesetter)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const renderAt = performance.now(); planHash = digest(plan)
    rendered = await page.evaluate(async ({ env, brief, plan, planHash }) => {
      const path = '/browser/pixel-layout.ts'
      return (await import(path) as typeof import('../browser/pixel-layout')).renderPixelLayout(env, brief, plan, planHash)
    }, { env, brief, plan, planHash })
    const { preview: png, ...report } = rendered
    const pngBytes = Buffer.from(png.split(',')[1], 'base64')
    await writeFile(`${output}/slide-${attempt}.png`, pngBytes); await saveJson(`${output}/measurement-${attempt}.json`, report)
    stages.push({ stage: `render-${attempt}`, elapsedMs: Math.round(performance.now() - renderAt), finishedAtMs: elapsed() })
    console.log(JSON.stringify({ stage: `render-${attempt}`, passed: report.passed, issues: report.issues, elapsedMs: elapsed() }))
    if (rendered.passed) {
      await writeFile(`${output}/slide.png`, pngBytes); await saveJson(`${output}/measurement.json`, report)
      await saveJson(`${output}/plan.json`, plan)
      const { createHash } = await import('node:crypto'); pngHash = createHash('sha256').update(pngBytes).digest('hex')
      break
    }
    if (attempt === 3 || newRequests >= maxNewRequests) break
    const repair = pixelClarification(typesetter, JSON.stringify(plan), report.issues)
    repair.messages.push({ role: 'user', content: JSON.stringify({ browserMeasurements: report.measurements,
      instruction: 'Исправь геометрию по фактическим браузерным замерам; все решения снова задаёшь ты. Верни весь план. Содержание, бриф и ограничения прежние.' }) })
    plan = await requestPlan(`typesetter-render-repair-${attempt}`, repair)
  }
} catch (e) { failure = String(e); console.log(JSON.stringify({ failure, elapsedMs: elapsed() })) }
finally {
  const elapsedMs = elapsed()
  await browser?.close(); await lock.close(); await unlink(`${sourceDir}/running.lock`)
  const after = protectedRows(), current = await loadJson(`${sourceDir}/experiment.json`)
  const b = new Map(before.map(r => [r.key, r.blob_id])), a = new Map(after.map(r => [r.key, r.blob_id]))
  const changed = [...new Set([...b.keys(), ...a.keys()])].filter(k => b.get(k) !== a.get(k))
  const foreignImport = '0acfea79-83ee-49e5-b603-4e983c00665d'
  const outsideForeignImport = changed.filter(k => !k.includes(foreignImport))
  const frozenSourceUnchanged = digest(await loadJson(`${sourceDir}/source.json`)) === identity.sourceHash
  const preservationPassed = frozenSourceUnchanged && !outsideForeignImport.length
  await saveJson(`${output}/inventory-after.json`, after)
  await saveJson(`${output}/preservation.json`, { globalInventoryUnchanged: !changed.length, changed, foreignImport, outsideForeignImport,
    frozenSourceUnchanged, preservationPassed, applicationWritesByThisRun: 0, beforeHash: digest(before), afterHash: digest(after) })
  const technicalPass = !!rendered?.passed && !!rendered.geometryUnchanged && !failure && !browserErrors.length && !blocked.length
  const passed = technicalPass && preservationPassed
  await saveJson(`${output}/result.json`, { version, mode: name, startedAt, finishedAt: new Date().toISOString(), elapsedMs,
    passed, technicalPass, targetMs, generationWithinTarget: passed && elapsedMs <= targetMs, visualReview: rendered?.passed ? 'pending-local-inspection' : 'not-run-no-valid-png',
    failure, newRequests, sharedUsed: current.used, sharedLimit: current.maxRequests, sourceHash: identity.sourceHash, model: modelIdentity(config),
    planHash, pngHash, stages, runs, preservationPassed, globalInventoryUnchanged: !changed.length, browserErrors, blocked,
    modelAnswerReused: false, coldBrowser: true, manualSlideEdits: false, applicationWritesByThisRun: 0,
    measurement: 'Fresh designer + typesetter, all model clarifications/repairs, cold browser/fonts, measurements and PNG technical checks. Later Codex inspection is separately recorded.' })
  console.log(JSON.stringify({ passed, elapsedMs, newRequests, sharedUsed: current.used, output }))
  if (!passed) process.exitCode = 1
}
