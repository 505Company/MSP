import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const upload = process.argv[2], component = process.argv[3]
if (!upload) throw Error('Pass the upload ID; optional component ID follows')
const origin = 'http://127.0.0.1:5197', checkOverlap = process.argv.includes('--overlap'), checkFonts = process.argv.includes('--fonts'), folder = `outputs/diagnostics/component-lab${checkOverlap ? '-overlap' : checkFonts ? '-fonts' : ''}`
await mkdir(folder, { recursive: true })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const before = await (await fetch(`${origin}/api/uploads/${upload}/editable-system`)).json()
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = [], blocked = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', route => { if (route.request().method() === 'GET') return route.continue(); blocked.push(route.request().url()); return route.abort() })
  await page.goto(`${origin}/?${new URLSearchParams({ upload, ...(component ? { component } : {}) })}`)
  await page.waitForFunction(() => !!window.__componentLab?.measurement, undefined, { timeout: 60000 })
  let fontCheck
  if (checkFonts) {
    const replacements = await page.evaluate(() => window.__componentLab.profile.fontReplacements)
    assert.ok(replacements?.length, 'The missing source font must have an explicit replacement')
    assert.equal(await page.locator('#font-note').isVisible(), true)
    const note = await page.locator('#font-note').innerText()
    assert.ok(note.includes('Google Fonts'))
    const used = await page.locator('#preview [data-component-field]').evaluateAll(fields => fields.map(f => getComputedStyle(f).fontFamily))
    assert.ok(used.length && replacements.every(r => used.some(f => f.includes(r.family))))
    await page.screenshot({ path: `${folder}/substitution.png` })
    fontCheck = { replacements, note, used }
  }
  let overlapCheck
  if (checkOverlap) {
    await page.locator('#state').selectOption('horizontal'); await page.locator('#position [data-value=center]').click()
    await page.locator('#advanced summary').click(); await page.locator('#padding').fill('37'); await page.locator('#padding').blur()
    await page.waitForFunction(() => window.__componentLab?.profile?.behavior?.horizontal?.padding === 37 && window.__componentLab?.measurement?.chosen?.state === 'horizontal' && window.__componentLab?.measurement?.status === 'fits')
    const horizontal = await page.evaluate(() => window.__componentLab.measurement)
    assert.equal(horizontal.chosen.issues.length, 0)
    const splitWords = await page.locator('#preview [data-component-field]').evaluateAll(fields => fields.flatMap(field => {
      const node = field.firstChild, range = document.createRange()
      if (!node) return []
      return [...field.textContent.matchAll(/[\p{L}]+/gu)].filter(word => {
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length)
        return new Set([...range.getClientRects()].filter(r => r.width).map(r => Math.round(r.y))).size > 1
      }).map(word => word[0])
    }))
    assert.deepEqual(splitWords, [], 'Ordinary words must not split inside a narrow caption')
    await page.screenshot({ path: `${folder}/horizontal.png` })
    await page.locator('#content-width').fill('50'); await page.locator('#content-width').blur()
    await page.getByRole('button', { name: 'Подобрать вид', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.locator('#preview [data-component-field]').count(), 0)
    await page.screenshot({ path: `${folder}/needs-space.png` })
    await page.getByRole('button', { name: 'Подобрать вид', exact: true }).click()
    await page.waitForFunction(() => window.__componentLab?.measurement?.status === 'fits')
    const recovered = await page.evaluate(() => window.__componentLab.measurement)
    assert.equal(recovered.chosen.state, 'vertical')
    assert.deepEqual(recovered.chosen.fields.map(f => f.text), horizontal.chosen.fields.map(f => f.text))
    await page.screenshot({ path: `${folder}/recovered.png` })
    overlapCheck = { horizontal: { status: horizontal.status, step: horizontal.chosen.step, fields: horizontal.chosen.fields }, invalidPreviewHidden: true, recovered: { status: recovered.status, state: recovered.chosen.state }, unchangedText: true }
    await page.locator('#state').selectOption('horizontal'); await page.locator('#content-width').fill('100'); await page.locator('#content-width').blur()
  }
  if (process.argv.includes('--center')) {
    await page.locator('#state').selectOption('vertical')
    await page.locator('#alignment [data-value=center]').click(); await page.locator('#position [data-value=center]').click()
    await page.waitForFunction(() => window.__componentLab?.profile?.behavior?.vertical?.position === 'center' && window.__componentLab?.measurement?.chosen?.state === 'vertical')
    await page.screenshot({ path: `${folder}/editor.png` })
  }
  await page.locator('#sample').selectOption('medium')
  await page.getByRole('button', { name: 'Горизонтальный', exact: true }).click()
  await page.waitForFunction(() => window.__componentLab?.measurement?.constraints.width === 800)
  await page.screenshot({ path: `${folder}/landscape.png` })
  const wide = await page.evaluate(() => window.__componentLab.measurement)
  await page.getByRole('button', { name: 'Узкий высокий', exact: true }).click()
  await page.waitForFunction(() => window.__componentLab?.measurement?.constraints.width === 320)
  await page.screenshot({ path: `${folder}/portrait.png` })
  const tall = await page.evaluate(() => window.__componentLab.measurement)
  await page.locator('#verification summary').click()
  await page.locator('#run').click()
  await page.waitForFunction(() => !!window.__componentLab?.report, undefined, { timeout: 120000 })
  const evidence = await page.evaluate(() => window.__componentLab)
  await writeFile(`${folder}/report.json`, JSON.stringify(evidence, null, 2))
  await page.screenshot({ path: `${folder}/matrix.png` })
  const after = await (await fetch(`${origin}/api/uploads/${upload}/editable-system`)).json()
  const summary = { upload, component: evidence.profile.id, catalog: evidence.profile.catalogId, version: evidence.report.version, policy: evidence.report.policy, technical: evidence.report.technical, artistic: evidence.report.artistic, generationAdmission: evidence.report.generationAdmission, coverage: evidence.report.coverage,
    failures: evidence.report.cases.filter(c => c.assertion === false || c.evidence && !c.evidence.passed).map(c => ({ id: c.id, status: c.measurement.status, issues: c.measurement.issues, pixels: c.evidence?.pixels })),
    wide: { status: wide.status, state: wide.chosen?.state, requiredHeight: wide.chosen?.requiredHeight }, tall: { status: tall.status, state: tall.chosen?.state, requiredHeight: tall.chosen?.requiredHeight },
    ...(overlapCheck ? { overlapCheck } : {}), ...(fontCheck ? { fontCheck } : {}), unchangedCatalog: hash(before.catalog) === hash(after.catalog), sourceHash: hash(before.catalog), errors, blocked,
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }
  await writeFile(`${folder}/summary.json`, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2))
  if (errors.length || blocked.length || !summary.unchangedCatalog || summary.overflow) process.exitCode = 1
} finally { await browser.close() }
