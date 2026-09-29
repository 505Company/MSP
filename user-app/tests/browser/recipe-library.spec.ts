import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { libraryFixture } from '../fixtures/recipe-library'
import { compileTemplateRecipe } from '../../lib/presentations/recipes/template-contract'
import { applyTemplateReflow } from '../../lib/presentations/recipes/template-reflow'
import { templateRecipeFixture } from '../fixtures/template-recipe'
import { layoutView, startLayoutAction, type LayoutAction } from '../../lib/presentations/layout-workflow'
import { readLayoutBudget } from '../../lib/presentations/layout-budget'
import { validateTemplateReport, type TemplateRenderReport } from '../../lib/presentations/recipes/template-measurement'
import { readProjectPresentation, readProjectPreview } from '../../lib/workspace/project-summary'
import { materialIdentity } from '../../lib/presentations/material-identity'
import { LAYOUT_RENDER_VERSION } from '../../lib/presentations/layout-contract'

test('capacity matrix preserves uneven items and long headings, rejects overflow/count mismatch and retains optional content', async ({ page }, info) => {
  const f = templateRecipeFixture(), base = await compileTemplateRecipe(f.proposal, f.snapshot, 'fixture', 'synthetic-extraction')
  const recipe = await applyTemplateReflow(base, { columns: 2, header: 'inline', rationale: 'Synthetic model proposal' }, 'synthetic-reflow')
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ recipe, material, plan }) => {
    const path = '/browser/template-recipe-execution.ts'
    const { renderTemplateRecipe } = await import(path) as typeof import('../../browser/template-recipe-execution')
    const cases = [], sparse = structuredClone(material)
    for (const f of sparse.fragments) if (f.id.startsWith('body-')) f.text = 'Краткий факт.'
    cases.push({ id: 'sparse', material: sparse, plan })
    const uneven = structuredClone(sparse)
    uneven.fragments.find(f => f.id === 'body-1')!.text = 'Каждый фрагмент должен сохранять связь с источником и точную формулировку. '.repeat(6)
    cases.push({ id: 'uneven', material: uneven, plan })
    const headings = structuredClone(sparse)
    headings.fragments.find(f => f.id === 'heading-1')!.text = 'Развёрнутый заголовок карточки с обязательным пояснением и уточнением условий применения'
    cases.push({ id: 'long-heading', material: headings, plan })
    const excessive = structuredClone(uneven)
    excessive.fragments.find(f => f.id === 'body-1')!.text += 'Нельзя удалять эту часть. '.repeat(150)
    cases.push({ id: 'excessive', material: excessive, plan })
    const primary = structuredClone(sparse)
    primary.fragments[0].text = 'Очень длинный исходный заголовок без сокращений. '.repeat(24)
    cases.push({ id: 'long-primary', material: primary, plan })
    const optional = structuredClone(uneven), optionalPlan = structuredClone(plan)
    optional.fragments.push({ id: 'new-note', text: 'Обязательное уточнение' }); optionalPlan.bindings.push({ sourceId: 'note-1', fragments: ['new-note'] })
    cases.push({ id: 'bound-optional', material: optional, plan: optionalPlan })
    const reports = []
    for (const c of cases) reports.push({ ...c, report: await renderTemplateRecipe(recipe, c.material, c.plan) })
    const mismatches = []
    for (const itemCount of [3, 5]) {
      try { await renderTemplateRecipe(recipe, { ...material, itemCount }, plan); mismatches.push('accepted') }
      catch (error) { mismatches.push(String(error)) }
    }
    return { reports, mismatches }
  }, { recipe, material: f.material, plan: f.plan })
  for (const c of result.reports) {
    await validateTemplateReport(c.report, recipe, c.material, c.plan)
    expect(c.report.measurements.map(m => m.text).sort()).toEqual(c.material.fragments.map(f => f.text).sort())
    expect(c.report.measurements.every(m => m.fontSize === (m.sourceId === 'primary' ? 36 : m.sourceId === 'note-1' ? 18 : 22))).toBe(true)
    await writeFile(info.outputPath(`${c.id}.png`), Buffer.from(c.report.preview.split(',')[1], 'base64'))
  }
  const get = (id: string) => result.reports.find(c => c.id === id)!.report
  expect(get('sparse').passed).toBe(true)
  expect(get('uneven').passed, JSON.stringify(get('uneven').issues)).toBe(true)
  expect(get('uneven').stateId).toBe('grid-2x2-inline')
  expect(get('long-heading').passed, JSON.stringify(get('long-heading').issues)).toBe(true)
  expect(get('long-heading').stateId).toBe('grid-2x2-inline')
  expect(get('excessive').passed).toBe(false)
  expect(get('long-primary').passed).toBe(false)
  expect(get('bound-optional').passed).toBe(false)
  expect(get('bound-optional').trials.some(t => t.stateId.startsWith('grid-'))).toBe(false)
  expect(result.mismatches.every(m => m !== 'accepted')).toBe(true)
  await writeFile(info.outputPath('boundary-results.json'), JSON.stringify(result.reports.map(c => ({ id: c.id, report: { ...c.report, preview: undefined } })), null, 2))
})

