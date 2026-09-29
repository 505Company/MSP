import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import {extractEmbeddedFonts} from '../../lib/uploads/embedded-fonts'
import { studioFixture } from '../fixtures/studio'
import { normalizeText } from '../../lib/presentations/studio/material'
import { candidatesFor } from '../../lib/presentations/studio/recipes'
import { generationPreview, generationSummary, isVisibleGeneration } from '../../lib/presentations/studio/generations'
import {memoryBucket} from '../helpers/memory-bucket'
import {setStudioSlidesDeleted} from '../../lib/presentations/studio/lifecycle'
import {studioKey,readStudioRun} from '../../lib/presentations/studio/storage'
import type { StudioRun } from '../../lib/presentations/studio/contract'
import type { EditableTemplate } from '../../lib/design-system/editable-contract'
import type { PresentationProject } from '../../lib/workspace/types'

test('mode tabs preserve history and cross-mode selection for export and deletion', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
  await page.route('**/api/fonts/google?*', r => r.fulfill({ status: 404, json: { files: [] } }))
  await page.goto('/processing-worker')
  const run = studioFixture('fast', '# Экспорт без потерь\n\nТекст остаётся редактируемым.')
  const table: EditableTemplate = { id: 'table', kind: 'table', name: 'Таблица', description: '', tags: [], slide: 1, sourceIds: [], memberIds: [], width: 1000, height: 500, data: { columns: ['Регион', 'Рост'], rows: [['Карелия', '37%'], ['Алтай', '48%']] }, style: { font: 'Play', fontSize: 24, color: '#162D40', headerFill: '#00805E', headerColor: '#FFFFFF' }, config: {}, graphicHtml: {}, dataStatus: 'native' }
  const chart: EditableTemplate = { ...table, id: 'chart', name: 'Динамика', kind: 'chart', config: { chartType: 'line', legend: true, grid: true }, data: { categories: ['Алтай', 'Карелия'], series: [{ name: 'Рост', values: [48, 37] }] } }
  for (const [i, template] of [table, chart].entries()) {
    const content = normalizeText(`# ${i ? 'Динамика регионов' : 'Данные регионов'}`)[0]; content.id = `slide-${i + 2}`
    content.blocks.push({ id: 'b2', role: 'body', kind: 'visual', fields: {}, source: JSON.stringify(template.data), data: { template, values: template.data } })
    run.slides.push({ content, candidates: candidatesFor(content), bindings: {} })
  }
  const rendered = await page.evaluate(async run => {
    const path = '/browser/studio-generation.ts', { renderStudioOptions } = await import(path) as typeof import('../../browser/studio-generation')
    for (const [index,work] of run.slides.entries()) { work.chrome={title:'География путешествий',number:index+1}; work.options = await renderStudioOptions(run.library, work, undefined, { limit: 1 }); work.plan = work.options[0].plan; run.results[work.content.id] = work.options[0].receipt! }
    run.status = 'complete'; return run
  }, run)
  expect(Object.values(rendered.results).every(r => r.passed)).toBe(true)
  const balanced: StudioRun = { ...rendered, revision: crypto.randomUUID(), mode: 'smart', createdAt: '2026-09-29T10:00:00Z' }
  const creative: StudioRun = { ...rendered, revision: crypto.randomUUID(), mode: 'smart', semantic: { source: '', status: 'complete', strategy: 'components' }, createdAt: '2026-09-29T11:00:00Z' }
  const runs = new Map([rendered, balanced, creative].map(r => [r.revision, r]))
  let project: PresentationProject = { schemaVersion: 1, id: run.projectId, revision: creative.revision, name: 'Сборная презентация', text: 'Исходное содержание', uploadId: run.library.uploadId, styleName: run.library.name, createdAt: run.createdAt, updatedAt: run.createdAt, generationMode: 'smart', compositionMode: 'components' }
  const {bucket}=memoryBucket()
  await bucket.put(`workspace/projects/${project.id}.json`,JSON.stringify(project))
  for(const r of runs.values())await bucket.put(studioKey(project.id,r.revision),JSON.stringify(r))
  let posts = 0, fullReads = 0
  const previews:string[]=[]
  await page.route('**/api/projects/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if(request.method()==='PATCH'){const body=request.postDataJSON(),changes=await setStudioSlidesDeleted(bucket,project.id,body.slides,body.action==='delete');for(const c of changes)runs.set(c.revision,(await readStudioRun(bucket,project.id,c.revision))!);return route.fulfill({json:{changes}})}
    if (request.method() === 'POST') { posts++; return route.abort() }
    if (url.pathname.endsWith('/generations')) return route.fulfill({ json: { generations: [...runs.values()].map(generationSummary).filter(isVisibleGeneration) } })
    if (url.pathname.endsWith('/compose')) {
      const run = runs.get(url.searchParams.get('revision')!)
      if (url.searchParams.get('preview') !== '1') fullReads++
      else previews.push(url.searchParams.get('revision')!)
      return route.fulfill({ json: { run: run ? url.searchParams.get('preview') === '1' ? generationPreview(run) : run : null, configured: false } })
    }
    if (request.method() === 'PUT') project = { ...project, ...request.postDataJSON(), revision: crypto.randomUUID() }
    return route.fulfill({ json: { project } })
  })
  await page.route('**/api/style-bank', r => r.fulfill({ json: { styles: [{ id: run.library.uploadId, name: run.library.name, fileName: 'test.pptx', sourceId: 'test', createdAt: run.createdAt, slideCount: 3, componentCount: 20, styleCount: 4, previewId: null, colors: ['#00805E'], fonts: ['Play'] }] } }))
  await page.goto(`/projects/${project.id}`)
  const groups = page.locator('.msp-generation-group')
  await expect(groups).toHaveCount(3); await expect(page.locator('.ws-slide-canvas img')).toHaveCount(3)
  expect(previews).toEqual([creative.revision])
  const fastTab = page.getByRole('tab', { name: 'Быстрый', exact: true }), balancedTab = page.getByRole('tab', { name: 'Сбалансированный', exact: true }), creativeTab = page.getByRole('tab', { name: 'Творческий', exact: true })
  await expect(creativeTab).toHaveAttribute('aria-selected', 'true')
  await expect(groups.nth(0)).toBeHidden(); await expect(groups.nth(1)).toBeHidden()
  await expect(groups.nth(2).getByRole('heading', { name: 'Творческий режим' })).toBeVisible()
  await fastTab.click()
  await expect(groups.nth(0).getByRole('heading', { name: 'Быстрый режим' })).toBeVisible()
  await expect(groups.nth(0).locator('.ws-slide-canvas img')).toHaveCount(3)
  await fastTab.press('ArrowRight')
  await expect(balancedTab).toBeFocused(); await expect(balancedTab).toHaveAttribute('aria-selected', 'true')
  await expect(groups.nth(1).getByRole('heading', { name: 'Сбалансированный режим' })).toBeVisible()
  await expect(groups.nth(1).locator('.ws-slide-canvas img')).toHaveCount(3)
  await balancedTab.press('End'); await expect(creativeTab).toBeFocused()
  await expect(groups.nth(2).getByRole('heading', { name: 'Творческий режим' })).toBeVisible()
  await page.getByRole('button', { name: 'Содержание и параметры' }).click()
  await expect(page.locator('.msp-project-controls').getByRole('button', { name: 'Сгенерировать слайды' })).toHaveCount(0)
  await expect(page.locator('#project-inputs').getByRole('button', { name: 'Сгенерировать слайды' })).toBeVisible()
  await expect(page.getByText('Только экспериментальные рецепты')).toHaveCount(0)
  await expect(page.getByText(/Распознано слайдов|Подключение модели автоматически/)).toHaveCount(0)
  await page.locator('#presentation-content').fill('Изменённый текст следующего запуска')
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(9)
  await page.reload(); await expect(page.locator('.ws-slide-canvas img')).toHaveCount(3)
  await fastTab.click()
  await expect(groups.nth(0).locator('.ws-slide-canvas img')).toHaveCount(3)
  expect(fullReads).toBe(0)
  await expect(page.getByText(/Исходники презентации|Варианты оформления|Показана сохранённая версия|Выбрать для экспорта/)).toHaveCount(0)
  const corner = await groups.first().getByRole('checkbox', { name: /Выбрать слайд 1:/ }).boundingBox(), card = await groups.first().locator('.ws-slide-card').first().boundingBox()
  expect(corner!.width).toBeGreaterThanOrEqual(32)
  expect(corner!.x).toBeGreaterThan(card!.x + card!.width - 80)
  expect(corner!.y).toBeLessThan(card!.y + 65)
  await expect(page.getByRole('button', { name: 'Экспортировать', exact: true })).toBeDisabled()
  // Choose in a different click order. Export must follow the displayed order.
  await creativeTab.click()
  await groups.nth(2).getByRole('checkbox', { name: /Выбрать слайд 1:/ }).check()
  await fastTab.click()
  await groups.nth(0).getByRole('checkbox', { name: /Выбрать слайд 2:/ }).check()
  await balancedTab.click()
  await groups.nth(1).getByRole('checkbox', { name: /Выбрать слайд 3:/ }).check()
  await expect(page.getByText('Выбрано слайдов: 3', { exact: true })).toBeVisible()
  await creativeTab.click(); await expect(groups.nth(2).getByRole('checkbox', { name: /Выбрать слайд 1:/ })).toBeChecked()
  await page.screenshot({ path: info.outputPath('history-desktop.png'), fullPage: true })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспортировать', exact: true }).click()
  const download = await downloaded; expect(download.suggestedFilename()).toBe('Сборная презентация.zip')
  expect(fullReads).toBe(3)
  await download.saveAs(info.outputPath('selection.zip'))
  const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(info.outputPath('selection.zip')))
  const pdf = await zip.file('Сборная презентация.pdf')!.async('uint8array'), pptx = await zip.file('Сборная презентация.pptx')!.async('uint8array')
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3)
  const deck = await JSZip.loadAsync(pptx), xml = await deck.file('ppt/presentation.xml')!.async('string')
  expect(xml.match(/<p:sldId /g)).toHaveLength(3)
  expect(xml).toContain('embedTrueTypeFonts="1"')
  const fonts=extractEmbeddedFonts(pptx)
  expect(fonts.map(f=>f.style).sort()).toEqual(['Bold','Regular'])
  expect(fonts[0].family).toMatch(/^MSP Play [a-f0-9]{8}$/)
  expect(fonts[0].family).toBe(fonts[1].family)
  const masterIds=[...xml.matchAll(/<p:sldMasterId id="(\d+)"/g)].map(m=>m[1])
  const layoutIds=(await Promise.all(Object.values(deck.files).filter(f=>/slideMasters\/[^/]+\.xml$/.test(f.name)).map(f=>f.async('string')))).flatMap(x=>[...x.matchAll(/<p:sldLayoutId id="(\d+)"/g)].map(m=>m[1]))
  expect(new Set([...masterIds,...layoutIds]).size).toBe(masterIds.length+layoutIds.length)
  expect(await deck.file('ppt/decks/s1/slides/slide1.xml')!.async('string')).toContain('<a:tbl>')
  expect(await deck.file('ppt/decks/s1/slides/slide1.xml')!.async('string')).toContain('37%')
  expect(await deck.file('ppt/decks/s1/slides/slide1.xml')!.async('string')).toContain('География путешествий')
  expect(await deck.file('ppt/decks/s1/slides/slide1.xml')!.async('string')).toMatch(/<a:t[^>]*>02<\/a:t>/)
  expect(await deck.file('ppt/decks/s2/objects/o1/charts/chart1.xml')!.async('string')).toContain('<c:v>48</c:v>')
  expect(deck.file('ppt/decks/s2/objects/o1/embeddings/data.xlsx')).not.toBeNull()
  expect(await deck.file('ppt/decks/s3/slides/slide1.xml')!.async('string')).toContain('Текст остаётся редактируемым.')
  await writeFile(info.outputPath('selection.pdf'), pdf); await writeFile(info.outputPath('selection.pptx'), pptx)
  // The same selection deletes only these saved slides, across generations.
  await expect(page.getByRole('button',{name:'Удалить слайды',exact:true})).toBeEnabled()
  await expect(page.getByText('Слайды из разных генераций · в порядке списка')).toHaveCount(0)
  await expect(page.getByText('Формат',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Удалить слайды',exact:true}).click()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(6)
  await expect(page.getByText('Выбрано слайдов: 0',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Отменить удаление (3)',exact:true}).click()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(9)
  await balancedTab.click()
  await groups.nth(1).getByRole('checkbox',{name:/Выбрать слайд 1:/}).check()
  await page.getByRole('button',{name:'Удалить слайды',exact:true}).click()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(8)
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible()
  await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Удалить слайды',exact:true})).toBeDisabled()
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true) }
  const stopped=structuredClone(runs.get(creative.revision)!);stopped.status='cancelled';delete stopped.results['slide-3'];runs.set(creative.revision,stopped)
  await bucket.put(studioKey(project.id,stopped.revision),JSON.stringify(stopped))
  await page.reload();await creativeTab.click();await expect(page.getByText('Генерация остановлена. Готовые слайды сохранены.')).toBeVisible()
  await expect(groups.nth(2).locator('.ws-slide-canvas img')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Продолжить создание'})).toHaveCount(0)
  // Deleting the last slide removes the whole generation, including its header
  // and tab count. Undo remains reachable even if the entire gallery is empty.
  await page.setViewportSize({ width: 1440, height: 1100 })
  for (const tab of [fastTab, balancedTab, creativeTab]) {
    await tab.click()
    await page.getByRole('button', { name: 'Выбрать все слайды', exact: true }).click()
  }
  await expect(page.getByText('Выбрано слайдов: 7', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить слайды', exact: true }).click()
  await expect(groups).toHaveCount(0)
  for (const tab of [fastTab, balancedTab, creativeTab]) await expect(tab.locator('span')).toHaveText('0')
  await expect(page.getByText('В этом режиме пока нет генераций.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить удаление (7)', exact: true }).click()
  await expect(groups).toHaveCount(3)
  await expect(groups.nth(2).locator('.ws-slide-canvas img')).toHaveCount(2)
  for (const tab of [fastTab, balancedTab, creativeTab]) {
    await tab.click()
    await page.getByRole('button', { name: 'Выбрать все слайды', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Удалить слайды', exact: true }).click()
  await expect(groups).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('В этом режиме пока нет генераций.', { exact: true })).toBeVisible()
  await expect(groups).toHaveCount(0)
  await expect(page.locator('.msp-export-bar')).toHaveCount(0)
  expect(project.text).toBe('Изменённый текст следующего запуска')
  expect(posts).toBe(0); expect(errors).toEqual([])
})
