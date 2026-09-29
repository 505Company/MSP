import { test as base, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { labCatalog, labTemplate } from './fixtures'
import { sourceCandidate } from '../lib/component-lab/source'
import { measurementIssues } from '../lib/component-lab/contract'
import { memoryBucket } from '../tests/helpers/memory-bucket'
import { readRuleHistory, saveRuleRevision, readPinnedRuleProfile } from '../lib/component-lab/storage'
import type { EditableCatalog } from '../lib/design-system/editable-contract'
const moduleRoot = `/@fs${fileURLToPath(new URL('..', import.meta.url))}/`
const test = base.extend<{ catalog: EditableCatalog }>({ catalog: [labCatalog(), { option: true }] })

test.beforeEach(async ({ page, catalog }) => {
  const { bucket } = memoryBucket(), upload = '00000000-0000-4000-a000-000000000001'
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/component-profiles')) {
      const id = new URL(route.request().url()).searchParams.get('component'), t = catalog.families.flatMap(f => f.variants).find(t => t.id === id)!
      const p = (await sourceCandidate(t, catalog.id)).profile!
      try {
        if (route.request().method() === 'GET') return route.fulfill({ json: await readRuleHistory(bucket, upload, p) })
        if (route.request().method() === 'POST') {
          const revision = await saveRuleRevision(bucket, upload, p, route.request().postDataJSON())
          // The same immutable profile can be pinned by a future generator.
          if (revision.technical === 'passed') expect((await readPinnedRuleProfile(bucket, upload, p, revision.id)).profile).toEqual(revision.profile)
          return route.fulfill({ json: { revision } })
        }
      } catch (e) { return route.fulfill({ status: 409, json: { error: e instanceof Error ? e.message : String(e) } }) }
    }
    if (route.request().method() !== 'GET') return route.abort()
    if (path === '/api/style-bank') return route.fulfill({ json: { styles: [{ id: 'lab-source', name: 'Изолированная проверка' }] } })
    if (path.endsWith('/editable-system')) return route.fulfill({ json: { catalog } })
    if (path.endsWith('/fonts')) return route.fulfill({ json: { fonts: [] } })
    return route.fulfill({ status: 404, json: {} })
  })
})
test('two-dimensional flow preserves fields, prefers rearrangement to shrinking, and offers measured alternatives', async ({ page }, info) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  const result = await page.evaluate(async ({ template, root }) => {
    const { sourceCandidate } = await import(root + 'lib/component-lab/source.ts') as typeof import('../lib/component-lab/source'), { measureComponent, pixelEvidence, renderCommittedComponent } = await import(root + 'browser/component-lab/measure.ts') as typeof import('../browser/component-lab/measure'), { sourceFonts } = await import(root + 'browser/component-lab/fonts.ts') as typeof import('../browser/component-lab/fonts')
    const { profile: p, content } = await sourceCandidate(template, 'test'), fonts = await sourceFonts('lab-source', p!)
    const target = document.createElement('div'); document.body.appendChild(target)
    try {
      const wide = await measureComponent(p!, content!, { width: 900, maxHeight: 240, widthMode: 'fill', heightMode: 'fill' }, fonts, { target })
      const evidence = await pixelEvidence(target.firstElementChild as HTMLElement, wide.chosen!, fonts)
      const tall = await measureComponent(p!, content!, { width: 380, maxHeight: 750, widthMode: 'fill', heightMode: 'fill' }, fonts)
      const tight = await measureComponent(p!, { ...content, [p!.fields[1].id]: 'Длинное пояснение условий измерения и полученного результата. '.repeat(3) }, { width: 380, maxHeight: 180, widthMode: 'fill', heightMode: 'fill' }, fonts)
      const missing = await measureComponent(p!, content!, { width: 800, maxHeight: 600, widthMode: 'fill', heightMode: 'hug' }, { css: '', available: [] })
      const same = await measureComponent(p!, content!, wide.constraints, fonts)
      const committed = await renderCommittedComponent(target, p!, content!, wide, fonts)
      let rejectsChangedContent = false, rejectsChangedGeometry = false
      try { await renderCommittedComponent(target, p!, { ...content, [p!.fields[1].id]: 'Другой текст' }, wide, fonts) } catch { rejectsChangedContent = true }
      const tampered = structuredClone(wide); tampered.chosen!.fields[1].box.y += 5
      try { await renderCommittedComponent(target, p!, content!, tampered, fonts) } catch { rejectsChangedGeometry = true }
      const lowContrast = structuredClone(p!); lowContrast.fields.forEach(f => { f.color = '#396cc4' })
      const low = await measureComponent(lowContrast, content!, wide.constraints, fonts, { target })
      const lowEvidence = await pixelEvidence(target.firstElementChild as HTMLElement, low.chosen!, fonts)
      const tightLeading = structuredClone(p!); tightLeading.fields.forEach(f => { f.leading = 1 })
      const fontMetrics = await measureComponent(tightLeading, content!, wide.constraints, fonts)
      const centered = structuredClone(p!); centered.behavior = { vertical: { textAlign: 'center', position: 'center', contentWidth: 100 } }
      const wrapped = { ...content, [p!.fields[1].id]: 'Человек приходит за решением своей конкретной задачи. Сотрудник уточняет условия, предлагает понятный порядок действий и остаётся на связи до завершения обращения. Все важные детали сохраняются.' }
      const centeredText = await measureComponent(centered, wrapped, { width: 320, maxHeight: 900, widthMode: 'fill', heightMode: 'fill', allowedStates: ['vertical'] }, fonts)
      return { wide, tall, tight, missing, same, evidence, lowEvidence, fontMetrics, centeredText, committed, rejectsChangedContent, rejectsChangedGeometry }
    } finally { target.remove() }
  }, { template: labTemplate(), root: moduleRoot })
  expect(result.wide.status).toBe('fits'); expect(result.wide.chosen!.state).toBe('compact'); expect(result.wide.chosen!.step).toBe(0)
  expect(result.tall.chosen!.state).toBe('vertical'); expect(result.tall.chosen!.height).toBe(750)
  expect(result.tight.status).toBe('needs-space'); expect(result.tight.feasibleSizes.length).toBeGreaterThan(0)
  expect(result.missing.status).toBe('unavailable'); expect(result.same.chosen).toEqual(result.wide.chosen)
  expect(result.evidence.passed).toBe(true)
  expect(result.evidence.minimumContrast).toBe(4)
  expect(result.lowEvidence.passed).toBe(false)
  expect(result.fontMetrics.status).toBe('fits'); expect(result.fontMetrics.chosen!.step).toBe(0)
  expect(result.centeredText.status).toBe('fits'); expect(result.centeredText.chosen!.step).toBe(0)
  expect(result.committed).toEqual(result.wide.chosen); expect(result.rejectsChangedContent).toBe(true); expect(result.rejectsChangedGeometry).toBe(true)
  const { profile, content } = await sourceCandidate(labTemplate(), 'test')
  const bad = structuredClone(result.wide.chosen!); bad.fields[1].text = 'Потерянный текст'
  expect(measurementIssues(profile!, content!, bad, result.wide.constraints)).toContain(`field-content:${bad.fields[1].id}`)
  const wrongFont = structuredClone(result.wide.chosen!); wrongFont.fields[0].font = 'Unrecorded substitution'
  expect(measurementIssues(profile!, content!, wrongFont, result.wide.constraints)).toContain(`field-font:${wrongFont.fields[0].id}`)
  await writeFile(info.outputPath('wide.png'), Buffer.from(result.evidence.preview.split(',')[1], 'base64'))
})
test('all three source families qualify a cross product of shapes and content with explicit negative cases', async ({ page }, info) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  const reports = await page.evaluate(async ({ templates, root }) => {
    const { sourceCandidate } = await import(root + 'lib/component-lab/source.ts') as typeof import('../lib/component-lab/source'), { sourceFonts } = await import(root + 'browser/component-lab/fonts.ts') as typeof import('../browser/component-lab/fonts'), { checkQuality } = await import(root + 'browser/component-lab/qualification.ts') as typeof import('../browser/component-lab/qualification')
    const reports = []
    for (const t of templates) { const c = await sourceCandidate(t, 'test'); reports.push(await checkQuality(c.profile!, await sourceFonts('lab-source', c.profile!))) }
    return reports
  }, { templates: (['metric', 'text', 'numbered'] as const).map(labTemplate), root: moduleRoot })
  for (const report of reports) {
    await writeFile(info.outputPath(`report-${report.profile.slice(0, 8)}.json`), JSON.stringify(report))
    expect(report.technical, JSON.stringify(report.cases.filter(c => c.assertion === false).map(c => ({ id: c.id, issues: c.measurement.issues })))).toBe('passed')
    expect(report.artistic).toBe('not-reviewed'); expect(report.generationAdmission).toBe(false)
    expect(report.policy.minimumTextContrast).toBe(4)
    expect(report.coverage.fits).toBeGreaterThan(10)
    expect(report.cases.find(c => c.id === 'overflow')!.measurement.status).toBe('needs-space')
  }
})
test('standalone UI changes both axes, switches source and content, and reports capacity without writing API data', async ({ page }, info) => {
  const writes: string[] = [], errors: string[] = []
  page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url()) }); page.on('pageerror', e => errors.push(e.message))
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#component').selectOption('lab-numbered'); await expect(page.locator('#fields textarea')).toHaveCount(3)
  await page.locator('#sample').selectOption('short'); await page.getByRole('button', { name: 'Горизонтальный', exact: true }).click(); await expect(page.locator('#dimensions')).toContainText('800 × 400')
  await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#box-settings summary').click()
  await page.locator('#height').fill('80'); await page.locator('#height').blur(); await expect(page.locator('#status')).toHaveText('Нужно больше места')
  await expect(page.locator('#result')).toContainText('Измеренные варианты')
  await page.getByRole('button', { name: 'Квадратный', exact: true }).click(); await page.locator('#verification summary').click(); await page.locator('#run').click()
  await expect(page.locator('#progress')).toHaveText('35 из 35', { timeout: 90000 })
  await expect(page.locator('#download')).toBeEnabled(); await expect(page.locator('#quality-note')).toContainText('в генерацию не включён')
  expect(writes).toEqual([]); expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: info.outputPath('lab.png'), fullPage: false })
})
test('lab server blocks API writes even outside browser UI', async ({ request }) => {
  const response = await request.post('/api/projects', { data: { name: 'Must not exist' } }); expect(response.status()).toBe(405)
  const foreign = await request.post('/api/uploads/00000000-0000-4000-a000-000000000001/component-profiles?component=x', { headers: { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' }, data: {} }); expect(foreign.status()).toBe(403)
})
test('horizontal flow reserves the actual width of a number before placing its caption', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  const result = await page.evaluate(async ({ template, root }) => {
    const { sourceCandidate } = await import(root + 'lib/component-lab/source.ts') as typeof import('../lib/component-lab/source')
    const { sourceFonts } = await import(root + 'browser/component-lab/fonts.ts') as typeof import('../browser/component-lab/fonts')
    const { measureComponent } = await import(root + 'browser/component-lab/measure.ts') as typeof import('../browser/component-lab/measure')
    const { profile: p, content } = await sourceCandidate(template, 'test'), fonts = await sourceFonts('lab-source', p!)
    const text = { ...content, [p!.fields[0].id]: '3,7 млн', [p!.fields[1].id]: 'тематических упоминаний из отзывов' }
    p!.behavior = { horizontal: { position: 'center', textAlign: 'source', contentWidth: 100, padding: 37 } }
    const box = { width: 600, maxHeight: 400, widthMode: 'fill', heightMode: 'fill', allowedStates: ['horizontal'] } as const
    const centered = await measureComponent(p!, text, { ...box, allowedStates: ['horizontal'] }, fonts)
    p!.behavior.horizontal!.position = 'top'
    const top = await measureComponent(p!, text, { ...box, allowedStates: ['horizontal'] }, fonts)
    const narrow = await measureComponent(p!, text, { ...box, width: 300, allowedStates: ['horizontal'] }, fonts)
    const unbreakable = await measureComponent(p!, { ...text, [p!.fields[1].id]: 'Сверхдлинноесловобезпробеловдляпроверкипереносавнутрикарточки' }, { ...box, width: 320, maxHeight: 900, allowedStates: ['vertical'] }, fonts)
    return { centered, top, narrow, unbreakable }
  }, { template: labTemplate(), root: moduleRoot })
  expect(result.narrow.status).toBe('needs-space')
  expect(result.unbreakable.status).toBe('needs-space')
  expect(result.centered.status).toBe('fits'); expect(result.centered.chosen!.step).toBe(0)
  expect(result.top.status).toBe('fits'); expect(result.top.chosen!.step).toBe(0)
  for (const measured of [result.centered, result.top]) {
    const [number, caption] = measured.chosen!.fields
    expect(caption.box.x).toBeGreaterThan(number.ink.x + number.ink.width)
    expect(number.text).toBe('3,7 млн'); expect(caption.text).toBe('тематических упоминаний из отзывов')
  }
})
test('a rejected horizontal preview never shows overlapping fields and offers a safe view', async ({ page }, info) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#content-fields summary').click(); await page.locator('#fields textarea').first().fill('3,7 млн')
  await page.locator('#box-settings summary').click(); await page.locator('#width').fill('300'); await page.locator('#width').blur()
  await page.locator('#state').selectOption('horizontal'); await page.locator('#position [data-value=center]').click()
  await expect(page.locator('#status')).toHaveText('Нужно больше места')
  await page.screenshot({ path: info.outputPath('rejected-horizontal.png') })
  await expect(page.locator('#preview [data-component-field]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Увеличить область', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('Помещается')
  // At a wide outer size only the restricted horizontal content width fails;
  // the unchanged vertical rules provide a valid alternative at the same size.
  await page.locator('#width').fill('600'); await page.locator('#width').blur()
  await page.locator('#height').fill('400'); await page.locator('#height').blur()
  await page.locator('#advanced summary').click(); await page.locator('#content-width').fill('50'); await page.locator('#content-width').blur()
  await expect(page.locator('#status')).toHaveText('Нужно больше места')
  await expect(page.locator('#preview [data-component-field]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Подобрать вид', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.locator('#state')).toHaveValue('auto')
  await expect(page.locator('#preview')).toContainText('3,7 млн')
  await expect(page.locator('#fields textarea').first()).toHaveValue('3,7 млн')
  await expect(page.locator('#save-status')).toHaveText('Есть несохранённые изменения')
  await page.screenshot({ path: info.outputPath('recovered-preview.png') })
})
test('simple controls center the whole group, save a checked version, reload and restore history', async ({ page }, info) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.locator('#padding')).not.toBeVisible(); await expect(page.locator('#run')).not.toBeVisible()
  await page.locator('#state').selectOption('vertical')
  await page.locator('#alignment [data-value=center]').click(); await page.locator('#position [data-value=center]').click()
  await expect(page.locator('#position [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#status')).toHaveText('Помещается')
  const geometry = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#preview [data-component-box]')!, fields = [...root.querySelectorAll<HTMLElement>('[data-component-field]')], b = root.getBoundingClientRect()
    const rects = fields.map(f => f.getBoundingClientRect()), top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom))
    return { centerOffset: Math.abs((top + bottom) / 2 - (b.top + b.bottom) / 2), aligns: fields.map(f => getComputedStyle(f).textAlign) }
  })
  expect(geometry.centerOffset).toBeLessThan(1); expect(geometry.aligns).toEqual(['center', 'center'])
  await page.screenshot({ path: info.outputPath('simple-editor.png') })
  await page.locator('#save').click(); await expect(page.locator('#save-status')).toContainText('Сохранена версия 1 · проверка пройдена', { timeout: 90000 })
  await page.evaluate(() => localStorage.clear()); await page.reload(); await expect(page.locator('#save-status')).toContainText('Сохранена версия 1')
  await page.locator('#state').selectOption('vertical'); await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#state').selectOption('horizontal'); await expect(page.locator('#alignment [data-value=source]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#state').selectOption('vertical'); await page.locator('#position [data-value=bottom]').click(); await page.locator('#save').click()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 2', { timeout: 90000 })
  await page.locator('#history summary').click(); await page.locator('#versions').selectOption({ label: 'Версия 1 · проверена' }); await page.locator('#restore').click()
  await expect(page.locator('#position [data-value=center]')).toHaveAttribute('aria-pressed', 'true'); await page.locator('#save').click()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 3', { timeout: 90000 }); await expect(page.locator('#versions option')).toHaveCount(3)
  // A renderer upgrade retains the settings/history but must not reuse its old
  // qualification or require a pretend user edit to enable rechecking.
  const legacy = await page.evaluate(async () => {
    const response = await fetch('/api/uploads/lab-source/component-profiles?component=lab-metric')
    return response.json() as Promise<{ versions: { proof?: { version: string } }[] }>
  })
  for (const v of legacy.versions) if (v.proof) v.proof.version = 'component-box-2'
  await page.route('**/component-profiles?*', route => route.request().method() === 'GET' ? route.fulfill({ json: legacy }) : route.fallback())
  await page.reload(); await expect(page.locator('#save-status')).toContainText('Сохранена версия 3 · нужна новая проверка')
  await page.locator('#state').selectOption('vertical'); await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#save')).toBeEnabled(); await page.locator('#save').click()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 4 · проверка пройдена', { timeout: 90000 })
  await expect(page.locator('#versions option')).toHaveCount(4)
})
test('failed or cancelled saves retain a draft without overwriting server rules', async ({ page }) => {
  const writes: string[] = []
  page.on('request', r => { if (r.method() === 'POST') writes.push(r.url()) })
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#state').selectOption('vertical'); await page.locator('#alignment [data-value=center]').click()
  await page.locator('#save').click(); await expect(page.locator('#save-status')).toContainText('Проверяем:'); await page.locator('#cancel').click()
  await expect(page.locator('#save-status')).toContainText('Проверка остановлена'); expect(writes).toEqual([])
  await page.reload(); await expect(page.locator('#save-status')).toContainText('Восстановлен ваш несохранённый черновик')
  await page.locator('#state').selectOption('vertical'); await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await page.route('**/component-profiles?*', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'В другой вкладке уже сохранена версия. Черновик сохранён.' } }) : route.fallback())
  await page.locator('#save').click(); await expect(page.locator('#save-status')).toContainText('В другой вкладке', { timeout: 90000 })
  await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#save')).toBeEnabled()
})

