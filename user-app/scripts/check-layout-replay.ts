// Read-only replay of saved model replies. No project/model POSTs or source edits.
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { validateLayoutPlan, type LayoutInput } from '../lib/presentations/layout-contract'
import type { LayoutView } from '../lib/presentations/layout-workflow'
import { layoutContext } from '../lib/presentations/layout-context'

const [projectId, output = 'outputs/diagnostics/layout-replay', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
if (!projectId || !/^[\w-]+$/.test(projectId)) throw Error('Usage: check-layout-replay.ts <project-id> [output-dir] [origin]')
const response = await fetch(`${origin}/api/projects/${projectId}/layout`), view = await response.json() as LayoutView
if (!response.ok) throw Error('A current layout is required for read-only replay')
const db = '.wrangler/state/v3/r2/miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite'
const database = new DatabaseSync(db, { readOnly: true })
const rows = database.prepare('SELECT key,blob_id FROM _mf_objects').all() as { key: string; blob_id: string }[]
database.close()
const read = async (key: string) => {
  const row = rows.find(r => r.key === key)
  return row ? JSON.parse(await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`, 'utf8')) : null
}
const modelRow = rows.find(r => r.key.startsWith(`presentation-layouts/${projectId}/${view.inputId}/`) && r.key.includes('/runs/'))
if (!modelRow) throw Error('A saved model identity is required')
const { model } = await read(modelRow.key)
const bucket = {
  async get(key: string) { const value = await read(key); return value === null ? null : { json: async () => value } },
  async list(options: R2ListOptions) { return { objects: rows.filter(r => r.key.startsWith(options.prefix ?? '')), truncated: false } },
  async put() { throw Error('Read-only diagnostic must not write application storage') },
} as unknown as R2Bucket
const context = await layoutContext(bucket, projectId, { baseUrl: model.baseUrl, model: model.model })
if (context.inputId !== view.inputId) throw Error('Local context differs from the live input')
const cases = []
for (const slide of view.slides) {
  const prefix = slide.replayedFrom?.prefix ?? `presentation-layouts/${projectId}/${view.inputId}/${slide.id}/round-${slide.round}/plan`
  const pointer = await read(`${prefix}/current.json`)
  if (!pointer) continue
  const run = await read(`${prefix}/runs/${pointer.runId}.json`)
  const saved = await read(`${prefix}/inputs/${run.inputHash}.json`), evidence = await read(prefix.replace(/\/plan$/, '/evidence.json'))
  const reply = await read(run.clarificationRequests ? `${prefix}/clarifications/${run.id}/response.json` : `${prefix}/responses/${run.id}.json`)
  if (!reply || reply.finishReason !== 'stop') continue
  const content = JSON.parse(saved.task.messages[1].content).source.map(({ id, text }: { id: string; text: string }) => ({ id, text }))
  const input: LayoutInput = { ...context.inputs.find(i => i.slideId === slide.id)!, content, slideId: slide.id }, raw = slide.plan ?? JSON.parse(reply.content)
  try { cases.push({ id: `${run.scope.slideId}-${run.scope.round}`, input, plan: validateLayoutPlan(raw, input, evidence), evidence }) }
  catch (error) { console.log(JSON.stringify({ slide: run.scope.slideId, validation: error instanceof Error ? { ...error, message: error.message } : error })) }
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
  await page.goto(`${origin}/processing-worker`)
  const results = await page.evaluate(async cases => {
    const executionPath = '/browser/layout-execution.ts', fontPath = '/browser/layout-fonts.ts'
    const { fitLayout } = await import(executionPath) as typeof import('../browser/layout-execution')
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../browser/layout-fonts')
    const results = []
    for (const item of cases) {
      const fonts = await prepareLayoutFonts(item.input)
      const result = await fitLayout(item.input, item.plan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
      results.push({ id: item.id, fit: result.fit, preview: result.preview, html: result.html })
    }
    return results
  }, cases)
  for (const result of results) if (result.preview) {
    await writeFile(`${output}/${result.id}.png`, Buffer.from(result.preview.split(',')[1], 'base64'))
    await page.evaluate(html => { const host = document.createElement('div'); host.id = 'diagnostic-slide'; host.style.cssText = 'position:fixed;left:0;top:0;z-index:10000'; host.innerHTML = html; document.body.appendChild(host) }, result.html)
    await page.locator('#diagnostic-slide').screenshot({ path: `${output}/${result.id}-dom.png` })
    await page.evaluate(() => document.getElementById('diagnostic-slide')!.remove())
  }
  await writeFile(`${output}/replay.json`, JSON.stringify(results.map(({ id, fit }) => ({ id, fit })), null, 2))
  console.log(JSON.stringify(results.map(({ id, fit }) => ({ id, passed: fit.passed })), null, 2))
} finally { await browser.close() }
