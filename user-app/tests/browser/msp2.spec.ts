import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { msp2Run, msp2Text } from '../fixtures/msp2'
import { localPlan, sourcePackets } from '../../lib/msp2/planner'
import { saveResult, validateResult, runKey, saveProject, readProject, readRun, changeRun } from '../../lib/msp2/storage'
import { memoryBucket } from '../helpers/memory-bucket'
import { labUnitMetric } from '../../component-lab/fixtures'
import { sourceCandidate } from '../../lib/component-lab/source'
import { LAB_VERSION } from '../../lib/component-lab/contract'
import type { Project, Run } from '../../lib/msp2/types'

const fonts = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
  await page.route('**/api/fonts/google?*', r => r.fulfill({ status: 404, json: { files: [] } }))
}

test('MSP 2 measures, ranks and exports exact text, chart and table', async ({ page }, info) => {
  await fonts(page); await page.goto('/processing-worker')
  const run = msp2Run()
  const results = await page.evaluate(async run => {
    const path = '/browser/msp2-render.tsx', { renderMsp2Slide } = await import(path) as typeof import('../../browser/msp2-render'), out = []
    for (const packet of run.packets) out.push(await renderMsp2Slide(run.library, run.plans[packet.id]))
    return out
  }, run)
  for (const [i, result] of results.entries()) {
    expect(await validateResult(run, result)).toEqual(result)
    expect(result.search.measuredWidths).toBeGreaterThan(10)
    expect(result.search.checked).toBeGreaterThan(1)
    await writeFile(info.outputPath(`slide-${i + 1}.png`), Buffer.from(result.preview.split(',')[1], 'base64'))
    await writeFile(info.outputPath(`slide-${i + 1}.json`), JSON.stringify({ ...result, preview: undefined, html: undefined }, null, 2))
  }
  expect(results[0].text.find(t => t.field === 'value')!.value).toBe('76%')
  expect(results[1].html).toContain('data-msp-chart')
  expect(results[2].html).toContain('data-editable-table')
  const changed = structuredClone(results[0]); changed.text[1].value = '99%'
  await expect(validateResult(run, changed)).rejects.toThrow(/содержание/)
  const tiny = structuredClone(results[0]); tiny.text[0].size = 16
  await expect(validateResult(run, tiny)).rejects.toThrow(/читаемость/)
  const wrong = structuredClone(results[0]); wrong.planHash = 'f'.repeat(64)
  await expect(validateResult(run, wrong)).rejects.toThrow(/другому плану/)
  const saved = await page.evaluate(html => {
    const root = document.createElement('div'); root.innerHTML = html; document.body.appendChild(root)
    const cells = [...root.querySelectorAll<HTMLElement>('[data-msp-block]')].map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))
    root.remove(); return cells
  }, results[2].html)
  expect(saved.every(c => c.width > 0 && c.height > 0)).toBe(true)
})

test('MSP 2 keeps prepared component typography and source identity', async ({ page }) => {
  await fonts(page); await page.goto('/processing-worker')
  const run = msp2Run('# Результат\n67%\nПутешественники сравнивают несколько направлений'), source = await sourceCandidate(labUnitMetric(), 'fixture')
  const result = await page.evaluate(async ({ run, profile, version }) => {
    const f = '/browser/component-lab/fonts.ts', p = '/lib/msp2/planner.ts', r = '/browser/msp2-render.tsx'
    const resources = await (await import(f) as typeof import('../../browser/component-lab/fonts')).sourceFonts(run.library.uploadId, profile, true)
    run.library.prepared['imported-metric'] = { version, profile, faces: resources.faces ?? [], assets: resources.artwork?.assets ?? [], fidelity: { status: 'preserved' } } as typeof run.library.prepared[string]
    const plan = (await import(p) as typeof import('../../lib/msp2/planner')).localPlan(run.packets[0], run.library)
    const receipt = await (await import(r) as typeof import('../../browser/msp2-render')).renderMsp2Slide(run.library, plan)
    return { receipt, plan, library: run.library }
  }, { run, profile: source.profile!, version: `preparation-1:${source.profile!.version}:${LAB_VERSION}` })
  run.library = result.library; run.plans['slide-1'] = result.plan
  expect(result.receipt.components.map(c => c.componentId)).toEqual(['imported-metric'])
  expect(result.receipt.text.find(t => t.field === 'value')!.value).toBe('67%')
  await validateResult(run, result.receipt)
})

