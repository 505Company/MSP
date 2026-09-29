// Re-render saved Qwen choices after a local renderer repair. No model calls.
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { digest, loadJson, saveJson } from './pixel-pilot-store'
import type { RecipeLibraryInput } from '../browser/recipe-library'
import type { LibraryVariant } from '../lib/presentations/recipes/library-choice'
const [sourceName, name, retryName] = process.argv.slice(2)
if (![sourceName, name, ...(retryName ? [retryName] : [])].every(s => /^[a-z0-9-]{1,60}$/u.test(s ?? '')) || sourceName === name) throw Error('Distinct source and destination names required')
const source = `outputs/diagnostics/content-recipes/${sourceName}`, output = `outputs/diagnostics/content-recipes/${name}`, origin = 'http://127.0.0.1:5184'
await mkdir(output, { recursive: true })
await writeFile(`${output}/run-start.json`, JSON.stringify({ sourceName, startedAt: new Date().toISOString(), modelCalls: 0, purpose: 'Verify unchanged saved Qwen selections with explicitly loaded library fonts' }), { flag: 'wx' })
const started = performance.now(), sourceReport = await loadJson(`${source}/report.json`), ledgerPath = 'outputs/diagnostics/qwen-pixel-service/experiment.json'
const retry = retryName ? await loadJson(`outputs/diagnostics/content-recipes/${retryName}/retry.json`) : undefined
if (retryName && retry?.sourceName !== sourceName) throw Error('Retry must refer to the same original run')
const ledgerBefore = await readFile(ledgerPath, 'utf8'), results = [], errors: string[] = [], blocked: string[] = []
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  for (let slide = 1; slide <= 3; slide++) {
    const currentSource = retry?.slide === slide ? `outputs/diagnostics/content-recipes/${retryName}` : source
    const start = performance.now(), dir = `${output}/slide-${slide}`, data = await loadJson(`${currentSource}/slide-${slide}/prepared.json`), saved = await loadJson(`${currentSource}/slide-${slide}/result.json`)
    if (!saved?.modelChoice) throw Error(`No completed Qwen choice for slide ${slide}`)
    await mkdir(dir, { recursive: true })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => { const q = route.request(), u = new URL(q.url())
      if (u.origin === origin && ['GET', 'HEAD'].includes(q.method()) || ['data:', 'blob:'].includes(u.protocol)) return route.continue()
      blocked.push(`${q.method()} ${u.origin}${u.pathname}`); return route.abort()
    })
    await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
    try {
      await page.goto(`${origin}/processing-worker`)
      const render = await page.evaluate(async ({ input, variants }: { input: RecipeLibraryInput; variants: LibraryVariant[] }) => {
        const fontsPath = '/browser/layout-fonts.ts', path = '/browser/recipe-library.ts'
        const fonts = await (await import(fontsPath) as typeof import('../browser/layout-fonts')).prepareLayoutFonts(input.env.input)
        if (input.env.fontTokens.some(t => !fonts.fontTokens.includes(t))) throw Error('Missing source font')
        return (await import(path) as typeof import('../browser/recipe-library')).renderRecipeLibrary(input, variants)
      }, { input: data.input, variants: saved.variants })
      const issues = [...render.issues], changed = new Set(saved.variants.map((v: LibraryVariant) => v.blockId))
      for (const before of data.prepared.baseline.measurements.filter((m: { kind: string; id: string }) => m.kind !== 'text-measurement' && !changed.has(m.id))) {
        const after = render.measurements.find(m => m.id === before.id)
        if (!after || (['x', 'y', 'width', 'height'] as const).some(k => Math.abs(before.box[k] - after.box[k]) > 1)) issues.push(`composition-changed:${before.id}`)
      }
      const { preview, html, ...measurement } = render
      await writeFile(`${dir}/slide.png`, Buffer.from(preview.split(',')[1], 'base64')); await writeFile(`${dir}/rendered.html`, html)
      await saveJson(`${dir}/result.json`, { ...saved, render: measurement, issues, sourceResultHash: digest(saved), repair: 'Original library fonts explicitly loaded before execution; model choice and plan unchanged.' })
      for (const file of ['prepared.json', 'before.png', 'options.png']) await copyFile(`${currentSource}/slide-${slide}/${file}`, `${dir}/${file}`)
      const oldRun = await loadJson(`${currentSource}/slide-${slide}/run.json`)
      const r = { ...oldRun, passed: !issues.length && render.planUnchanged, issues, warnings: render.warnings,
        verificationMs: Math.round(performance.now() - start), sourceRun: `${retry?.slide === slide ? retryName : sourceName}/slide-${slide}/run.json`,
        modelChoiceUnchanged: digest(saved.modelChoice) === digest(oldRun.choices), modelCallsDuringVerification: 0 }
      results.push(r); await saveJson(`${dir}/run.json`, r)
      console.log(JSON.stringify({ slide, passed: r.passed, issues, modelChoiceUnchanged: r.modelChoiceUnchanged }))
    } finally { await page.close() }
  }
} finally { await browser.close() }
const verificationCodeHashes = Object.fromEntries(await Promise.all(['browser/recipe-library.ts', 'lib/presentations/recipes/library-choice.ts', 'scripts/verify-recipe-library.ts'].map(async p => [p, digest(await readFile(p, 'utf8'))])))
const report = { ...sourceReport, results, errors, blocked, originalRun: sourceName, retryRun: retryName, replayedForFontRepair: true, verificationCodeHashes, verificationMs: Math.round(performance.now() - started),
  totalWorkMs: sourceReport.fullCycleMs + (retry?.elapsedMs ?? 0) + Math.round(performance.now() - started), calls: sourceReport.calls + (retry?.calls ?? 0),
  knownCostRub: sourceReport.knownCostRub + (retry?.knownCostRub ?? 0), costComplete: sourceReport.costComplete && (!retry || retry.costComplete),
  newModelCalls: 0, ledgerUnchanged: ledgerBefore === await readFile(ledgerPath, 'utf8') }
await saveJson(`${output}/report.json`, report)
if (results.some(r => !r.passed || !r.modelChoiceUnchanged) || errors.length || blocked.length || !report.ledgerUnchanged) process.exitCode = 1
