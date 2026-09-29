import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
const uploadId = process.env.MSP_UPLOAD_ID || '8d4274e6-7684-4427-a0ec-fbf1293d2424'
const base = process.env.MSP_BASE_URL || 'http://127.0.0.1:5184'
const browser = await chromium.launch({ executablePath: process.env.MSP_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await fs.mkdir('outputs/stage-5-calibration', { recursive: true })
try {
  await page.goto(`${base}/styles/${uploadId}?section=components`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.addScriptTag({ url: `${base}/pptx-reader.js?v=qualification-1` })
  if (process.argv.includes('--probe')) {
    const result = await page.evaluate(async id => {
      const state = await (await fetch(`/api/uploads/${id}/calibration?inputs=1`)).json()
      if (!state.components) throw new Error(JSON.stringify(state))
      const found = [], predicates = [c => c.name === 'Шаг процесса', c => c.name === 'Метрика 12%', c => c.name === 'Пункт легенды DAU', c => c.name === 'Линия', c => c.name === 'Иконка', c => c.name === 'Декоративная композиция']
      for (const predicate of predicates) {
        const c = state.components.find(predicate); if (!c) continue
        const assets = await Promise.all(c.source.assetIds.map(async id => ({ id, bytes: new Uint8Array(await (await fetch(`/api/uploads/${state.components[0] ? window.location.pathname.split('/')[2] : ''}/assets/${id}`)).arrayBuffer()) })))
        const q = await window.MspPptxReader.qualifyComponent(c, assets)
        found.push({ name: c.name, ...q })
      }
      return found
    }, uploadId)
    await fs.writeFile('outputs/stage-5-calibration/probe.json', JSON.stringify(result))
    for (const item of result) console.log(JSON.stringify({name:item.name,ready:item.ready,issues:item.issues,cases:item.cases}))
  } else {
    await page.getByRole('button', { name: 'Откалибровать компоненты', exact: true }).click({ timeout: 120000 })
    let last = ''
    for (let i = 0; i < 360; i++) {
      const status = await page.locator('.cw-gallery > .ds-note').textContent().catch(() => '')
      if (status && status !== last) { console.log(status); last = status }
      const error = await page.locator('.cw-gallery > .pw-error').count() ? await page.locator('.cw-gallery > .pw-error').textContent() : ''
      if (error) throw new Error(error)
      const state = await (await page.request.get(`${base}/api/uploads/${uploadId}/calibration`)).json()
      if (state.calibrated) {
        await fs.writeFile('outputs/stage-5-calibration/catalog.json', JSON.stringify(state.calibrated, null, 2))
        console.log(JSON.stringify({ families: state.calibrated.families.length, qualified: state.calibrated.qualifiedCount, excluded: state.calibrated.excluded.length, liveRequests: state.calibrated.liveRequests, cacheHits: state.calibrated.cacheHits }))
        await page.screenshot({ path: 'outputs/stage-5-calibration/catalog.png', fullPage: true }); break
      }
      await page.waitForTimeout(5000)
    }
  }
} finally { await browser.close() }
