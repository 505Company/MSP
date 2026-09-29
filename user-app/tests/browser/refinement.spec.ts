import type { Page, APIRequestContext } from '@playwright/test'
import { test, expect } from './workspace-fixture'
import { controlPptx } from '../fixtures/control-pptx'
import { refinementFixture } from '../fixtures/refinement'
import { compileRefinementCandidate } from '../../lib/design-system/refinement'
import type { RefinementInput, RefinementJob, RefinementState } from '../../lib/design-system/refinement-contract'

async function setup(page: Page, request: APIRequestContext, background = true, skippedFirst = false) {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const f = await refinementFixture(), commands: Array<{ action: string; request?: RefinementInput; requestId?: string; report?: { checks: Array<{ passed: boolean }> } }> = []
  let catalog = f.base
  const state: RefinementState = { configured: true, background, ready: true, catalogId: catalog.id, jobs: [], pending: null, canUndo: false, applied: [], stale: false, coverage: [] }
  const jobFor = (input: RefinementInput): RefinementJob => ({ id: input.id, mode: input.mode, input, baseId: f.base.id, originalBaseId: f.base.id, sourceRevision: f.base.sourceRevision, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), tasks: [{ slide: 1, selectedIds: [], status: 'pending' }], budget: { used: 0, limit: 2, slides: {} }, remaining: 0 })
  await page.route('**/api/uploads/*/editable-system', route => route.fulfill({ json: { revision: 'fixture', total: 1, completed: 1, jobs: [], catalog, native: [], error: null, running: false } }))
  await page.route('**/api/uploads/*/editable-system/refinements**', async route => {
    if (route.request().method() === 'GET') {
      if (new URL(route.request().url()).searchParams.has('candidate')) {
        const candidate = await compileRefinementCandidate(f.visual, f.base, state.jobs[0], f.reply, f.id)
        return route.fulfill({ json: { candidate } })
      }
      return route.fulfill({ json: state })
    }
    const body = route.request().postDataJSON(); commands.push(body)
    if (body.action === 'request') { const job = jobFor(body.request); if (skippedFirst) job.tasks = [{ slide: 1, selectedIds: [], status: 'skipped', error: 'Модель указала неверные связи композиции.' }, { slide: 2, selectedIds: [], status: 'pending' }]; state.jobs.unshift(job); if(state.pending&&body.request.mode==='region')state.queue=[...state.queue??[],job.id];else state.pending = job.id }
    if (body.action === 'cancel') { state.jobs[0].status = 'cancelled'; state.pending = null }
    if (body.action === 'retry') { state.jobs[0].status = 'queued'; state.jobs[0].tasks[0].status = 'pending' }
    if (body.action === 'undo') { catalog = f.base; state.catalogId = catalog.id; state.canUndo = false; state.applied = [] }
    if (body.action === 'advance') {
      state.jobs[0].status = 'checking'; const task = state.jobs[0].tasks.find(t => t.status === 'pending' || t.status === 'running'); if (task) task.status = 'checking'
      return route.fulfill({ status: 202, contentType: 'application/x-ndjson', body: '{"started":true}\n\n{"complete":true}\n' })
    }
    if (body.action === 'report') { state.jobs[0].status = 'queued'; state.jobs[0].tasks.find(t => t.status === 'checking')!.status = 'complete' }
    if (body.action === 'complete') finish()
    return route.fulfill({ status: 202, json: { job: state.jobs[0], background: state.background, complete: true } })
  })
  const finish = () => {
    state.jobs[0].status = 'complete'; state.jobs[0].tasks.forEach(t => { if (t.status !== 'skipped') t.status = 'complete' }); state.jobs[0].result = { added: 1, updated: 0, rejected: 0, duplicates: 0, skipped: state.jobs[0].tasks.filter(t => t.status === 'skipped').length, version: 'd'.repeat(64) }
    catalog = { ...catalog, id: 'd'.repeat(64) }; state.catalogId = catalog.id; state.pending = null; state.canUndo = true; state.applied.push(state.jobs[0].id)
  }
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Дополнение — проверка.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.ed-card').first()).toBeVisible({ timeout: 60000 })
  return { f, state, commands, finish, url: page.url(), seed(mode: 'region' | 'scan' = 'region') {
    const job = jobFor({ id: crypto.randomUUID(), mode, catalogId: f.base.id, note: '', ...(mode === 'region' ? { slide: 1, region: { x: 0, y: 0, width: 1, height: 1 } } : {}) })
    if (skippedFirst) job.tasks = [{ slide: 1, selectedIds: [], status: 'skipped', error: 'Модель указала неверные связи композиции.' }, { slide: 2, selectedIds: [], status: 'pending' }]
    state.jobs.unshift(job); state.pending = job.id; return job
  } }
}

