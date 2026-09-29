import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { adaptiveFixture, adaptiveComponentFixture, adaptiveGridFixture, adaptivePaletteFixture } from '../fixtures/adaptive-layout'
import { adaptiveCandidates, adaptiveRenderVersion, ADAPTIVE_RECIPE_ID, ADAPTIVE_VERSION, validateAdaptiveFit } from '../../lib/presentations/adaptive-layout'
import { contentHash } from '../../lib/design-system/catalog'
import { libraryFixture } from '../fixtures/recipe-library'
import { layoutView, startLayoutAction, type LayoutAction } from '../../lib/presentations/layout-workflow'
import { readProjectPresentation, readProjectPreview } from '../../lib/workspace/project-summary'

test('adaptive blocks share fixed space, reflow before shrinking and reject excessive content without text loss', async ({ page }, info) => {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input), options = { fontCss: Object.values(fonts.css).join('\n') }
    const cases = [{ id: 'balanced', input: structuredClone(input) }, { id: 'uneven', input: structuredClone(input) }, { id: 'long-title', input: structuredClone(input) }, { id: 'dense', input: structuredClone(input) }, { id: 'excessive', input: structuredClone(input) }]
    cases[1].input.content.find(f => f.id === 'b1')!.text += ' Дополнительный контекст помогает не потерять важные условия и ограничения.'.repeat(3)
    cases[2].input.content[0].text += ' и сохраняют содержание на каждом этапе совместной работы'
    for (const f of cases[3].input.content) if (f.id.startsWith('b')) f.text += ' Подробное описание помогает проверить все условия и сохранить исходный смысл сообщения.'.repeat(3)
    cases[4].input.content.find(f => f.id === 'b1')!.text += ' Нельзя удалить этот фрагмент.'.repeat(600)
    const reports = []
    for (const c of cases) reports.push({ ...c, rendered: await fitAdaptiveLayout(c.input, plan, 'a'.repeat(64), options) })
    return reports
  }, adaptiveFixture())
  const { plan } = adaptiveFixture()
  for (const c of result) {
    validateAdaptiveFit(c.rendered.fit, plan, c.input, 'a'.repeat(64), c.rendered.preview)
    await writeFile(info.outputPath(`${c.id}.png`), Buffer.from(c.rendered.preview.split(',')[1], 'base64'))
  }
  await writeFile(info.outputPath('measurements.json'), JSON.stringify(result.map(c => ({ id: c.id, input: c.input, fit: c.rendered.fit })), null, 2))
  const fit = (id: string) => result.find(c => c.id === id)!.rendered.fit
  const box = (id: string, block: string) => fit(id).trials.at(-1)!.boxes.find(b => b.id === block)!
  for (const id of ['balanced', 'uneven', 'long-title', 'dense']) expect(fit(id).passed, `${id}: ${JSON.stringify(fit(id).trials.map(t => ({ columns: t.columns, fontStep: t.fontStep, issues: t.issues })))}`).toBe(true)
  expect(box('uneven', 'block-0').width).toBeGreaterThan(box('balanced', 'block-0').width)
  expect(box('uneven', 'block-1').width).toBeLessThan(box('balanced', 'block-1').width)
  expect(box('long-title', 'title').height).toBeGreaterThan(box('balanced', 'title').height)
  expect(box('long-title', 'block-0').height).toBeLessThan(box('balanced', 'block-0').height)
  expect(fit('dense').trials.length).toBeGreaterThan(1)
  expect(fit('excessive').passed).toBe(false)
  expect(fit('excessive').trials.length).toBe(adaptiveCandidates(plan).length)
  const good = result[0], bad = structuredClone(good.rendered.fit)
  bad.trials[0].texts[0].text = 'Shortened'
  expect(() => validateAdaptiveFit(bad, plan, good.input, 'a'.repeat(64), good.rendered.preview)).toThrow()
  const noPixels = structuredClone(good.rendered.fit); noPixels.previewCheck!.textBlocks[0].pixels = 0
  expect(() => validateAdaptiveFit(noPixels, plan, good.input, 'a'.repeat(64), good.rendered.preview)).toThrow()
  for (const mutate of [
    (f: typeof bad) => { f.trials[0].boxes[2].x += 5 },
    (f: typeof bad) => { f.trials[0].texts[1].fontSize-- },
    (f: typeof bad) => { f.trials[0].texts.pop() },
    (f: typeof bad) => { f.trials[0].columns = 3 },
    (f: typeof bad) => { f.planHash = 'b'.repeat(64) },
  ]) { const altered = structuredClone(good.rendered.fit); mutate(altered); expect(() => validateAdaptiveFit(altered, plan, good.input, 'a'.repeat(64), good.rendered.preview)).toThrow() }
  const excessive = result.find(c => c.id === 'excessive')!, f = await libraryFixture(), originalFetch = globalThis.fetch
  f.context.inputs = [excessive.input]
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify({ version: 'library-selection-1', recipes: [], adaptiveVersion: ADAPTIVE_VERSION, hash: await contentHash({ recipes: [], adaptiveVersion: ADAPTIVE_VERSION }) }))
  const config = { apiKey: 'synthetic-only', model: 'test', baseUrl: 'https://provider.invalid/v1' }
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ recipeId: ADAPTIVE_RECIPE_ID, recipeVersion: ADAPTIVE_VERSION, itemCount: null, plan, reason: 'Synthetic negative test' }) } }] })) }
  try {
    for (let round = 0; round < 2; round++) {
      const action = { inputId: f.context.inputId, slideId: excessive.input.slideId, round }
      await (await startLayoutAction(f.bucket, f.context, { ...action, action: 'plan', evidence: { fontTokens: ['font-1'] } }, config)).execute?.()
      const target = (await layoutView(f.bucket, f.context)).next!
      await startLayoutAction(f.bucket, f.context, { ...action, action: 'report', fit: { ...excessive.rendered.fit, planHash: target.planHash }, preview: excessive.rendered.preview }, config)
    }
    const final = await layoutView(f.bucket, f.context)
    expect(final.status).toBe('blocked'); expect(final.slides[0].previewRound).toBe(1)
    expect(final.budget.used).toBe(2); expect(calls).toBe(2)
    expect(final.slides[0].adaptiveFit?.passed).toBe(false)
  } finally { globalThis.fetch = originalFetch }
})

