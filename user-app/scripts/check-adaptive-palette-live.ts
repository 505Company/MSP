// Appearance-only Qwen control. Application storage is read-only; an exclusive
// diagnostic directory retains the allowance, exact inputs and provider replies.
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, mkdir, open, unlink, rename, copyFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { chromium, type Page } from '@playwright/test'
import { z } from 'zod'
import { layoutContext } from '../lib/presentations/layout-context'
import { layoutView } from '../lib/presentations/layout-workflow'
import { validateAdaptivePlan, validateAdaptiveFit, type AdaptiveFit } from '../lib/presentations/adaptive-layout'
import { adaptivePaletteTask, adaptivePaletteCorrectionTask, applyAdaptivePalette } from '../lib/presentations/adaptive-palette'
import { adaptiveReviewTask } from '../lib/presentations/adaptive-task'
import { contentHash } from '../lib/design-system/catalog'
import { beginModelRun, readModelRun } from '../lib/uploads/model-run'

const reviewResultSchema = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1).max(1000)).max(6) }).strict()
  .refine(r => (r.verdict === 'pass') === (r.issues.length === 0), 'inconsistent-visual-verdict')

const [projectId, output = 'outputs/diagnostics/adaptive-palette-live', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2).filter(a => !['--request', '--contrast'].includes(a))
if (!/^[a-f0-9-]{36}$/.test(projectId ?? '') || !/^outputs\/diagnostics\/[a-z0-9-]+$/.test(output)) throw Error('Usage: check-adaptive-palette-live.ts <project-id> [diagnostic-dir] [origin] [--request]')
const request = process.argv.includes('--request'), contrast = process.argv.includes('--contrast'), baseline = 'outputs/diagnostics/adaptive-grid-replay'
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const load = async (path: string) => {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
}
const save = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(temp, path)
}
const inventory = () => {
  const db = new DatabaseSync('.wrangler/state/v3/r2/miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite', { readOnly: true })
  try { return db.prepare('SELECT key,blob_id FROM _mf_objects ORDER BY key').all() as { key: string; blob_id: string }[] }
  finally { db.close() }
}
const rows = inventory(), protectedHash = () => hash(inventory().filter(r => !/^(processing-worker|fonts)\//.test(r.key))), before = protectedHash()
const read = async (key: string) => {
  const row = rows.find(r => r.key === key)
  return row ? load(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`) : null
}
const bucket = {
  async get(key: string) { const value = await read(key); return value === null ? null : { json: async () => value } },
  async list(options: R2ListOptions) { return { objects: rows.filter(r => r.key.startsWith(options.prefix ?? '')), truncated: false } },
  async put() { throw Error('The appearance experiment cannot write application storage') },
} as unknown as R2Bucket
const modelRow = rows.find(r => r.key.startsWith(`presentation-layouts/${projectId}/`) && r.key.includes('/plan/runs/'))
if (!modelRow) throw Error('No saved Qwen plan')
const { model } = await read(modelRow.key)
const context = await layoutContext(bucket, projectId, { baseUrl: model.baseUrl, model: model.model }), view = await layoutView(bucket, context)
const checkpoint = await load(`${baseline}/report.json`)
if (!checkpoint?.unchanged || checkpoint.projectId !== projectId || checkpoint.inputId !== context.inputId) throw Error('A matching, successful grid checkpoint is required')
const cases = []
for (const slide of view.slides) {
  if (!slide.adaptive?.version) continue
  const prefix = `${context.prefix}/${slide.id}/round-${slide.round}`, pointer = await read(`${prefix}/plan/current.json`)
  const run = await read(`${prefix}/plan/runs/${pointer.runId}.json`), input = context.inputs.find(i => i.slideId === slide.id)!
  const evidence = await read(`${prefix}/evidence.json`), plan = validateAdaptivePlan(run.result.plan, input, evidence)
  const original = checkpoint.results.find((r: { id: string }) => r.id === slide.id)
  if (run.status !== 'complete' || hash(slide.adaptive) !== hash(plan) || original?.originalPlanHash !== hash(plan) || original.sourceHash !== hash(input) || !original.fit.passed) throw Error('Checkpoint source, plan or geometry differs')
  const preview = 'data:image/png;base64,' + (await readFile(`${baseline}/${slide.id}-after.png`)).toString('base64')
  validateAdaptiveFit(original.fit, plan, input, slide.planHash!, preview, 'adaptive-render-7')
  cases.push({ id: slide.id, title: slide.title, input, evidence, plan, planHash: slide.planHash!, sourceRunId: run.id, preview, fit: original.fit as AdaptiveFit })
}
if (!cases.length) throw Error('No measured saved plans')
await mkdir(output, { recursive: true })
const lock = await open(`${output}/running.lock`, 'wx')
try {
  const identity = { version: contrast ? 'adaptive-palette-contrast-1' : 'adaptive-palette-experiment-1', projectId, inputId: context.inputId, objective: contrast ? 'After the unchanged 6-request baseline, require one visibly contrasting text panel chosen by Qwen; no changes to geometry, source, bindings or native artwork.' : 'Qwen chooses panel color pairs only; preserve the accepted shared grid, source, bindings and native artwork.',
    model, cases: cases.map(c => ({ id: c.id, sourceRunId: c.sourceRunId, planHash: c.planHash, sourceHash: hash(c.input), evidenceHash: hash(c.evidence), previewHash: hash(c.preview), taskHash: hash(adaptivePaletteTask(c.input, c.plan, c.preview, contrast)) })) }
  let manifest = await load(`${output}/experiment.json`)
  if (!manifest) {
    if (!request) throw Error('No saved experiment. New paid calls require --request.')
    manifest = { identity, maxRequests: cases.length * 2, used: 0, reservations: [], protectedHash: before, originalBudget: view.budget, createdAt: new Date().toISOString() }
    await save(`${output}/experiment.json`, manifest)
  }
  if (hash(manifest.identity) !== hash(identity) || manifest.protectedHash !== before || manifest.maxRequests !== cases.length * 2 || manifest.used !== manifest.reservations.length) throw Error('Experiment changed; no allowance reset')
  const modelPath = (key: string) => {
    if (!/^[a-zA-Z0-9_/.-]+$/.test(key) || key.includes('..')) throw Error('Invalid diagnostic model key')
    return `${output}/model/${key}`
  }
  // The process-wide file lock serializes the conditional puts and allowance.
  const diagnosticBucket = {
    async get(key: string) { const value = await load(modelPath(key)); return value === null ? null : { json: async () => value, etag: hash(value) } },
    async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      const old = await load(modelPath(key)), condition = options?.onlyIf
      if (condition?.etagDoesNotMatch === '*' && old !== null || condition?.etagMatches && condition.etagMatches !== hash(old)) return null
      const parsed = JSON.parse(value); await save(modelPath(key), parsed)
      return { key, etag: hash(parsed) }
    },
  } as unknown as R2Bucket
  const config = { apiKey: process.env.INTELION_API_KEY, baseUrl: model.baseUrl, model: model.model, timeoutMs: 300000 }
  const execute = async <T>(prefix: string, task: Parameters<typeof beginModelRun>[0]['task'], validate: (raw: unknown) => T, clarification?: Parameters<typeof beginModelRun>[0]['clarification']) => {
    const previous = await readModelRun(diagnosticBucket, prefix)
    if (previous) {
      const saved = await load(modelPath(`${prefix}/inputs/${previous.inputHash}.json`))
      if (hash(saved.task) !== hash(task)) throw Error('Saved task differs; no new request')
      if (previous.status === 'complete') return { result: validate(previous.result), runId: previous.id }
      if (previous.status !== 'failed' || previous.error?.code !== 'SEMANTIC_VALIDATION' || previous.clarificationRequests || !clarification) throw Error(`Retained ${previous.status} run ${previous.id}; no automatic paid retry`)
    }
    if (!request) throw Error('Read-only mode: no saved response')
    if (manifest.used >= manifest.maxRequests) throw Error('Diagnostic allowance exhausted')
    const started = await beginModelRun({ bucket: diagnosticBucket, prefix, task, config, version: identity.version, scope: { projectId, inputId: context.inputId, diagnostic: true }, validate, clarification,
      beforeRequest: async () => {
        if (manifest.used >= manifest.maxRequests) throw Error('Diagnostic allowance exhausted')
        manifest.used++; manifest.reservations.push({ prefix, reservedAt: new Date().toISOString() })
        await save(`${output}/experiment.json`, manifest)
      } })
    await started.execute?.()
    return { result: started.run.result!, runId: started.run.id }
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH })
  const errors: string[] = [], blockedRequests: string[] = [], results = []
  const restrict = async (page: Page) => {
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const r = route.request(), url = new URL(r.url())
      if (url.origin === origin && ['GET', 'HEAD'].includes(r.method()) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
      blockedRequests.push(`${r.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
    })
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    await restrict(page)
    await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
    await page.goto(`${origin}/processing-worker`)
    for (const item of cases) {
      try {
        const task = adaptivePaletteTask(item.input, item.plan, item.preview, contrast)
        const selection = await execute(`${item.id}/palette`, task, raw => applyAdaptivePalette(raw, item.plan, item.input, item.evidence, contrast).choice,
          contrast ? { version: 'adaptive-palette-clarification-1', request: (reply, issues) => adaptivePaletteCorrectionTask(task, item.input, reply.content, issues) } : undefined)
        const { plan } = applyAdaptivePalette(selection.result, item.plan, item.input, item.evidence, contrast), planHash = await contentHash(plan)
        const rendered = await page.evaluate(async ({ input, plan, planHash, beforePreview }) => {
          const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
          const { prepareLayoutFonts } = await import(fontPath) as typeof import('../browser/layout-fonts')
          const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../browser/adaptive-layout')
          const fonts = await prepareLayoutFonts(input)
          const result = await fitAdaptiveLayout(input, plan, planHash, { fontCss: Object.values(fonts.css).join('\n') })
          const contexts: CanvasRenderingContext2D[] = []
          for (const src of [beforePreview, result.preview]) {
            const image = new Image(); image.src = src; await image.decode()
            const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
            const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0); contexts.push(ctx)
          }
          const [before, after] = contexts
          if (before.canvas.width !== 1920 || after.canvas.width !== 1920) throw Error('Expected full-size native PNG')
          const a = before.getImageData(0, 0, 1920, 1080).data, b = after.getImageData(0, 0, 1920, 1080).data
          const panels = result.fit.trials.at(-1)!.boxes.filter(box => box.id.startsWith('block-') && plan.blocks[Number(box.id.slice(6))].panelColors)
          let changedPixels = 0, outsidePanelChanges = 0
          for (let i = 0; i < a.length; i += 4) if ([0, 1, 2, 3].some(c => a[i + c] !== b[i + c])) {
            changedPixels++; const x = i / 4 % 1920, y = Math.floor(i / 4 / 1920)
            if (!panels.some(p => x >= p.x - 1 && x < p.x + p.width + 1 && y >= p.y - 1 && y < p.y + p.height + 1)) outsidePanelChanges++
          }
          return { ...result, changedPixels, outsidePanelChanges }
        }, { input: item.input, plan, planHash, beforePreview: item.preview })
        validateAdaptiveFit(rendered.fit, plan, item.input, planHash, rendered.preview)
        const geometryUnchanged = hash(rendered.fit.trials) === hash(item.fit.trials)
        await copyFile(`${baseline}/${item.id}-after.png`, `${output}/${item.id}-before.png`)
        await writeFile(`${output}/${item.id}-after.png`, Buffer.from(rendered.preview.split(',')[1], 'base64'))
        await save(`${output}/${item.id}-render.json`, { sourceRunId: item.sourceRunId, sourcePlanHash: item.planHash, paletteRunId: selection.runId, plan, planHash, fit: rendered.fit,
          geometryUnchanged, changedPixels: rendered.changedPixels, outsidePanelChanges: rendered.outsidePanelChanges, rationale: selection.result.rationale })
        if (!geometryUnchanged || rendered.outsidePanelChanges || !rendered.fit.passed) throw Error('Appearance-only control changed geometry/artwork or failed fit; no review')
        let correctionsPending = 0
        for (const c of cases) {
          const prior = await readModelRun(diagnosticBucket, `${c.id}/palette`)
          if (prior?.status === 'failed' && prior.error?.code === 'SEMANTIC_VALIDATION' && !prior.clarificationRequests) correctionsPending++
        }
        const savedReview = await readModelRun(diagnosticBucket, `${item.id}/review`)
        const review = savedReview || manifest.maxRequests - manifest.used > correctionsPending
          ? await execute(`${item.id}/review`, adaptiveReviewTask(item.input, plan, rendered.fit, rendered.preview), raw => reviewResultSchema.parse(raw)) : null
        results.push({ id: item.id, title: item.title, paletteRunId: selection.runId, reviewRunId: review?.runId ?? null, review: review?.result ?? null, reviewStatus: review ? 'complete' : 'not-requested-budget-reserved-or-exhausted', geometryUnchanged, changedPixels: rendered.changedPixels, outsidePanelChanges: rendered.outsidePanelChanges, panels: selection.result.panels, rationale: selection.result.rationale })
        console.log(JSON.stringify(results.at(-1)))
      } catch (e) { results.push({ id: item.id, title: item.title, error: String(e) }); console.log(JSON.stringify(results.at(-1))) }
      await save(`${output}/result.json`, { results, used: manifest.used, maxRequests: manifest.maxRequests, unchanged: protectedHash() === before })
    }
    const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
    const inspection = await load(`${output}/agent-review.json`)
    const sections = results.map(r => {
      const note = inspection?.slides.find((s: { id: string; paletteRunId: string }) => s.id === r.id && s.paletteRunId === r.paletteRunId)
      return `<section><h2>${escape(r.title)}</h2>${'error' in r ? `<p>${escape(r.error!)}</p>` : `<div class="grid">${[['before', 'Принятая сетка, прежние цвета'], ['after', 'Та же сетка, выбор цветов Qwen']].map(([suffix, label]) => `<figure><a href="${r.id}-${suffix}.png"><img src="${r.id}-${suffix}.png" alt="${escape(label)}"></a><figcaption>${escape(label)}</figcaption></figure>`).join('')}</div><p>Геометрия прежняя. Изменений вне выбранных панелей: ${r.outsidePanelChanges}. Qwen-ревью: ${escape(r.review?.verdict ?? 'не запрошено: лимит контроля')}.</p><p>Обоснование Qwen: ${escape(r.rationale!)} ${escape(r.review?.issues.join(' ') ?? '')}</p>${note ? `<p><strong>Проверка агента:</strong> ${escape(note.observation)}</p>` : ''}`}</section>`
    }).join('')
    const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Палитра блоков</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f4f6;color:#18202a;font:16px/1.5 system-ui;letter-spacing:0}main{max-width:2100px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:20px;margin:40px 0 16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;min-width:0}img{width:100%;aspect-ratio:16/9;display:block;border:1px solid #d8dce2}figcaption{margin-top:8px}a{color:#005db5}</style><main><h1>Палитра блоков</h1><p>Qwen выбирает только цвета текстовых панелей. Сетка, текст, смысловые привязки и нативные карточки сохранены. Отдельный эксперимент: ${manifest.used}/${manifest.maxRequests} запросов. Презентация не изменена.</p>${sections}<p>Слайд 2 не имеет валидного прежнего смыслового плана и в этот цветовой контроль не включён.</p><p><a href="result.json">Результаты и сохранность</a></p></main></html>`
    await writeFile(`${output}/index.html`, html)
    // Retire the native-capture page before inspecting the gallery.
    await page.close()
    const gallery = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    await restrict(gallery)
    await gallery.goto(`${origin}/${output}/index.html`)
    await gallery.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth === 1920))
    const noHorizontalOverflow = await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    await gallery.screenshot({ path: `${output}/comparison-desktop.png`, animations: 'disabled', timeout: 15000 })
    const unchanged = protectedHash() === before
    await save(`${output}/result.json`, { projectId, inputId: context.inputId, results, used: manifest.used, maxRequests: manifest.maxRequests, originalBudget: view.budget, unchanged, protectedHash: before, errors, blockedRequests, noHorizontalOverflow })
    if (!unchanged || errors.length || blockedRequests.length || !noHorizontalOverflow) throw Error('Protected storage or read-only desktop check failed')
    if (results.some(r => 'error' in r || r.review?.verdict !== 'pass')) process.exitCode = 1
  } finally { await browser.close() }
} finally { await lock.close(); await unlink(`${output}/running.lock`) }
