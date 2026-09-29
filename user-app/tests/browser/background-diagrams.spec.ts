import { test, expect } from './workspace-fixture'
import { backgroundFixture } from '../fixtures/backgrounds'
import { nativePptx } from '../fixtures/native-pptx'
import { buildBackgroundCatalog } from '../../lib/design-system/backgrounds'
import { recognizedDiagram } from '../../lib/design-system/diagram-graph'
import { graphicParts, GRAPHIC_COMPONENTS_VERSION } from '../../lib/design-system/graphic-components'
import type { ReconstructionResult } from '../../lib/design-system/reconstruction-contract'

test('source backgrounds match pixels including crop, and preserve artwork proportions on new formats', async ({ page }) => {
  await page.goto('/styles')
  const fixture = backgroundFixture()
  const result = await page.evaluate(async ({ snapshot, library, fill, art }) => {
    const load = (path: string) => import(/* webpackIgnore: true */ path)
    const [{ buildBackgroundCatalog, assembleBackground }, { renderSlidePreview }, { parsePageIR }, { graphicPixels, compareGraphicPixels }] = await Promise.all([load('/lib/design-system/backgrounds.ts'), load('/vendor/drag/src/formats/pptx/preview.ts'), load('/vendor/drag/src/core/page-ir.ts'), load('/lib/design-system/reconstruction-browser.ts')])
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 480
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff00aa'; ctx.fillRect(0, 0, 240, 480); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 50, 50)
    const bytes = new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()), assets = [{ id: 'image', bytes }]
    const render = (elements: unknown[], width: number, height: number) => renderSlidePreview(parsePageIR({ schemaVersion: 1, id: 'test', sourceIndex: 0, elements, assets, width, height, degradations: [] }), 800)
    const catalog = buildBackgroundCatalog(snapshot, library, 'fixture'), scene = assembleBackground(catalog, catalog.presets[0].selection, { width: 800, height: 450 })
    const before = await graphicPixels(await render([fill, art], 800, 450)), after = await graphicPixels(await render(scene.elements, 800, 450))
    const portrait = assembleBackground(catalog, catalog.presets[0].selection, { width: 450, height: 800 })
    await render(portrait.elements, 450, 800)
    return { comparison: compareGraphicPixels(before, after), bounds: portrait.elements[0].children[1].bounds }
  }, fixture)
  expect(result.comparison.pixelError).toBe(0)
  expect(result.comparison.foregroundRecall).toBe(1)
  expect(result.bounds.width / result.bounds.height).toBeCloseTo(200 / 450)
  expect(result.bounds.x + result.bounds.width).toBe(450)
})

