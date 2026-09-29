import { test, expect, openTestProject } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { layoutInput, layoutPlan } from '../fixtures/layout'
import { layoutStates } from '../../lib/presentations/recipes/layout-engine-v1/states'
import { materialIdentity } from '../../lib/presentations/material-identity'
import { contentHash } from '../../lib/design-system/catalog'
import { validLayoutMeasurement, type LayoutView } from '../../lib/presentations/layout-workflow'
import { controlPptx } from '../fixtures/control-pptx'

test('all authored states are measured in DOM; PNG is nonblank and overflow cannot shrink arbitrary text', async ({ page }, info) => {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/')
  const results = await page.evaluate(async ({ states, input, plan }) => {
    const executionPath = '/browser/layout-execution.ts', fontPath = '/browser/layout-fonts.ts', htmlPath = '/lib/presentations/layout-html.ts'
    const { fitLayout, measureLayout, verifyLayoutPreview } = await import(executionPath) as typeof import('../../browser/layout-execution')
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { renderLayoutHtml } = await import(htmlPath) as typeof import('../../lib/presentations/layout-html')
    const fonts = await prepareLayoutFonts(input), results = []
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0077ff'; ctx.fillRect(0, 0, 32, 32)
    const graphic = canvas.toDataURL()
    for (const state of states) {
      const i = structuredClone(input), p = structuredClone(plan); i.content[0].text = 'Тезис'; p.primary[0].end = 5; p.preferredState = state.id
      const add = (text: string) => { const id = `f${i.content.length + 1}`; i.content.push({ id, text }); return [{ fragmentId: id, start: 0, end: text.length }] }
      if (state.context) p.context = [add('Контекст'), add('2026')]
      if (state.factsY !== undefined) p.facts = [add('27'), add('14'), add('36')]
      else if (state.wideInfo) p.facts = [add('27 участников')]
      if (state.footer) p.footer = add('Источник данных')
      p.support = (state.support ?? []).map(() => ({ parts: add('Поддержка тезиса') }))
      p.visuals = (state.visuals ?? []).map((_, n) => ({ id: `graphic-${n}`, reason: 'Synthetic pixel test', fit: 'contain' as const }))
      const result = await fitLayout(i, p, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n'), graphics: Object.fromEntries(p.visuals.map(v => [v.id, graphic])) })
      results.push({ id: state.id, fit: result.fit, plan: p, preview: result.preview })
    }
    const long = structuredClone(input); long.content[0].text = 'Нельзя обрезать исходный текст. '.repeat(150)
    const longPlan = structuredClone(plan); longPlan.primary[0].end = long.content[0].text.length
    const overflow = await fitLayout(long, longPlan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
    const componentInput = structuredClone(input), componentPlan = structuredClone(plan)
    componentInput.content.push({ id: 'metric', text: '42' })
    componentInput.components = [{ id: 'metric-template', kind: 'metric', name: 'Metric fixture', description: 'Synthetic component', tags: ['test'], sourceIds: ['source'], memberIds: [], slide: 1, width: 400, height: 180, graphicHtml: {}, dataStatus: 'native', config: {}, style: { font: 'Play', metricSize: 96 }, data: { value: '99', unit: '%', title: 'Old example' } }]
    const parts = [{ fragmentId: 'metric', start: 0, end: 2 }]
    componentPlan.preferredState = 'title-support-a'; componentPlan.support = [{ parts, component: { id: 'metric-template', fields: [{ path: 'value', parts }] } }]
    const component = await fitLayout(componentInput, componentPlan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
    componentInput.components[0].style.metricSize = 500
    const fallback = await fitLayout(componentInput, componentPlan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
    const contextInput = structuredClone(input), contextPlan = structuredClone(plan)
    const addContext = (text: string) => { const id = `c${contextInput.content.length}`; contextInput.content.push({ id, text }); return [{ fragmentId: id, start: 0, end: text.length }] }
    contextPlan.preferredState = 'context-facts-title'; contextPlan.context = [addContext('ИССЛЕДОВАНИЕ → 2026')]
    contextPlan.facts = ['27 экспертов', '14 регионов', '36%'].map(addContext)
    const context = await fitLayout(contextInput, contextPlan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
    const overlapPlan = structuredClone(plan); overlapPlan.preferredState = 'semantic-graphic'; overlapPlan.visuals = [{ id: 'graphic', reason: 'Collision fixture', fit: 'contain' }]
    const host = document.createElement('div'); host.innerHTML = renderLayoutHtml(overlapPlan, input, 'semantic-graphic', { graphic }); document.body.appendChild(host)
    const root = host.firstElementChild as HTMLElement
    root.querySelector<HTMLElement>('[data-layout-visual]')!.style.top = '497px'
    const collision = await measureLayout(root, input, overlapPlan, 'semantic-graphic')
    root.querySelector<HTMLElement>('[data-layout-block="primary"]')!.style.left = '-100px'
    const clipping = await measureLayout(root, input, overlapPlan, 'semantic-graphic'); host.remove()
    const missingHost = document.createElement('div'); missingHost.innerHTML = renderLayoutHtml(contextPlan, contextInput, context.fit.stateId!, {}, false, true); document.body.appendChild(missingHost)
    const damaged = new Image(); damaged.src = context.preview; await damaged.decode()
    canvas.width = damaged.width; canvas.height = damaged.height; ctx.drawImage(damaged, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 500, 80)
    let missingText = ''
    try { await verifyLayoutPreview(missingHost.firstElementChild as HTMLElement, canvas.toDataURL()) } catch (error) { missingText = String(error) }
    missingHost.remove()
    const image = new Image(); image.src = results[0].preview; await image.decode(); canvas.width = image.width; canvas.height = image.height; ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0
    for (let n = 0; n < pixels.length; n += 4) if (pixels[n] < 100 && pixels[n + 3] > 200) dark++
    return { states: results, overflow, component, fallback, collision, clipping, missingText, context: { ...context, plan: contextPlan }, pixels: { width: image.width, height: image.height, dark } }
  }, { states: layoutStates, input: layoutInput(), plan: layoutPlan() })
  await writeFile(info.outputPath('measurements.json'), JSON.stringify(results.states.map(({ id, fit, plan }) => ({ id, fit, plan })), null, 2))
  for (const result of results.states) {
    expect(result.fit.trials[0].issues, result.id).toEqual([])
    expect(result.fit.stateId, result.id).toBe(result.id)
    expect(validLayoutMeasurement(result.fit, result.plan, 'a'.repeat(64)), result.id).toBe(true)
    await writeFile(info.outputPath(`${result.id}.png`), Buffer.from(result.preview.split(',')[1], 'base64'))
  }
  expect(results.pixels).toMatchObject({ width: 1280, height: 720 }); expect(results.pixels.dark).toBeGreaterThan(500)
  expect(results.overflow.fit.passed).toBe(false); expect(results.overflow.fit.trials.every(t => t.issues.length)).toBe(true)
  expect(results.overflow.preview).toBe('')
  expect(results.component.fit.passed).toBe(true); expect(results.component.fit.plainComponents).toBe(false)
  expect(results.component.html).toContain('data-layout-component="metric-template"'); expect(results.component.html).not.toContain('Old example')
  expect(results.fallback.fit.passed).toBe(true); expect(results.fallback.fit.plainComponents).toBe(true)
  expect(results.fallback.fit.trials[0].issues.some(i => i.code === 'overflow' || i.code === 'component-fit')).toBe(true)
  expect(results.fallback.html).toContain('>42<'); expect(results.fallback.html).not.toContain('data-layout-component=')
  expect(results.context.fit.passed).toBe(true)
  expect(results.context.fit.trials[0].issues.some(i => i.block === 'context-0')).toBe(true)
  expect(results.context.fit.trials.at(-1)?.wideContext).toBe(true)
  expect(results.context.fit.trials.at(-1)?.measurements.find(m => m.block === 'context-0')).toMatchObject({ width: 643, fontSize: 48 })
  expect(validLayoutMeasurement(results.context.fit, results.context.plan, 'a'.repeat(64))).toBe(true)
  expect(results.collision.issues.some(i => i.code === 'collision')).toBe(true)
  expect(results.clipping.issues.some(i => i.code === 'canvas-overflow')).toBe(true)
  expect(results.missingText).toContain('PREVIEW_TEXT_MISSING')
  expect(results.missingText).toContain('context-0')
  await writeFile(info.outputPath('wide-context.png'), Buffer.from(results.context.preview.split(',')[1], 'base64'))
})

test('the background entry point retries transient plan and review failures, but never a spent budget', async ({ page }) => {
  const input = layoutInput(), plan = layoutPlan(input), planHash = await contentHash(plan), inputId = 'f'.repeat(64)
  let phase = 'plan', posts = 0, failedReview = false, budgetSpent = false, fit: LayoutView['slides'][number]['fit']
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot({ animations: 'disabled' })).toString('base64'))
  await page.route('**/api/projects/autonomous/layout', async route => {
    if (route.request().method() === 'POST') {
      posts++; const body = route.request().postDataJSON()
      if (phase === 'plan') { expect(body.retry).toBe(false); phase = 'failed' }
      else if (phase === 'failed' && !fit) { expect(body.retry).toBe(true); phase = 'render' }
      else if (phase === 'render') { expect(validLayoutMeasurement(body.fit, plan, planHash)).toBe(true); expect(body.fit.previewCheck.width).toBe(1920); fit = body.fit; phase = 'review' }
      else if (!failedReview) { failedReview = true; phase = 'failed' }
      else { expect(body.action).toBe('review'); expect(body.retry).toBe(true); phase = 'ready' }
      await route.fulfill({ json: { accepted: true } }); return
    }
    const slide = { id: input.slideId, title: input.title, phase: budgetSpent ? 'failed' : phase, round: 0, ...(fit || phase === 'render' ? { plan, planHash } : {}), fit,
      errorCode: budgetSpent ? 'LAYOUT_BUDGET_EXHAUSTED' : fit ? 'QWEN_UNAVAILABLE' : 'QWEN_TRUNCATED', error: budgetSpent ? 'Достигнут предел запросов.' : 'Временный сбой.' }
    await route.fulfill({ json: { configured: true, inputId, materialId: 'fixture', uploadId: input.uploadId, status: phase === 'ready' && !budgetSpent ? 'ready' : 'working', slides: [slide], next: { ...slide, input } } })
  })
  await page.goto('/processing-worker'); await page.waitForFunction(() => !!window.__mspRunLayout)
  expect(await page.evaluate(async inputId => window.__mspRunLayout!('autonomous', inputId), inputId)).toEqual({ ok: true })
  expect(posts).toBe(5)
  budgetSpent = true
  expect(await page.evaluate(async inputId => window.__mspRunLayout!('autonomous', inputId), inputId)).toMatchObject({ ok: false, retryable: false, error: 'Достигнут предел запросов.' })
  expect(posts).toBe(5)
})

test('project retries truncation explicitly, fits, reviews and resumes without another request on desktop and mobile', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Layout test.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const uploadId = new URL(page.url()).pathname.split('/').at(-1)!, input = layoutInput(); input.uploadId = uploadId
  const inputId = 'e'.repeat(64), plan = layoutPlan(input), planHash = await contentHash(plan)
  let phase: 'plan' | 'failed' | 'render' | 'review' | 'ready' = 'plan', posts = 0, preview = '', fit: LayoutView['slides'][number]['fit']
  await page.route('**/api/projects/*/structure', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/structure$/, ''), current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { configured: true, materialId: await materialIdentity(current.text), structure: { status: 'ready', outline: { slides: [{}] } } } })
  })
  await page.route('**/api/projects/*/layout', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/layout$/, ''), current = (await (await request.get(path)).json()).project
    if (route.request().method() === 'POST') {
      posts++; const body = route.request().postDataJSON()
      if (phase === 'plan') { expect(body.action).toBe('plan'); expect(body.retry).toBe(false); phase = 'failed' }
      else if (phase === 'failed') { expect(body.action).toBe('plan'); expect(body.retry).toBe(true); expect(body.evidence.fontTokens).toContain('font-1'); phase = 'render' }
      else if (phase === 'render') { expect(body.action).toBe('report'); expect(validLayoutMeasurement(body.fit, plan, planHash)).toBe(true); fit = body.fit; preview = body.preview; phase = 'review' }
      else { expect(body.action).toBe('review'); phase = 'ready' }
      await route.fulfill({ json: { accepted: true } }); return
    }
    const slide = { id: input.slideId, title: input.title, phase, round: 0, ...(['render', 'review', 'ready'].includes(phase) ? { plan, planHash } : {}), ...(fit ? { fit, previewRound: 0 } : {}),
      ...(phase === 'failed' ? { error: 'Ответ модели обрезан по лимиту при подготовке слайда. Исходный текст и завершённые этапы сохранены. Нажмите «Продолжить создание».' } : {}) }
    await route.fulfill({ json: { configured: true, inputId, materialId: await materialIdentity(current.text), uploadId, status: phase === 'ready' ? 'ready' : 'working', slides: [slide], next: phase === 'ready' ? null : { ...slide, input } } })
  })
  await page.route('**/api/projects/*/layout/preview?*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(preview.split(',')[1], 'base64') }))
  await openTestProject(page, request, uploadId)
  await expect(page.getByRole('status').filter({ hasText: 'обрезан по лимиту при подготовке слайда' })).toBeVisible()
  expect(posts).toBe(1); await expect(page.locator('.ws-deck-previews img')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload()
  await expect(page.getByRole('button', { name: 'Продолжить создание', exact: true })).toBeVisible()
  expect(posts).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('layout-truncated-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('button', { name: 'Продолжить создание', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 1' })).toBeVisible({ timeout: 60000 })
  expect(posts).toBe(4); await expect(page.locator('.ws-deck-previews img')).toBeVisible()
  await page.screenshot({ path: info.outputPath('layout-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 1' })).toBeVisible()
  expect(posts).toBe(4); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('layout-mobile.png'), fullPage: true })
  await page.locator('#presentation-content').fill('Изменённое содержание')
  await expect(page.locator('.ws-deck-previews img')).toHaveCount(0)
})
