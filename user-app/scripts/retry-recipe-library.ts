// One explicit retry of a failed model request, without rerunning other slides.
import { chromium } from '@playwright/test'
import { open, mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises'
import { beginModelRun } from '../lib/uploads/model-run'
import { routeraiConfig } from '../lib/uploads/routerai'
import { LIBRARY_CHOICE_VERSION, validateLibraryChoice, applyLibraryVariants, type LibraryVariant } from '../lib/presentations/recipes/library-choice'
import type { RecipeLibraryInput } from '../browser/recipe-library'
import { digest, diagnosticBucket, loadJson, saveJson } from './pixel-pilot-store'
const [sourceName, slideArg, name] = process.argv.slice(2), slide = Number(slideArg)
if (![sourceName, name].every(s => /^[a-z0-9-]{1,60}$/u.test(s ?? '')) || ![1, 2, 3].includes(slide) || sourceName === name) throw Error('Source, slide 1–3, unique name required')
const source = `outputs/diagnostics/content-recipes/${sourceName}`, output = `outputs/diagnostics/content-recipes/${name}`, dir = `${output}/slide-${slide}`
const old = await loadJson(`${source}/slide-${slide}/run.json`)
if (old?.run?.status !== 'failed') throw Error('Retry only a finished failed model call; local rendering problems do not justify another paid call')
const ledgerPath = 'outputs/diagnostics/qwen-pixel-service/experiment.json', lockPath = 'outputs/diagnostics/qwen-pixel-service/running.lock', origin = 'http://127.0.0.1:5184'
const lock = await open(lockPath, 'wx'), started = performance.now()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let calls = 0
try {
  await mkdir(dir, { recursive: true }); await writeFile(`${output}/run-start.json`, JSON.stringify({ sourceName, slide, at: new Date().toISOString(), maxRequests: 1, authorization: 'Latest explicit Qwen test and standing budget authorization; retry only the failed slide.' }), { flag: 'wx' })
  const d = await loadJson(`${source}/slide-${slide}/prepared.json`), config = { ...routeraiConfig(process.env), timeoutMs: 600_000 }
  if (config.routerai?.providerTag !== 'deepinfra' || config.model !== 'qwen/qwen3.8-27b') throw Error('DeepInfra Qwen required')
  const current = await beginModelRun({ bucket: diagnosticBucket(dir), prefix: 'choice-1', task: d.task, config, version: LIBRARY_CHOICE_VERSION,
    scope: { sourceName, sourceFailureHash: digest(old.run), slide, preparedHash: digest(d), name }, validate: raw => validateLibraryChoice(raw, d.prepared.options),
    beforeRequest: async () => { const ledger = await loadJson(ledgerPath)
      if (calls || ledger.used !== ledger.reservations.length) throw Error('Budget guard')
      if (ledger.maxRequests <= ledger.used) {
        ledger.allowanceEvents ??= []; ledger.allowanceEvents.push({ at: new Date().toISOString(), previous: ledger.maxRequests, limit: ledger.used + 1, reason: 'Standing user approval to increase limit as needed; single failed-slide retry.' }); ledger.maxRequests = ledger.used + 1
      }
      ledger.used++; calls++; ledger.reservations.push({ prefix: `content-recipes/${name}/slide-${slide}/choice-1`, at: new Date().toISOString() }); await saveJson(ledgerPath, ledger)
      console.log(JSON.stringify({ stage: 'qwen-retry', slide, sharedUsed: ledger.used }))
    } })
  try { await current.execute?.() } finally { await saveJson(`${dir}/model-result.json`, current.run) }
  if (!current.run.result) throw Error(JSON.stringify(current.run.error))
  const choice = current.run.result, variants: LibraryVariant[] = choice.choices.map(c => d.prepared.variants.find((v: LibraryVariant) => v.id === c.variantId))
  const plan = applyLibraryVariants(d.input.plan, variants, d.input.env)
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.route('**/*', route => { const q = route.request(), u = new URL(q.url()); return u.origin === origin && ['GET', 'HEAD'].includes(q.method()) || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort() })
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
  await page.goto(`${origin}/processing-worker`)
  const render = await page.evaluate(async ({ input, variants }: { input: RecipeLibraryInput; variants: LibraryVariant[] }) => {
    const fonts = '/browser/layout-fonts.ts', path = '/browser/recipe-library.ts'
    await (await import(fonts) as typeof import('../browser/layout-fonts')).prepareLayoutFonts(input.env.input)
    return (await import(path) as typeof import('../browser/recipe-library')).renderRecipeLibrary(input, variants)
  }, { input: d.input, variants })
  const { preview, html, ...measurement } = render
  await writeFile(`${dir}/slide.png`, Buffer.from(preview.split(',')[1], 'base64')); await writeFile(`${dir}/rendered.html`, html)
  await saveJson(`${dir}/result.json`, { plan, variants, render: measurement, modelChoice: choice, contentBindingsReused: true })
  for (const f of ['prepared.json', 'before.png', 'options.png']) await copyFile(`${source}/slide-${slide}/${f}`, `${dir}/${f}`)
  const result = { slide, passed: render.passed, issues: render.issues, warnings: render.warnings, elapsedMs: Math.round(performance.now() - started), choices: choice, run: current.run,
    selectedComponents: variants.map(v => v.componentId), fragmentCount: new Set(render.measurements.flatMap(m => (m.refs ?? []).map(f => f.fragmentId))).size }
  await saveJson(`${dir}/run.json`, result)
  const costs = current.run.attempts.flatMap(a => a.provenance.routingReceipt ? [a.provenance.routingReceipt] : [])
  await saveJson(`${output}/retry.json`, { sourceName, slide, calls, elapsedMs: result.elapsedMs, sourceFailureHash: digest(old.run), inputHash: digest(await readFile(`${source}/slide-${slide}/prepared.json`, 'utf8')),
    knownCostRub: costs.reduce((s, r) => s + (r.totalCostRub ?? 0), 0), costComplete: costs.length === calls && costs.every(r => r.totalCostRub !== null) })
  console.log(JSON.stringify({ slide, passed: result.passed, elapsedMs: result.elapsedMs, components: result.selectedComponents }))
} finally { await browser?.close(); await lock.close(); await unlink(lockPath) }