test('main service exposes backgrounds and builds an editable branching diagram without model requests', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const { snapshot, library } = backgroundFixture(), backgrounds = buildBackgroundCatalog(snapshot, library, 'fixture')
  const diagram = recognizedDiagram({ kind: 'diagram', name: 'Процесс', description: '', width: 400, height: 240, background: '#ffffff', nodes: [{ id: 'a', bounds: { x: 20, y: 20, width: 100, height: 60 }, shape: 'capsule', fill: '#0077ff', stroke: null, strokeWidth: 0, text: 'Вход', textColor: '#ffffff', fontSize: 14, font: 'Arial' }, { id: 'b', bounds: { x: 260, y: 140, width: 100, height: 60 }, shape: 'rectangle', fill: '#0077ff', stroke: null, strokeWidth: 0, text: 'Выход', textColor: '#ffffff', fontSize: 14, font: 'Arial' }], edges: [{ id: 'ab', from: { nodeId: 'a', u: 1, v: .5 }, to: { nodeId: 'b', u: 0, v: .5 }, points: [{ x: 120, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 170 }, { x: 260, y: 170 }], arrow: 'end', color: '#0077ff', width: 1 }], patches: [], uncertain: [] }, '', ['Arial'])
  const result: ReconstructionResult = { id: 'source-graph', name: 'Исходный процесс', description: '', reason: '', status: 'ready', diagram, candidate: { id: 'source-graph', name: 'Process', sourceIds: [], componentIds: [], slides: [1] } }
  result.partsQualification = { version: GRAPHIC_COMPONENTS_VERSION, checks: graphicParts(result).map(p => ({ id: p.id, passed: true, changed: true, issues: [] })) }
  const availableResults = [result]
  const posts: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/uploads/*/reconstruction', route => { if (route.request().method() !== 'GET') posts.push(route.request().url()); return route.fulfill({ json: { version: 'graphic-reconstruction-1', revision: 'fixture', completed: availableResults.length, total: availableResults.length, pending: [], results: availableResults, catalog: null } }) })
  await page.route('**/api/uploads/*/backgrounds', route => route.fulfill({ json: backgrounds }))
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 480; const ctx = c.getContext('2d')!; ctx.fillStyle = '#ff00aa'; ctx.fillRect(0, 0, 240, 480); return c.toDataURL().split(',')[1] })
  await page.route('**/api/uploads/*/assets/image', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(image, 'base64') }))
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Фоны и схемы.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await nativePptx()) })
  const navigation = page.getByRole('navigation', { name: 'Раздел дизайн-системы' })
  await navigation.getByRole('link', { name: 'Фоны', exact: true }).click()
  await expect(page.getByAltText('Предпросмотр фона')).toBeVisible()
  await page.getByLabel('Формат', { exact: true }).selectOption('portrait')
  await expect(page.getByAltText('Предпросмотр фона')).toBeVisible()
  await page.getByLabel('Графика поверх фона', { exact: true }).selectOption('')
  await expect(page.getByAltText('Предпросмотр фона')).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть исходный вариант' }).click()
  await expect(page.getByLabel('Формат', { exact: true })).toHaveValue('source')
  await page.screenshot({ path: info.outputPath('background-workbench.png') })
  await navigation.getByRole('link', { name: 'Схемы', exact: true }).click()
  await expect(page.getByLabel('Исходная схема', { exact: true }).locator('[data-native-overflow="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Новая схема', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Новая схема', exact: true }).click()
  await page.getByLabel('Блок 1', { exact: true }).fill('Начало')
  await page.getByLabel('Блок 2', { exact: true }).fill('Проверка A')
  await page.getByRole('button', { name: 'Добавить блок', exact: true }).click()
  await page.getByLabel('Блок 3', { exact: true }).fill('Проверка B')
  // A background check may finish while the user is typing a new diagram.
  availableResults.push({ ...result, id: 'source-graph-2', name: 'Второй процесс', candidate: { ...result.candidate, id: 'source-graph-2', slides: [2] } })
  await page.evaluate(() => window.dispatchEvent(new Event('design-system:ready')))
  await expect(page.getByLabel('Схема из исходника', { exact: true }).locator('option')).toHaveCount(2)
  await expect(page.getByLabel('Блок 3', { exact: true })).toHaveValue('Проверка B')
  await page.getByRole('button', { name: 'Добавить связь', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить связь', exact: true }).click()
  await page.getByLabel('Конец связи 2', { exact: true }).selectOption('n3')
  await page.getByRole('button', { name: 'Построить схему', exact: true }).click()
  const preview = page.getByLabel('Новая схема', { exact: true })
  await expect(preview).toContainText('Проверка B')
  await expect(preview.locator('[data-native-overflow="true"]')).toHaveCount(0)
  await expect(page.getByText('3 блоков · 2 связей', { exact: false })).toBeVisible()
  await page.screenshot({ path: info.outputPath('diagram-workbench.png') })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать редактируемую схему' }).click()
  expect((await download).suggestedFilename()).toBe('diagram.pptx')
  // Editing invalidates the old preview; missing input never exports stale data.
  await page.getByLabel('Блок 1', { exact: true }).fill('')
  await expect(preview).toHaveCount(0)
  await page.getByRole('button', { name: 'Построить схему', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Заполните текст каждого блока')
  expect(posts).toEqual([]); expect(errors).toEqual([])
})