test('normal background entry executes an admitted native recipe with real pixels, server validation and no duplicate model requests', async ({ page }, info) => {
  const f = await libraryFixture()
  f.context.prefix = `presentation-layouts/${f.project.id}/${f.context.inputId}`
  await f.register(); await f.decide('accept'); await f.decide('enable')
  const config = { apiKey: 'synthetic-only', model: 'test', baseUrl: 'https://provider.invalid/v1' }
  const originalFetch = globalThis.fetch
  let calls = 0, report: TemplateRenderReport | undefined
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(config.baseUrl)) throw Error(`Unexpected test-provider request: ${url}`)
    calls++
    const body = JSON.parse(init!.body as string)
    const result = body.response_format.json_schema.name === 'template_recipe_review' ? { verdict: 'pass', issues: [] } : f.reply
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }))
  }
  try {
    await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
    await page.route(`**/api/projects/${f.project.id}/layout`, async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as LayoutAction
        if (body.action === 'report') report = body.fit as TemplateRenderReport
        const started = await startLayoutAction(f.bucket, f.context, body, config)
        await started.execute?.()
        await route.fulfill({ json: { accepted: true } }); return
      }
      await route.fulfill({ json: { ...await layoutView(f.bucket, f.context), configured: true } })
    })
    await page.goto('/processing-worker'); await page.waitForFunction(() => !!window.__mspRunLayout)
    const run = () => page.evaluate(async ({ id, input }) => window.__mspRunLayout!(id, input), { id: f.project.id, input: f.context.inputId })
    expect(await run()).toEqual({ ok: true })
    expect((await layoutView(f.bucket, f.context)).status).toBe('ready')
    expect(report?.passed).toBe(true)
    expect(report!.measurements.every(m => m.pixels > 3)).toBe(true)
    expect(calls).toBe(2)
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload()
    await page.waitForFunction(() => !!window.__mspRunLayout)
    expect(await run()).toEqual({ ok: true }); expect(calls).toBe(2)
    expect((await readLayoutBudget(f.bucket, f.context)).used).toBe(2)
    await writeFile(info.outputPath('native-normal-generation.png'), Buffer.from(report!.preview.split(',')[1], 'base64'))
    const job = { id: f.project.id, sourceRevision: f.project.revision, inputId: f.context.inputId, renderVersion: LAYOUT_RENDER_VERSION, status: 'complete',
      progress: { completed: 1, total: 1 }, slides: [{ id: f.input.slideId, title: f.input.title }] }
    await f.bucket.put(`presentation-jobs/${f.project.id}.json`, JSON.stringify(job))
    await page.route(`**/api/projects/${f.project.id}`, route => route.fulfill({ json: { project: f.project } }))
    await page.route('**/api/style-bank', route => route.fulfill({ json: { styles: [] } }))
    await page.route(`**/api/projects/${f.project.id}/generation`, route => route.fulfill({ json: { available: true, job } }))
    await page.route(`**/api/projects/${f.project.id}/structure`, async route => route.fulfill({ json: { configured: false, materialId: await materialIdentity(f.project.text), structure: { status: 'ready', outline: { slides: [{}] } } } }))
    await page.route(`**/api/projects/${f.project.id}/slides`, async route => route.fulfill({ json: { presentation: await readProjectPresentation(f.bucket, f.project.id) } }))
    await page.route(`**/api/projects/${f.project.id}/preview?*`, async route => {
      const params = new URL(route.request().url()).searchParams
      const image = await readProjectPreview(f.bucket, f.project.id, { inputId: params.get('inputId')!, slideId: params.get('slideId')!, round: Number(params.get('round')), render: params.get('render')! })
      expect(image).not.toBeNull()
      await route.fulfill({ contentType: 'image/png', body: Buffer.from(image!.split(',')[1], 'base64') })
    })
    const beforeViewing = structuredClone([...f.data])
    await page.goto(`/projects/${f.project.id}`)
    await expect(page.locator('.ws-slide-open')).toHaveCount(1)
    await page.locator('.ws-slide-open').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect.poll(() => page.locator('.ws-slide-large img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await page.screenshot({ path: info.outputPath('saved-template-viewer-mobile.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Закрыть просмотр слайда' }).click()
    await page.reload(); await expect(page.locator('.ws-slide-open')).toHaveCount(1)
    expect(calls).toBe(2); expect([...f.data]).toEqual(beforeViewing)
  } finally { globalThis.fetch = originalFetch }
})