function missingFontCatalog() {
  const catalog = labCatalog()
  for (const slot of catalog.families[0].variants[0].sourceLayout!.text) {
    slot.element.fontFamily = 'MSP Unavailable Sans'
    slot.element.styleRuns!.forEach(run => { run.fontFamily = 'MSP Unavailable Sans' })
  }
  return catalog
}
// Synthetic font bytes keep service/weight/error tests independent of Google's
// network. Actual Noto typography is checked separately on the live source.
async function googleFixture(page: Page, boldAvailable: () => boolean) {
  const requests: string[] = []
  await page.route('**/api/fonts/google?*', async route => {
    const url = new URL(route.request().url()), family = url.searchParams.get('family'), style = url.searchParams.get('style')
    requests.push(url.search)
    if (family !== 'Noto Sans' || style === 'Bold' && !boldAvailable()) return route.fulfill({ json: { files: [] } })
    if (url.searchParams.has('asset')) return route.fulfill({ contentType: 'font/ttf', body: await readFile(new URL(`../public/fonts/play/Play-${style === 'Bold' ? 'Bold' : 'Regular'}.ttf`, import.meta.url)) })
    return route.fulfill({ json: { files: [{ url: `${url.pathname}${url.search}&asset=0` }] } })
  })
  return requests
}
test.describe('Google font replacements', () => {
  test.use({ catalog: missingFontCatalog() })
  test('missing source gets a labelled replacement which survives edits, save and reload', async ({ page }, info) => {
    const requests = await googleFixture(page, () => true)
    await page.goto('/'); await expect(page.locator('#status')).toHaveText('Помещается')
    await expect(page.locator('#font-note')).toHaveText('Шрифт заменён: MSP Unavailable Sans → Noto Sans (Google Fonts).')
    await expect(page.locator('#save')).toBeEnabled()
    await page.locator('#state').selectOption('vertical'); await page.locator('#alignment [data-value=center]').click()
    await expect(page.locator('#status')).toHaveText('Помещается')
    const families = await page.locator('#preview [data-component-field]').evaluateAll(fields => fields.map(f => getComputedStyle(f).fontFamily))
    expect(families.every(f => f.includes('Noto Sans'))).toBe(true)
    await page.screenshot({ path: info.outputPath('font-replacement.png') })
    await page.locator('#save').click(); await expect(page.locator('#save-status')).toContainText('проверка пройдена', { timeout: 90000 })
    await page.evaluate(() => localStorage.clear()); await page.reload()
    await expect(page.locator('#save-status')).toContainText('Сохранена версия 1')
    await expect(page.locator('#font-note')).toContainText('MSP Unavailable Sans → Noto Sans')
    await expect(page.locator('#status')).toHaveText('Помещается')
    expect(requests.some(q => new URLSearchParams(q).get('style') === 'Bold')).toBe(true)
    expect(requests.every(q => [...new URLSearchParams(q).keys()].every(k => ['family', 'style', 'asset'].includes(k)))).toBe(true)
  })
  test('incomplete replacement stays unavailable and can recover without a poisoned cache', async ({ page }) => {
    let bold = false; await googleFixture(page, () => bold)
    await page.goto('/'); await expect(page.locator('#status')).toHaveText('Шрифт недоступен')
    await expect(page.locator('#font-note')).not.toBeVisible(); await expect(page.locator('#preview [data-component-field]')).toHaveCount(0)
    bold = true; await page.locator('#component').selectOption('lab-text'); await expect(page.locator('#status')).toHaveText('Помещается')
    await page.locator('#component').selectOption('lab-metric'); await expect(page.locator('#status')).toHaveText('Помещается')
    await expect(page.locator('#font-note')).toContainText('Noto Sans')
  })
})
