// Replays immutable Qwen plans locally. Application storage is read-only;
// only diagnostic files are written, never reports or reviews in a project.
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { layoutContext } from '../lib/presentations/layout-context'
import { layoutView } from '../lib/presentations/layout-workflow'
import { validateAdaptivePlan, validateAdaptiveFit, type AdaptiveFit } from '../lib/presentations/adaptive-layout'
import { ADAPTIVE_GRID_RENDER } from '../lib/presentations/adaptive-components'
import { contentHash } from '../lib/design-system/catalog'

const [projectId, output = 'outputs/diagnostics/adaptive-grid-replay', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(projectId ?? '') || !output.startsWith('outputs/diagnostics/')) throw Error('Usage: check-adaptive-grid-replay.ts <project-id> [diagnostic-dir] [origin]')
const db = '.wrangler/state/v3/r2/miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite'
const inventory = () => {
  const database = new DatabaseSync(db, { readOnly: true })
  try { return database.prepare('SELECT key,blob_id FROM _mf_objects ORDER BY key').all() as { key: string; blob_id: string }[] }
  finally { database.close() }
}
const rows = inventory(), hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const protectedHash = (items: typeof rows) => hash(items.filter(r => !/^(processing-worker|fonts)\//.test(r.key)))
const before = protectedHash(rows)
const read = async (key: string) => {
  const row = rows.find(r => r.key === key)
  return row ? JSON.parse(await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`, 'utf8')) : null
}
const bucket = {
  async get(key: string) { const value = await read(key); return value === null ? null : { json: async () => value } },
  async list(options: R2ListOptions) { return { objects: rows.filter(r => r.key.startsWith(options.prefix ?? '')), truncated: false } },
  async put() { throw Error('Read-only replay cannot write application storage') },
} as unknown as R2Bucket
const modelRow = rows.find(r => r.key.startsWith(`presentation-layouts/${projectId}/`) && r.key.includes('/plan/runs/'))
if (!modelRow) throw Error('No saved model plan')
const { model } = await read(modelRow.key)
const context = await layoutContext(bucket, projectId, { baseUrl: model.baseUrl, model: model.model })
const view = await layoutView(bucket, context)
const cases = []
for (const slide of view.slides) {
  if (!slide.adaptive?.version) continue
  const prefix = `${context.prefix}/${slide.id}/round-${slide.round}`, pointer = await read(`${prefix}/plan/current.json`)
  const run = await read(`${prefix}/plan/runs/${pointer.runId}.json`)
  const savedInput = await read(`${prefix}/plan/inputs/${run.inputHash}.json`)
  const evidence = await read(`${prefix}/evidence.json`), input = context.inputs.find(i => i.slideId === slide.id)!
  if (run.status !== 'complete' || hash(run.result.plan) !== hash(slide.adaptive) || hash(input.content) !== hash(JSON.parse(savedInput.task.messages[1].content).source)) throw Error(`Saved source differs: ${slide.id}`)
  const plan = validateAdaptivePlan(run.result.plan, input, evidence)
  if (await contentHash(run.result) !== slide.planHash) throw Error('Saved plan hash differs')
  cases.push({ id: slide.id, input, plan, planHash: slide.planHash!, runId: run.id, sourceHash: hash(input), originalPlanHash: hash(plan), before: slide.adaptiveFit! })
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH })
const blockedRequests: string[] = [], errors: string[] = []
const results: { id: string; runId: string; planHash: string; sourceHash: string; originalPlanHash: string; before: AdaptiveFit; fit: AdaptiveFit; review: string }[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue()
    blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
  await page.goto(`${origin}/processing-worker`)
  for (const item of cases) {
    const rendered = await page.evaluate(async ({ input, plan, planHash, renderVersion }) => {
      const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
      const { prepareLayoutFonts } = await import(fontPath) as typeof import('../browser/layout-fonts')
      const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../browser/adaptive-layout')
      const fonts = await prepareLayoutFonts(input)
      return fitAdaptiveLayout(input, plan, planHash, { renderVersion, fontCss: Object.values(fonts.css).join('\n') })
    }, { ...item, renderVersion: ADAPTIVE_GRID_RENDER as typeof ADAPTIVE_GRID_RENDER })
    validateAdaptiveFit(rendered.fit, item.plan, item.input, item.planHash, rendered.preview, ADAPTIVE_GRID_RENDER)
    if (hash(item.plan) !== item.originalPlanHash || hash(item.input) !== item.sourceHash) throw Error('Source or model plan mutated')
    await writeFile(`${output}/${item.id}-after.png`, Buffer.from(rendered.preview.split(',')[1], 'base64'))
    const old = await read(`${context.prefix}/${item.id}/round-${view.slides.find(s => s.id === item.id)!.round}/render-${item.before.version}.json`)
    await writeFile(`${output}/${item.id}-before.png`, Buffer.from(old.preview.split(',')[1], 'base64'))
    const original = 'outputs/diagnostics/adaptive-layout-live/generation/' + item.id + '.png'
    await copyFile(original, `${output}/${item.id}-plain.png`)
    const result = { id: item.id, runId: item.runId, planHash: item.planHash, sourceHash: item.sourceHash, originalPlanHash: item.originalPlanHash, before: item.before, fit: rendered.fit, review: 'not-requested' }
    results.push(result)
    console.log(JSON.stringify({ id: item.id, passed: rendered.fit.passed, trials: rendered.fit.trials.length, selected: { columns: rendered.fit.trials.at(-1)!.columns, fontStep: rendered.fit.trials.at(-1)!.fontStep }, issues: rendered.fit.trials.at(-1)!.issues }))
  }
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Сетка: сравнение</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f4f6;color:#18202a;font:16px/1.5 system-ui;letter-spacing:0}main{max-width:2200px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:20px;margin:40px 0 16px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}figure{margin:0;min-width:0}img{width:100%;aspect-ratio:16/9;display:block;border:1px solid #d8dce2}figcaption{margin-top:8px}.passed{color:#176843}.failed{color:#a13e29}a{color:#005db5}</style><main><h1>Сетка и библиотечные карточки</h1><p>Сохранённые планы Qwen, исходный текст и компоненты не изменены. Новых запросов: 0. Это локальное сравнение; новые PNG ещё не проходили Qwen-ревью.</p>${view.slides.map(s => { const r = results.find(r => r.id === s.id); return `<section><h2>${escape(s.title)}</h2>${r ? `<div class="grid">${[['plain', 'Первый текстовый вариант, другой прежний план Qwen'], ['before', 'Карточки до исправления, renderer 6'], ['after', 'Тот же план с исправленной сеткой, renderer 7']].map(([suffix, label]) => `<figure><a href="${s.id}-${suffix}.png"><img src="${s.id}-${suffix}.png" alt="${escape(label)}"></a><figcaption>${escape(label)}</figcaption></figure>`).join('')}</div><p class="${r.fit.passed ? 'passed' : 'failed'}">${r.fit.passed ? 'Новые измерения и проверка текстовых пикселей пройдены.' : 'Новая попытка не прошла проверку вместимости.'}</p>` : '<p>Сохранённый план не прошёл смысловую проверку. Изображения нет; привязки вручную не исправлялись.</p>'}</section>` }).join('')}<p><a href="report.json">Измерения и сохранность</a></p></main></html>`
  await writeFile(`${output}/index.html`, html)
  await page.goto(`${origin}/${output}/index.html`)
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth === 1920))
  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await page.screenshot({ path: `${output}/comparison-desktop.png`, fullPage: true, animations: 'disabled' })
  const unchanged = protectedHash(inventory()) === before
  await writeFile(`${output}/report.json`, JSON.stringify({ projectId, inputId: context.inputId, renderer: ADAPTIVE_GRID_RENDER, modelRequests: 0, originalBudget: view.budget,
    unchanged, protectedHash: before, blockedRequests, errors, noHorizontalOverflow, results }, null, 2))
  if (!unchanged || blockedRequests.length || errors.length || !noHorizontalOverflow) throw Error('Replay changed protected state or failed read-only browser verification')
} finally { await browser.close() }