test('MSP 2 refuses oversize data without clipping cells or saving a partial success', async ({ page }) => {
  await fonts(page); await page.goto('/processing-worker')
  const run = msp2Run(JSON.stringify({ title: 'Все строки', columns: ['Имя', 'Значение'], rows: Array.from({ length: 80 }, (_, i) => [`Строка ${i}`, String(i)]) }))
  const message = await page.evaluate(async run => {
    try { const path = '/browser/msp2-render.tsx'; await (await import(path) as typeof import('../../browser/msp2-render')).renderMsp2Slide(run.library, run.plans['slide-1']); return 'unexpected success' }
    catch (e) { return (e as Error).message }
  }, run)
  expect(message).toContain('Содержание не помещается')
  expect(run.plans['slide-1'].content.blocks[1].data!.values.rows).toHaveLength(80)
})

test('new Figma flow creates, reopens, edits and exports an independent MSP 2 revision', async ({ page }, info) => {
  await fonts(page)
  const { bucket } = memoryBucket(), base = msp2Run(), style = { id: base.library.uploadId, name: base.library.name, slideCount: 12, componentCount: 42, styleCount: 8, colors: ['#00805E', '#162D40', '#FFFFFF'], fonts: ['Play'], createdAt: base.createdAt, fileName: 'fixture.pptx', sourceId: 'test' }
  await bucket.put(`workspace/style-bank/${style.id}.json`, JSON.stringify(style))
  let project: Project | null = null, run: Run | null = null, posts = 0
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/style-bank', r => r.fulfill({ json: { styles: [style] } }))
  await page.route(/\/api\/msp2\/projects(?:\/|\?|$)/, async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(), body = method === 'GET' ? null : route.request().postDataJSON()
    if (method !== 'GET') posts++
    try {
      if (path.endsWith('/run')) {
        if (method === 'POST') {
          if (body.action === 'start') {
            if (!run || run.revision !== project!.revision) { run = { ...base, projectId: project!.id, revision: project!.revision, packets: sourcePackets(project!.text), plans: {}, results: {}, errors: {} }; run.plans = Object.fromEntries(run.packets.map(p => [p.id, localPlan(p, run!.library)])); await bucket.put(runKey(project!.id, run.revision), JSON.stringify(run)) }
          } else if (body.action === 'result') run = await saveResult(bucket, project!.id, body.revision, body.result)
          else if (body.action === 'fail') run = await changeRun(bucket, project!.id, body.revision, r => { r.errors[body.slideId] = body.error })
          else throw Error('A local run must not call the model')
        }
        await route.fulfill({ json: { run, configured: false } }); return
      }
      if (path === '/api/msp2/projects') {
        if (method === 'POST') { project = await saveProject(bucket, body); await route.fulfill({ status: 201, json: { project } }) }
        else await route.fulfill({ json: { projects: [] } }); return
      }
      if (method === 'PUT') { const { baseRevision, ...input } = body; project = await saveProject(bucket, input, baseRevision) }
      await route.fulfill({ json: { project } })
    } catch (e) { await route.fulfill({ status: 409, json: { error: (e as Error).message } }) }
  })
  await page.setViewportSize({ width: 1920, height: 1200 }); await page.goto('/msp2/create')
  await expect(page.getByRole('radio')).toBeVisible()
  await page.locator('#msp2-content').fill(msp2Text)
  await page.locator('#msp2-content').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: info.outputPath('create-1920.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сгенерировать' }).click()
  await expect(page.locator('.m2-slide-preview img')).toHaveCount(3)
  await expect(page.getByRole('status').filter({ hasText: 'Готово 3 из 3' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('project-1920.png'), fullPage: true })
  const first = project as unknown as Project, requests = posts
  await page.reload(); await expect(page.locator('.m2-slide-preview img')).toHaveCount(3); expect(posts).toBe(requests)
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать слайды' }).click()
  expect((await download).suggestedFilename()).toBe('MSP-2-slides.zip')
  await page.getByRole('button', { name: 'Открыть слайд 1', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Закрыть просмотр' }).press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Редактировать содержание' }).click()
  await page.locator('#msp2-content').fill('# Новое содержание\n42%\nточно сохранённое значение')
  await page.getByRole('button', { name: 'Сгенерировать' }).click()
  await expect(page.locator('.m2-slide-preview img')).toHaveCount(1)
  const next = (await readProject(bucket, first.id))!
  expect(next.revision).not.toBe(first.revision)
  expect(Object.keys((await readRun(bucket, first.id, first.revision))!.results)).toHaveLength(3)
  await page.getByRole('button', { name: 'Редактировать содержание' }).click()
  await page.locator('#msp2-content').fill('# Длинный слайд\n' + 'Исходное содержание сохраняется целиком. '.repeat(800) + '\n---\n# Готовый сосед\n75%\nточное значение')
  await page.getByRole('button', { name: 'Сгенерировать' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Готово 1 из 2' })).toBeVisible()
  await expect(page.locator('.m2-slide-card').nth(0).getByText(/Содержание не помещается/)).toBeVisible()
  await expect(page.locator('.m2-slide-card').nth(1).locator('.m2-slide-preview img')).toHaveCount(1)
  const completed = JSON.stringify((run as unknown as Run).results['slide-2'])
  await page.getByRole('button', { name: 'Продолжить создание' }).click()
  await expect(page.getByRole('button', { name: 'Продолжить создание' })).toBeVisible()
  expect(JSON.stringify((run as unknown as Run).results['slide-2'])).toBe(completed)
  expect(errors).toEqual([])
})

test('MSP 2 cover keeps imported artwork, readable contrast and portable assets', async ({ page }) => {
  const { backgroundFixture } = await import('../fixtures/backgrounds'), { buildBackgroundCatalog } = await import('../../lib/design-system/backgrounds')
  const f = backgroundFixture(), run = msp2Run('# Путешествия начинаются с внимания\nПомогаем найти свой маршрут и сохранить впечатления.')
  run.library.backgrounds = buildBackgroundCatalog(f.snapshot, f.library, 'fixture')
  run.plans['slide-1'] = localPlan(run.packets[0], run.library)
  expect(run.plans['slide-1'].background).toBeTruthy()
  await fonts(page)
  await page.route('**/api/uploads/*/assets/image', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=', 'base64') }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async run => { const path = '/browser/msp2-render.tsx'; return (await import(path) as typeof import('../../browser/msp2-render')).renderMsp2Slide(run.library, run.plans['slide-1']) }, run)
  expect(result.html).toContain('data-msp-background')
  expect(result.html).toContain('data:image/png;base64,')
  expect(result.html).not.toContain('/assets/image')
  expect(result.text.every(t => t.x + t.width < 1440)).toBe(true)
  expect(result.text[0].color).toBe('rgb(255, 255, 255)')
  await validateResult(run, result)
})

test('native bar, area and circular charts retain exact decimals, zero and repeated values', async ({ page }) => {
  await fonts(page); await page.goto('/processing-worker')
  const source = JSON.stringify({ tables: ['bar', 'area', 'donut', 'pie'].map(chartType => ({ title: chartType, chartType, categories: ['Первое', 'Второе'], series: [{ name: 'Результат', values: [0, 1.23456789] }, ...chartType === 'bar' || chartType === 'area' ? [{ name: 'Сравнение', values: [0, 1.23456789] }] : []] })) })
  const run = msp2Run(source)
  const results = await page.evaluate(async run => {
    const path = '/browser/msp2-render.tsx', renderer = await import(path) as typeof import('../../browser/msp2-render'), results = []
    for (const packet of run.packets) results.push(await renderer.renderMsp2Slide(run.library, run.plans[packet.id]))
    return results
  }, run)
  for (const result of results) {
    await validateResult(run, result)
    expect(result.html).toContain('1,23456789')
    expect(result.html).toContain('data-value="0"')
    expect(result.html).toContain('data-value="1.23456789"')
  }
  const colors = await page.evaluate(html => { const el = document.createElement('div'); el.innerHTML = html; return [...el.querySelectorAll('svg [data-value]')].map(n => n.getAttribute('fill')) }, results[0].html)
  expect(colors).not.toContain('#FFFFFF')
})
