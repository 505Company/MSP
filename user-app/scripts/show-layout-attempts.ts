// Read-only diagnostic replay. Never repair plans, persist reports or call Qwen.
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { layoutContext } from '../lib/presentations/layout-context'
import { contentHash } from '../lib/design-system/catalog'
import { validateLayoutPlan, type LayoutInput, type LayoutPlan, type LayoutFit } from '../lib/presentations/layout-contract'
import type { LayoutView } from '../lib/presentations/layout-workflow'

const [projectId, output, comparisonId, origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
if (!projectId || !output) throw Error('Usage: show-layout-attempts.ts <project> <output> [comparison-project] [origin]')
const getView = async (id: string) => {
  const response = await fetch(`${origin}/api/projects/${id}/layout`)
  if (!response.ok) throw Error(`Cannot read project ${id}`)
  return await response.json() as LayoutView
}
const before = await getView(projectId)
const database = new DatabaseSync('.wrangler/state/v3/r2/miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite', { readOnly: true })
const rows = database.prepare('SELECT key,blob_id FROM _mf_objects').all() as { key: string; blob_id: string }[]
database.close()
const read = async (key: string) => {
  const row = rows.find(row => row.key === key)
  return row ? JSON.parse(await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`, 'utf8')) : null
}
const prefix = `presentation-layouts/${projectId}/${before.inputId}`
const modelRow = rows.find(row => row.key.startsWith(prefix) && row.key.includes('/plan/runs/'))
if (!modelRow) throw Error('No saved model identity')
const { model } = await read(modelRow.key)
const bucket = {
  async get(key: string) { const value = await read(key); return value === null ? null : { json: async () => value } },
  async list(options: R2ListOptions) { return { objects: rows.filter(row => row.key.startsWith(options.prefix ?? '')), truncated: false } },
  async put() { throw Error('Diagnostic storage is read-only') },
} as unknown as R2Bucket
const context = await layoutContext(bucket, projectId, { baseUrl: model.baseUrl, model: model.model })
if (context.inputId !== before.inputId) throw Error('Current inputs differ from the original generation')
const attempts = [], cases: { slideId: string; title: string; round: number; input: LayoutInput; plan: LayoutPlan; fit: LayoutFit }[] = []
for (const slide of before.slides) for (let round = 0; round <= slide.round; round++) {
  const base = `${prefix}/${slide.id}/round-${round}`, pointer = await read(`${base}/plan/current.json`)
  if (!pointer) continue
  const run = await read(`${base}/plan/runs/${pointer.runId}.json`), rendered = await read(`${base}/render-layout-dom-3.json`)
  attempts.push({ slideId: slide.id, round, runId: run.id, status: run.status, error: run.error, resultKind: run.result?.kind, reason: run.result?.reason, fit: rendered?.fit, savedPreview: !!rendered?.preview })
  const raw = run.result?.kind === 'library-author' ? run.result.resolution.plan : run.result?.plan
  if (!raw || !rendered?.fit) continue
  const input = context.inputs.find(input => input.slideId === slide.id)!
  const plan = validateLayoutPlan(raw, input, await read(`${base}/evidence.json`))
  if (await contentHash(plan) !== rendered.fit.planHash) throw Error('Saved plan and measurements differ')
  cases.push({ slideId: slide.id, title: slide.title, round, input, plan, fit: rendered.fit })
}
await mkdir(output, { recursive: true })
const previews: { file: string; label: string; issues: string[] }[] = [], replay = [], mutations: string[] = []
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue()
    mutations.push(route.request().url()); return route.abort()
  })
  await page.goto(`${origin}/processing-worker`)
  for (const item of cases) for (const [index, trial] of item.fit.trials.entries()) {
    const measured = await page.evaluate(async ({ item, trial }) => {
      const executionPath = '/browser/layout-execution.ts', fontsPath = '/browser/layout-fonts.ts', htmlPath = '/lib/presentations/layout-html.ts'
      const { measureLayout, layoutGraphics } = await import(executionPath) as typeof import('../browser/layout-execution')
      const { prepareLayoutFonts } = await import(fontsPath) as typeof import('../browser/layout-fonts')
      const { renderLayoutHtml } = await import(htmlPath) as typeof import('../lib/presentations/layout-html')
      await prepareLayoutFonts(item.input)
      document.getElementById('diagnostic-attempt')?.remove()
      const host = document.createElement('div'); host.id = 'diagnostic-attempt'
      host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;z-index:2147483647'
      host.innerHTML = renderLayoutHtml(item.plan, item.input, trial.stateId, await layoutGraphics(item.input, item.plan), trial.plainComponents, trial.wideContext)
      document.body.appendChild(host)
      return measureLayout(host.firstElementChild as HTMLElement, item.input, item.plan, trial.stateId, trial.plainComponents, trial.wideContext)
    }, { item, trial })
    const file = `${item.slideId}-round-${item.round}-trial-${index + 1}.png`
    await page.locator('#diagnostic-attempt > :first-child').screenshot({ path: `${output}/${file}`, animations: 'disabled' })
    previews.push({ file, label: `${item.title}. Попытка ${index + 1}${trial.plainComponents ? ', текстовый fallback' : ', с компонентами'}`, issues: trial.issues.map(issue => issue.message) })
    replay.push({ slideId: item.slideId, round: item.round, trial: index + 1, original: trial, measured,
      measurementsMatch: await contentHash(trial.measurements) === await contentHash(measured.measurements), issuesMatch: await contentHash(trial.issues) === await contentHash(measured.issues) })
  }
} finally { await browser.close() }
if (mutations.length) throw Error('Unexpected API mutation was blocked')
const comparisons: { file: string; title: string }[] = []
if (comparisonId) {
  const comparison = await getView(comparisonId)
  for (const slide of comparison.slides.filter(slide => slide.phase === 'ready' && slide.previewRound !== undefined)) {
    const query = new URLSearchParams({ inputId: comparison.inputId, slideId: slide.id, round: String(slide.previewRound) })
    const response = await fetch(`${origin}/api/projects/${comparisonId}/layout/preview?${query}`)
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw Error('Saved comparison PNG missing')
    const file = `previous-${slide.id}.png`
    await writeFile(`${output}/${file}`, Buffer.from(await response.arrayBuffer()))
    comparisons.push({ file, title: slide.title })
  }
  if (await contentHash(comparison) !== await contentHash(await getView(comparisonId))) throw Error('Comparison project changed')
}
const unchanged = await contentHash(before) === await contentHash(await getView(projectId))
if (!unchanged) throw Error('Project changed during inspection')
const report = { projectId, inputId: before.inputId, status: before.status, budget: before.budget, slides: before.slides,
  attempts, replay, projectUnchanged: unchanged, apiMutations: mutations, comparisonId, comparisons,
  provenance: 'Rejected images replay the unchanged saved plan and recorded trials through the existing renderer. They were not stored by the original failed run. Comparison PNGs are original saved results from a different project. No Qwen requests.' }
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const figures = previews.map(p => `<figure><figcaption>${escape(p.label)}</figcaption><a href="${p.file}"><img src="${p.file}" alt="Отклонённый вариант"></a><ul>${p.issues.map(i => `<li>${escape(i)}</li>`).join('')}</ul></figure>`).join('')
const previous = comparisons.map(p => `<figure><figcaption>${escape(p.title)}</figcaption><a href="${p.file}"><img src="${p.file}" alt="Прежний успешный слайд"></a></figure>`).join('')
await writeFile(`${output}/index.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Фактические попытки генерации</title><style>body{margin:0;background:#fff;color:#202735;font:16px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:22px;margin-top:40px}figure{margin:24px 0;border-top:1px solid #d9dee6;padding-top:16px}figcaption{font-weight:600;margin-bottom:12px}img{display:block;width:100%;height:auto;border:1px solid #d9dee6}li{margin:8px 0;overflow-wrap:anywhere}.note{color:#77520e}a{color:#1555bd}p{max-width:1100px}</style><main><h1>Новый прогон: ${before.slides.filter(s => s.phase === 'ready').length} из ${before.slides.length} слайдов готовы</h1><p>Проект ${escape(projectId)}. Запросы оформления: ${before.budget.used}/${before.budget.limit}. Ничего не перегенерировано моделью и не исправлено вручную.</p><ol>${before.slides.map(s => `<li><strong>${escape(s.title)}</strong><br>${escape(s.error ?? s.phase)}</li>`).join('')}</ol><h2>Отклонённая вёрстка нового запуска</h2><p class="note">Это диагностическое воспроизведение сохранённого плана без изменений. Исходный запуск не сохранил PNG после провала измерений. Для остальных слайдов валидного плана с измерениями нет; изображения для них не сочинялись.</p>${figures || '<p>Ни одна попытка не дошла до вёрстки.</p>'}<h2>Прежний успешный контроль: другое содержание</h2><p>Ниже именно сохранённые PNG предыдущего контрольного проекта. Они не являются результатами нового прогона и не доказывают работу на произвольном содержании.</p>${previous}<p><a href="report.json">Точные ошибки, измерения и проверка сохранности</a></p></main></html>`)
console.log(JSON.stringify({ output, slides: before.slides.map(s => ({ id: s.id, phase: s.phase })), replay: replay.map(r => ({ slide: r.slideId, trial: r.trial, measurementsMatch: r.measurementsMatch, issuesMatch: r.issuesMatch })), comparisons: comparisons.length, unchanged, budget: before.budget }, null, 2))