test('the retired refinement panel is absent from every section; browsing starts no requests', async ({ page, request }) => {
  const f = await setup(page, request)
  for (const section of ['components', 'composition', 'source', 'assets']) {
    await page.goto(f.url.replace(/\?.*$/, '') + `?section=${section}`)
    await expect(page.locator('.ds-explorer')).toHaveAttribute('data-section', section)
    await expect(page.locator('.rf-toolbar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Дополнить дизайн-систему', exact: true })).toHaveCount(0)
    await expect(page.getByText('Не хватает компонента?', { exact: true })).toHaveCount(0)
  }
  expect(f.commands).toHaveLength(0)
})




test('source region sends normalized geometry, supports keyboard selection and stays usable on mobile', async ({ page, request }, info) => {
  const f = await setup(page, request)
  await page.goto(f.url.replace(/\?.*$/, '') + '?section=source')
  const trigger = page.getByRole('button', { name: 'Добавить область', exact: true }).first()
  await trigger.click()
  const selection = page.getByRole('group', { name: 'Область на исходном слайде' })
  await page.getByRole('dialog').evaluate(e => Promise.all(e.getAnimations({ subtree: true }).map(a => a.finished)))
  await expect(page.getByRole('button', { name: 'Проверить и добавить' })).toBeDisabled()
  const rect = (await selection.boundingBox())!
  await page.mouse.move(rect.x + rect.width * .1, rect.y + rect.height * .2)
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height * .8); await page.mouse.up()
  await page.getByLabel('Что добавить, необязательно').fill('Сохранить подпись под числом')
  await page.screenshot({ path: info.outputPath('source-selection.png') })
  await page.getByRole('button', { name: 'Проверить и добавить' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(trigger).toBeFocused()
  const input = f.commands[0].request!
  expect(input.mode).toBe('region'); expect(input.slide).toBe(1)
  expect(input.region!.x).toBeCloseTo(.1, 2); expect(input.region!.y).toBeCloseTo(.2, 2); expect(input.region!.width).toBeCloseTo(.5, 2); expect(input.region!.height).toBeCloseTo(.6, 2)
  await page.getByRole('button', { name: 'Остановить', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 }); await trigger.click()
  await selection.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown')
  await expect(page.getByRole('button', { name: 'Проверить и добавить' })).toBeEnabled()
  await page.getByRole('dialog').evaluate(e => Promise.all(e.getAnimations({ subtree: true }).map(a => a.finished)))
  expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('source-selection-mobile.png') })
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  expect(f.commands.filter(c => c.action === 'request')).toHaveLength(1)
})

test('browser fallback still qualifies pending work after the toolbar is removed', async ({ page, request }) => {
  const f = await setup(page, request, false)
  f.seed('scan'); await page.evaluate(() => window.dispatchEvent(new Event('msp:refinement')))
  await expect.poll(() => f.commands.map(c => c.action), { timeout: 60000 }).toEqual(['advance','report','complete'])
  const report = f.commands.find(c => c.action === 'report')!.report!
  expect(report.checks.length).toBeGreaterThan(0); expect(report.checks.every(c => c.passed)).toBe(true)
  expect(f.state.jobs[0].status).toBe('complete')
})


