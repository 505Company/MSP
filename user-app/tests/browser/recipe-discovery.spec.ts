import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { discoveryFixture, discoveryConfig } from '../fixtures/recipe-discovery'
import { enqueueDiscoveryJob, claimDiscoveryJob, readDiscoveryJobs, publicDiscoveryJob, updateDiscoveryJob, commandDiscoveryJob } from '../../lib/presentations/recipes/discovery-jobs'
import { advanceDiscovery, readDiscoveryEvidence } from '../../lib/presentations/recipes/discovery-workflow'
import { readRecipeRegistry } from '../../lib/presentations/recipes/library'
import { controlPptx } from '../fixtures/control-pptx'
import { QwenAnalysisError } from '../../lib/uploads/qwen-analysis'
import { compileTemplateRecipe } from '../../lib/presentations/recipes/template-contract'

for (const profile of ['repeated-text', 'paired-percent'] as const) test(`one background entry point qualifies ${profile} with model semantics and real native images`, async ({ page }, info) => {
  const f = await discoveryFixture(profile), originalFetch = globalThis.fetch
  await enqueueDiscoveryJob(f.bucket, f.uploadId, { id: crypto.randomUUID(), limit: 24 })
  const job = (await claimDiscoveryJob(f.bucket, 'browser-worker'))!
  globalThis.fetch = f.fetchModel as typeof fetch
  let reports = 0
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.route(`**/api/uploads/${f.uploadId}/recipe-jobs`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { jobs: (await readDiscoveryJobs(f.bucket, f.uploadId)).map(publicDiscoveryJob) } })
    const body = route.request().postDataJSON()
    try {
      const next = await advanceDiscovery(f.bucket, f.uploadId, body.jobId, body.token, discoveryConfig, body.report)
      if (body.report) reports++
      await next.execute?.()
      await route.fulfill({ json: next.value })
    } catch (error) {
      await route.fulfill({ status: 409, json: { error: error instanceof Error ? error.message : String(error), code: error instanceof QwenAnalysisError ? error.code : 'TEST_FAILURE' } })
    }
  })
  const heartbeat = setInterval(() => { void updateDiscoveryJob(f.bucket, f.uploadId, job.leaseToken!, {}).catch(() => {}) }, 5000)
  try {
    await page.goto('/processing-worker')
    await page.waitForFunction(() => !!window.__mspRunRecipes)
    const result = await page.evaluate(({ uploadId, id, token }) => window.__mspRunRecipes!(uploadId, id, token), { uploadId: f.uploadId, id: job.id, token: job.leaseToken! })
    expect(result, JSON.stringify(result)).toEqual({ ok: true })
    await updateDiscoveryJob(f.bucket, f.uploadId, job.leaseToken!, { complete: true })
    const saved = (await readDiscoveryJobs(f.bucket, f.uploadId))[0], evidence = await readDiscoveryEvidence(f.bucket, saved)
    if (profile === 'repeated-text') expect(evidence.refinements.map(r => r.kind)).toContain('reflow')
    else expect(evidence.recipe?.comparison?.encoding).toBe('equal-badges')
    expect(saved.result?.technical, JSON.stringify(evidence.checks.map(c => ({ id: c.id, issues: c.report?.issues })))).toBe('passed')
    expect(evidence.checks).toHaveLength(4); expect(reports).toBe(profile === 'repeated-text' ? 7 : 4)
    expect(evidence.checks.every(c => c.report?.measurements.every(m => m.pixels > 2))).toBe(true)
    expect((await readRecipeRegistry(f.bucket, f.uploadId)).entries[0].enabled).toBe(false)
    for (const check of evidence.checks) await writeFile(info.outputPath(`${check.id}.png`), Buffer.from(check.report!.preview.split(',')[1], 'base64'))
    await writeFile(info.outputPath('result.json'), JSON.stringify({ job: publicDiscoveryJob(saved), states: evidence.checks.map(c => c.report!.stateId), requests: f.calls() }, null, 2))
  } finally { clearInterval(heartbeat); globalThis.fetch = originalFetch }
})