for (const fixture of [adaptiveFixture, adaptiveComponentFixture, adaptiveGridFixture, adaptivePaletteFixture]) test(`ordinary worker autonomously plans, fits, reviews and reopens ${fixture.name} with no extra requests`, async ({ page }, info) => {
  const f = await libraryFixture(), { input, plan } = fixture()
  f.context.inputs = [input]; f.context.prefix = `presentation-layouts/${f.project.id}/${f.context.inputId}`
  const version = plan.version ?? ADAPTIVE_VERSION, renderVersion = adaptiveRenderVersion(plan.version)
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify({ version: 'library-selection-1', recipes: [], adaptiveVersion: version, hash: await contentHash({ recipes: [], adaptiveVersion: version }) }))
  const config = { apiKey: 'synthetic-only', model: 'test', baseUrl: 'https://provider.invalid/v1' }, originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(config.baseUrl)) throw Error(`Unexpected test request: ${url}`)
    calls++
    const body = JSON.parse(init!.body as string)
    const result = body.response_format.json_schema.name === 'adaptive_layout_review' ? { verdict: 'pass', issues: [] } : { recipeId: ADAPTIVE_RECIPE_ID, recipeVersion: version, itemCount: null, plan, reason: 'Synthetic provider response' }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }))
  }
  try {
    await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
    await page.route(`**/api/projects/${f.project.id}/layout`, async route => {
      if (route.request().method() === 'POST') {
        const action = route.request().postDataJSON() as LayoutAction
        const started = await startLayoutAction(f.bucket, f.context, action, config); await started.execute?.()
        await route.fulfill({ json: { accepted: true } }); return
      }
      await route.fulfill({ json: { ...await layoutView(f.bucket, f.context), configured: true } })
    })
    await page.goto('/processing-worker'); await page.waitForFunction(() => !!window.__mspRunLayout)
    const run = () => page.evaluate(async ({ id, input }) => window.__mspRunLayout!(id, input), { id: f.project.id, input: f.context.inputId })
    expect(await run()).toEqual({ ok: true })
    const view = await layoutView(f.bucket, f.context)
    expect(view.status).toBe('ready'); expect(view.budget.used).toBe(2); expect(calls).toBe(2)
    const job = { id: f.project.id, sourceRevision: f.project.revision, inputId: f.context.inputId, renderVersion: 'layout-dom-3', status: 'complete', progress: { completed: 1, total: 1 }, slides: [{ id: input.slideId, title: input.title }] }
    await f.bucket.put(`presentation-jobs/${f.project.id}.json`, JSON.stringify(job))
    const saved = await readProjectPresentation(f.bucket, f.project.id)
    expect(saved?.slides).toHaveLength(1); expect(saved!.slides[0].image).toContain(renderVersion)
    const preview = await readProjectPreview(f.bucket, f.project.id, { inputId: f.context.inputId, slideId: input.slideId, round: 0, render: renderVersion })
    expect(preview).toMatch(/^data:image\/png/)
    await writeFile(info.outputPath('adaptive-worker.png'), Buffer.from(preview!.split(',')[1], 'base64'))
    await writeFile(info.outputPath('measurement.json'), JSON.stringify(view.slides[0].adaptiveFit, null, 2))
    if (plan.version) {
      const fit = view.slides[0].adaptiveFit!, final = fit.trials.at(-1)!
      expect(final.components).toHaveLength(2)
      expect(final.components![0].y).toBeCloseTo(final.components![1].y, 0)
      expect(final.components![1].x).toBeGreaterThan(final.components![0].x + final.components![0].width)
      expect(fit.previewCheck!.textBlocks.filter(t => t.block.includes(':')).every(t => t.pixels > 20)).toBe(true)
      for (const mutate of [
        (t: typeof final) => { t.components!.pop() },
        (t: typeof final) => { t.components![0].fields[0].text = '999%' },
        (t: typeof final) => { t.components![0].scale *= .5 },
        (t: typeof final) => { t.components![0].assetsLoaded = false },
        (t: typeof final) => { t.components![0].fields[0].fontSize = 10 },
        (t: typeof final) => { t.components![0].fields[0].ink.width = 3000 },
        (t: typeof final) => { const f = t.components![0].fields[1]; f.ink.height = f.box.y + f.box.height + 4 - f.ink.y },
      ]) { const bad = structuredClone(fit); mutate(bad.trials.at(-1)!); expect(() => validateAdaptiveFit(bad, plan, input, view.slides[0].planHash!, preview!)).toThrow() }
    }
    const before = structuredClone([...f.data])
    await page.reload(); await page.waitForFunction(() => !!window.__mspRunLayout)
    expect(await run()).toEqual({ ok: true }); expect(calls).toBe(2); expect([...f.data]).toEqual(before)
  } finally { globalThis.fetch = originalFetch }
})