test('a paused region remains recoverable beside its source after reload', async ({ page, request }) => {
  const f = await setup(page, request), job = f.seed()
  job.status = 'failed'; job.tasks[0].status = 'failed'; job.tasks[0].error = 'Соединение прервалось'
  await page.goto(f.url.replace(/\?.*$/, '') + '?section=source')
  await expect(page.locator('.rf-source-progress')).toContainText('Соединение прервалось')
  await page.reload(); await expect(page.locator('.rf-source-progress')).toContainText('Проверка приостановлена')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.locator('.rf-source-progress')).not.toContainText('Проверка приостановлена')
  await page.getByRole('button', { name: 'Остановить', exact: true }).click()
  await expect(page.locator('.rf-source-progress')).toContainText('Проверка остановлена')
  expect(f.commands.map(c => c.action)).toEqual(['retry','cancel'])
})


test('one rejected slide still allows later qualified work to finish', async ({ page, request }) => {
  const f = await setup(page, request, false, true)
  f.seed('scan'); await page.evaluate(() => window.dispatchEvent(new Event('msp:refinement')))
  await expect.poll(() => f.state.jobs[0].status, { timeout: 60000 }).toBe('complete')
  expect(f.state.jobs[0].tasks[0].status).toBe('skipped')
  expect(f.state.jobs[0].result!.skipped).toBe(1)
  expect(f.commands.map(c => c.action)).toEqual(['advance','report','complete'])
})


test('a selected-region result links straight to its component editor', async ({ page, request }, info) => {
  const f = await setup(page, request)
  f.seed(); f.finish(); const template = f.f.base.families[0].variants[0]
  f.state.jobs[0].result!.items = [{ id: template.id, name: 'Добавленный показатель', kind: template.kind, slide: 1 }]
  await page.goto(f.url.replace(/\?.*$/, '') + '?section=source')
  const receipt = page.locator('.rf-source-progress .rf-receipt')
  await receipt.getByText('Что добавлено · 1').click()
  await receipt.getByRole('link', { name: 'Добавленный показатель' }).click()
  await expect(page).toHaveURL(new RegExp(`/components/${template.id}$`))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('refinement-editor-link.png'), animations: 'disabled' })
})


test('source selection offers a graphic destination without a model connection and sends it with the region',async({page,request})=>{
  const f=await setup(page,request)
  f.state.configured=false
  await page.goto(f.url.replace(/\?.*$/,'')+'?section=source')
  await page.getByRole('button',{name:'Добавить область',exact:true}).first().click()
  await page.getByLabel('Что сохранить',{exact:true}).selectOption('graphic')
  await expect(page.getByRole('dialog')).toContainText('Графике и иконках')
  await page.getByRole('group',{name:'Область на исходном слайде'}).focus();await page.keyboard.press('Enter')
  await page.getByRole('button',{name:'Проверить и добавить',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(f.commands[0].request?.target).toBe('graphic')
})

test('several marked regions are admitted with distinct identities while an earlier region is pending',async({page,request},info)=>{
 const f=await setup(page,request)
 await page.goto(f.url.replace(/\?.*$/,'')+'?section=source')
 await page.getByRole('button',{name:'Добавить область',exact:true}).first().click()
 const selection=page.getByRole('group',{name:'Область на исходном слайде'})
 await selection.focus();await page.keyboard.press('Enter');await page.getByLabel('Что добавить, необязательно').fill('Первый блок')
 await page.getByRole('button',{name:'Ещё область',exact:true}).click()
 await selection.focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight')
 await page.getByLabel('Что добавить, необязательно').fill('Второй блок')
 await expect(page.locator('.rf-selection-saved')).toHaveCount(1)
 await page.screenshot({path:info.outputPath('multiple-regions.png')})
 await page.getByRole('button',{name:'Проверить и добавить · 2',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 const requests=f.commands.filter(c=>c.action==='request').map(c=>c.request!)
 expect(requests).toHaveLength(2);expect(requests[0].id).not.toBe(requests[1].id)
 expect(requests.map(r=>r.note)).toEqual(['Первый блок','Второй блок'])
 expect(f.state.pending).toBe(requests[0].id);expect(f.state.queue).toEqual([requests[1].id])
 await expect(page.getByText('В очереди: 1. Области проверяются последовательно.')).toBeVisible()
})
