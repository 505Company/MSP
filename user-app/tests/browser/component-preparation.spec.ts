import { test, expect } from './workspace-fixture'
import { labCatalog, labUnitMetric } from '../../component-lab/fixtures'
import { memoryBucket } from '../helpers/memory-bucket'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../../lib/design-system/editable-contract'
import { claimPreparation, enqueuePreparation, finishPreparation, ownedPreparation, readPreparationJobs, readPreparedComponent, updatePreparation } from '../../lib/component-lab/preparation-jobs'
import { readRuleHistory, saveRuleRevision } from '../../lib/component-lab/storage'
import { projectPreparedBoxes, pinPreparedContext } from '../../lib/presentations/prepared-component-storage'
import { layoutInput, layoutPlan } from '../fixtures/layout'
import { PREPARED_BOX_VERSION } from '../../lib/presentations/prepared-components'
import { validateAdaptivePlan, validateAdaptiveFit, type AdaptivePlan } from '../../lib/presentations/adaptive-layout'

test('the separate worker persists measured metric units, rejects forged proofs and fences old rules without rewriting the source', async ({ page, context }, info) => {
  const { bucket } = memoryBucket(), upload = crypto.randomUUID(), catalog = labCatalog()
  catalog.version = EDITABLE_VERSION; catalog.compilerVersion = EDITABLE_COMPILER_VERSION
  catalog.families = [{ ...catalog.families[0], variants: [labUnitMetric()] }]
  const sourceKey = `editable-systems/${upload}/fixture.json`, original = JSON.stringify(catalog)
  await bucket.put(sourceKey, original)
  await bucket.put(`editable-systems/${upload}/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: sourceKey }))
  await enqueuePreparation(bucket, upload)
  const job = (await claimPreparation(bucket, 'test-worker'))!
  let report: Parameters<typeof finishPreparation>[4]
  await context.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await context.route('**/api/uploads/*/editable-system', route => route.fulfill({ json: { catalog, native: [], jobs: [], total: 1, completed: 1, running: false } }))
  await context.route('**/api/uploads/*/component-preparation', async route => {
    try {
      if (route.request().method() === 'GET') return route.fulfill({ json: { jobs: await readPreparationJobs(bucket, upload), background: true } })
      const body = route.request().postDataJSON()
      if (body.action === 'ensure') return route.fulfill({ json: { jobs: await enqueuePreparation(bucket, upload) } })
      const owned = await ownedPreparation(bucket, upload, body.jobId, body.token)
      if (!body.report) return route.fulfill({ json: { input: owned.input } })
      report = body.report
      await finishPreparation(bucket, upload, body.jobId, body.token, report)
      return route.fulfill({ json: { done: true } })
    } catch (error) { return route.fulfill({ status: 409, json: { error: String(error) } }) }
  })
  await context.route('**/api/uploads/*/component-profiles?*', async route => route.fulfill({ json: await readRuleHistory(bucket, upload, job.input!.profile) }))
  await page.goto(`/styles/${upload}/components/lab-metric`)
  await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.locator('#preview [data-metric-part=unit]')).toHaveText('%')
  await page.locator('#state').selectOption('horizontal')
  await expect(page.locator('#status')).toHaveText('Помещается')
  await page.screenshot({ path: info.outputPath('metric-with-unit.png') })
  // The user's editor may go away before the processing page even starts.
  await page.close()
  const worker = await context.newPage()
  await worker.goto('/processing-worker')
  await worker.waitForFunction(() => !!window.__mspRunComponents)
  const result = await worker.evaluate(({ upload, job }) => window.__mspRunComponents!(upload, job.id, job.leaseToken!), { upload, job })
  expect(result).toEqual({ ok: true })
  const prepared = (await readPreparationJobs(bucket, upload))[0]
  expect(prepared.status).toBe('running'); expect(prepared.result?.technical).toBe('passed'); expect(prepared.result?.sourceFits).toBe(true)
  // A server validates both the synthetic matrix and the actual imported text.
  const altered = structuredClone(report) as { proof: { cases: { chosen?: { fields: { parts?: { fontSize: number }[] }[] } }[] }; source: { chosen: { fields: { text: string }[] } } }
  const unit = altered.proof.cases.find(c => c.chosen?.fields[0].parts)?.chosen!.fields[0].parts![1]
  expect(unit).toBeDefined(); unit!.fontSize++
  await expect(finishPreparation(bucket, upload, job.id, job.leaseToken!, altered)).rejects.toThrow(/Измерения/)
  const lost = structuredClone(report) as typeof altered; lost.source.chosen.fields[0].text = '73'
  await expect(finishPreparation(bucket, upload, job.id, job.leaseToken!, lost)).rejects.toThrow(/исходного текста/)
  await updatePreparation(bucket, upload, job.leaseToken!, { complete: true })
  expect(await readPreparedComponent(bucket, upload, job.componentId)).toMatchObject({ source: { passed: true }, technical: 'passed', sourceFidelity: 'preserved', generationAdmission: true })
  expect(await (await bucket.get(sourceKey))!.text()).toBe(original)
  expect((await readRuleHistory(bucket, upload, job.input!.profile)).head).toBeNull()
  const project = { id: crypto.randomUUID(), revision: 1, uploadId: upload }, pins = await projectPreparedBoxes(bucket, project)
  const generationInput = { ...layoutInput(), uploadId: upload, components: catalog.families[0].variants, preparedComponents: pins, content: [{ id: 'heading', text: 'Проверяем новый материал' }, { id: 'value', text: '3,7 млн' }, { id: 'caption', text: 'Новых обращений обработано за год' }] }
  expect((await bucket.list({ prefix: `presentation-component-profiles/${project.id}/` })).objects).toHaveLength(0)
  await pinPreparedContext(bucket, { projectId: project.id, sourceRevision: String(project.revision), uploadId: upload, inputs: [generationInput] })
  const plan: AdaptivePlan = { version: PREPARED_BOX_VERSION, title: ['heading'], footer: [], fontToken: 'font-1', colors: { ...layoutPlan().colors, onAccent: 'white' }, rationale: 'Independent integration fixture', blocks: [{ emphasis: 'plain', parts: [{ role: 'body', fragments: ['value', 'caption'], component: { id: job.componentId, fields: [{ path: 'slots.0', fragments: ['value'] }, { path: 'slots.1', fragments: ['caption'] }] } }] }] }
  validateAdaptivePlan(plan, generationInput, { fontTokens: ['font-1'] })
  const generated = await worker.evaluate(async ({ input, plan }) => {
    const fontsPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const fonts = await (await import(fontsPath) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(input)
    return (await import(renderPath) as typeof import('../../browser/adaptive-layout')).fitAdaptiveLayout(input, plan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
  }, { input: generationInput, plan })
  expect(generated.fit.passed, JSON.stringify(generated.fit.trials.at(-1)?.issues)).toBe(true)
  validateAdaptiveFit(generated.fit, plan, generationInput, 'a'.repeat(64), generated.preview)
  expect(generated.fit.trials.at(-1)!.components![0].prepared?.status).toBe('fits')
  await saveRuleRevision(bucket, upload, job.input!.profile, { source: job.input!.profile.fingerprint, baseRevision: null, rules: { states: { vertical: { textAlign: 'center' } } } })
  await expect(readPreparedComponent(bucket, upload, job.componentId)).rejects.toThrow(/Настройки/)
  expect(await projectPreparedBoxes(bucket, project)).toEqual(pins)
  await worker.close()
})