test('composition UI starts only on command, preserves the cap across reload and supports resume/cancel on desktop/mobile', async ({ page, request }, info) => {
  const f = await discoveryFixture(), commands: string[] = []
  let completedEvidence: unknown = null
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.route('**/api/uploads/*/recipe-jobs**', async route => {
    if (route.request().method() === 'GET') {
      const jobs = (await readDiscoveryJobs(f.bucket, f.uploadId)).map(publicDiscoveryJob)
      if (completedEvidence) Object.assign(jobs[0], { status: 'complete', result: { technical: 'passed', reason: 'Synthetic completed UI state' } })
      return route.fulfill({ json: { jobs, configured: true, background: true, ...(completedEvidence ? { evidence: completedEvidence } : {}) } })
    }
    const body = route.request().postDataJSON(); commands.push(body.action)
    const job = body.action === 'start' ? await enqueueDiscoveryJob(f.bucket, f.uploadId, body.request) : await commandDiscoveryJob(f.bucket, f.uploadId, body.jobId, body.action)
    await route.fulfill({ json: { job: publicDiscoveryJob(job) } })
  })
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Рецепты проверка.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.ds-explorer')).toBeVisible({ timeout: 60000 })
  await page.goto(page.url().replace(/\?.*$/, '') + '?section=composition')
  const panel = page.getByRole('region', { name: 'Рецепты слайдов' })
  await expect(panel.getByRole('button', { name: 'Пополнить рецепты' })).toBeEnabled()
  expect(commands).toEqual([])
  await panel.getByRole('button', { name: 'Пополнить рецепты' }).click()
  await expect(panel).toContainText('Запросы: 0 / 24')
  await page.reload(); await expect(panel.getByRole('button', { name: 'Пополнить рецепты' })).toBeDisabled()
  expect(commands).toEqual(['start'])
  const running = (await claimDiscoveryJob(f.bucket, 'test-worker'))!
  await updateDiscoveryJob(f.bucket, f.uploadId, running.leaseToken!, { error: 'Сохранённый этап доступен для продолжения.', retryable: false })
  await expect(panel.getByRole('button', { name: 'Продолжить' })).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: info.outputPath('recipe-job-desktop.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: 'Продолжить' }).click()
  await expect(panel).toContainText('В очереди')
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.scrollIntoViewIfNeeded()
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('recipe-job-mobile.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: 'Остановить' }).click()
  await expect(panel.getByRole('button', { name: 'Пополнить рецепты' })).toBeEnabled()
  expect(commands).toEqual(['start', 'resume', 'cancel'])
  const recipe = await compileTemplateRecipe(f.source.proposal, f.source.snapshot, f.uploadId, 'synthetic-ui')
  const rendered = await page.evaluate(async ({ recipe, material, plan }) => {
    const path = '/browser/template-recipe-execution.ts'
    return (await import(path) as typeof import('../../browser/template-recipe-execution')).renderTemplateRecipe(recipe, material, plan)
  }, { recipe, material: f.source.material, plan: f.source.plan })
  completedEvidence = { recipe, selected: { reason: 'Synthetic completed UI state' }, extractions: [],
    checks: ['reconstruction', 'short', 'medium', 'long'].map(id => ({ id, recipe, report: rendered, review: { result: { verdict: 'pass', issues: [] } } })) }
  await page.reload()
  await panel.locator('.rd-evidence > summary').click()
  await expect(panel.locator('.rd-preview')).toHaveCount(4)
  const openPreview = panel.getByRole('button', { name: 'Открыть: Мало текста' })
  await openPreview.click(); await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => page.getByRole('dialog').locator('img').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true)
  expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('recipe-preview-mobile.png'), animations: 'disabled' })
  await page.keyboard.press('Escape'); await expect(openPreview).toBeFocused()
  await page.setViewportSize({ width: 1440, height: 1000 }); await openPreview.click()
  await page.screenshot({ path: info.outputPath('recipe-preview-desktop.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  expect(commands).toEqual(['start', 'resume', 'cancel'])
})