for (const fixture of [adaptiveComponentFixture, adaptiveGridFixture, adaptivePaletteFixture]) test(`native adaptive cards reject excess text and broken artwork without silently becoming plain text: ${fixture.name}`, async ({ page }, info) => {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const reports = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input), options = { fontCss: Object.values(fonts.css).join('\n') }
    const excessive = structuredClone(input), broken = structuredClone(input)
    excessive.content.find(f => f.id === 'label1')!.text = 'Подробное описание условий без разрешения на сокращение. '.repeat(60)
    broken.components[0].sourceLayout!.graphic = '<svg viewBox="0 0 500 240"><image href="data:image/png;base64,AAAA" width="500" height="240"/></svg>'
    const results = []
    for (const [id, next] of [['excessive-native', excessive], ['broken-artwork', broken]] as const) results.push({ id, input: next, rendered: await fitAdaptiveLayout(next, plan, 'c'.repeat(64), options) })
    return results
  }, fixture())
  const { plan } = fixture()
  for (const r of reports) {
    expect(r.rendered.fit.passed).toBe(false)
    expect(r.rendered.fit.trials).toHaveLength(adaptiveCandidates(plan).length)
    expect(r.rendered.fit.trials.at(-1)!.components).toHaveLength(2)
    validateAdaptiveFit(r.rendered.fit, plan, r.input, 'c'.repeat(64), r.rendered.preview)
    await writeFile(info.outputPath(`${r.id}.png`), Buffer.from(r.rendered.preview.split(',')[1], 'base64'))
  }
})
