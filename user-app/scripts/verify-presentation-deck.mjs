// Opt-in live Q2→Q3→Q4/Q5. Uses the same browser executor/report endpoint as the UI.
// No credential reads, no model-response edits, no handwritten slide fallback.
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
if (!process.argv.includes('--live')) throw new Error('Pass --live to allow configured Qwen requests')
const base = 'http://localhost:5184', output = 'outputs/q4', stateFile = `${output}/control-project.json`
await mkdir(output, { recursive: true })
const payload = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function api(path, init) {
  const response = await fetch(base + path, init), body = await response.text()
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${body.slice(0, 1000)}`)
  if (response.headers.get('content-type')?.includes('ndjson')) return { stream: body }
  return JSON.parse(body)
}
let id
if (process.argv.includes('--resume')) id = JSON.parse(await readFile(stateFile, 'utf8')).id
else {
  id = crypto.randomUUID()
  await api('/api/projects', payload({ id, uploadId: '8d4274e6-7684-4427-a0ec-fbf1293d2424', name: 'Контроль Q4/Q5 — временный', text: await readFile('tests/fixtures/q2-content.md', 'utf8') }))
  await writeFile(stateFile, JSON.stringify({ id }, null, 2))
}
console.log(JSON.stringify({ phase: 'project', projectId: id }))
const browser = await chromium.launch({ executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await page.goto(base); await page.addScriptTag({ url: `${base}/pptx-reader.js` })
  let q2 = await api(`/api/projects/${id}/structure`)
  if (q2.structure?.status !== 'ready') {
    console.log(JSON.stringify({ phase: 'Q2' }))
    await api(`/api/projects/${id}/structure`, payload({ materialId: q2.materialId }))
    q2 = await api(`/api/projects/${id}/structure`)
  }
  await writeFile(`${output}/structure.json`, JSON.stringify(q2, null, 2)); assert.equal(q2.structure.status, 'ready', JSON.stringify(q2.structure.error))
  let q3 = await api(`/api/projects/${id}/recipes`)
  if (q3.plan?.status !== 'ready') {
    console.log(JSON.stringify({ phase: 'Q3' }))
    await api(`/api/projects/${id}/recipes`, payload({ inputId: q3.inputId, materialId: q3.materialId, uploadId: q3.uploadId }))
    q3 = await api(`/api/projects/${id}/recipes`)
  }
  await writeFile(`${output}/recipes.json`, JSON.stringify(q3, null, 2)); assert.equal(q3.plan.status, 'ready', JSON.stringify(q3.plan.error))
  const assetCache = new Map()
  for (let step = 0; step < 40; step++) {
    const scope = await api(`/api/projects/${id}/deck`)
    await writeFile(`${output}/state.json`, JSON.stringify(scope, null, 2))
    const status = scope.state?.status
    console.log(JSON.stringify({ phase: 'deck', status: status ?? 'preflight', slides: scope.state?.slides.map(s => ({ id: s.id, status: s.status, attempts: s.attempts.length, issues: s.attempts.at(-1)?.issues })) }))
    if (status === 'ready' || status === 'blocked' || status === 'failed') {
      const before = scope.state.slides.reduce((n,s) => n + s.attempts.reduce((n,a) => n + a.requests, 0), 0)
      if (status === 'ready') await api(`/api/projects/${id}/deck`, payload({ action: 'advance', inputId: scope.inputId, reference: '' }))
      const replay = await api(`/api/projects/${id}/deck`)
      assert.equal(replay.state.slides.reduce((n,s) => n + s.attempts.reduce((n,a) => n + a.requests, 0), 0), before)
      for (const slide of scope.state.slides.filter(s => s.status === 'ready')) {
        const image = await fetch(`${base}/api/projects/${id}/deck/preview?inputId=${scope.inputId}&slideId=${slide.id}`)
        assert.ok(image.ok); await writeFile(`${output}/${slide.id}.png`, new Uint8Array(await image.arrayBuffer()))
      }
      let uiRepeatedRequests = null
      if (status === 'ready') {
        uiRepeatedRequests = 0
        page.on('request', request => { if (request.method() === 'POST' && /\/(structure|recipes|deck)$/.test(new URL(request.url()).pathname)) uiRepeatedRequests++ })
        await page.goto(`${base}/projects/${id}`)
        await page.getByRole('status').filter({ hasText: 'Презентация готова:' }).waitFor({ timeout: 30000 })
        await page.locator('.ws-deck-previews img').last().waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('.ws-deck-previews img')].every(image => image.complete && image.naturalWidth > 0))
        await page.screenshot({ path: `${output}/project.png`, fullPage: true })
        await page.reload()
        await page.getByRole('status').filter({ hasText: 'Презентация готова:' }).waitFor({ timeout: 30000 })
        assert.equal(uiRepeatedRequests, 0)
      }
      await writeFile(`${output}/verification.json`, JSON.stringify({ uiRepeatedRequests, projectId: id, inputId: scope.inputId, checkedAt: new Date().toISOString(), status, q2Requests: q2.structure.liveRequests, q3Requests: q3.plan.liveRequests, sceneRequests: before, replayAdditionalRequests: 0, readySlides: scope.state.slides.filter(s => s.status === 'ready').length, totalSlides: scope.state.slides.length, temporaryProjectArchived: false }, null, 2))
      break
    }
    assert.ok(!scope.state?.slides.some(s => s.status === 'running'), 'A prior worker is still active; wait before resuming')
    const input = scope.next.input
    const assets = []
    for (const assetId of [...new Set(input.resources.flatMap(c => c.source.assetIds))]) {
      const key = `${scope.uploadId}:${assetId}`
      if (!assetCache.has(key)) {
        const response = await fetch(`${base}/api/uploads/${scope.uploadId}/assets/${assetId}`)
        if (response.ok) assetCache.set(key, { id: assetId, bytes: [...new Uint8Array(await response.arrayBuffer())] })
      }
      if (assetCache.has(key)) assets.push(assetCache.get(key))
    }
    if (scope.next.scene) {
      const rendered = await page.evaluate(async ({ scope, assets }) => window.MspPptxReader.renderDeckSlide(scope.next.scene, scope.next.input, scope.next.sceneHash, assets.map(a => ({ ...a, bytes: Uint8Array.from(a.bytes) }))), { scope, assets })
      const number = scope.state.slides.find(s => s.id === input.slideId).attempts.length
      await writeFile(`${output}/${input.slideId}-attempt-${number}.json`, JSON.stringify(rendered, (key, value) => key === 'preview' ? undefined : value, 2))
      if (rendered.preview) await writeFile(`${output}/${input.slideId}-attempt-${number}.png`, Buffer.from(rendered.preview.split(',')[1], 'base64'))
      console.log(JSON.stringify({ phase: 'measurement', slideId: input.slideId, attempt: number, issues: rendered.report.issues }))
      await api(`/api/projects/${id}/deck`, payload({ action: 'report', inputId: scope.inputId, slideId: input.slideId, report: rendered.report, preview: rendered.preview }))
    } else {
      const evidence = scope.state ? undefined : await page.evaluate(async ({ input, assets }) => window.MspPptxReader.prepareDeckEvidence(input.resources, input.brand.tokens.fonts.map(f => f.family), assets.map(a => ({ ...a, bytes: Uint8Array.from(a.bytes) }))), { input, assets })
      const reference = `data:image/png;base64,${(await readFile(`public${scope.next.referenceUrl}`)).toString('base64')}`
      console.log(JSON.stringify({ phase: 'Q4/Q5', slideId: input.slideId, variantId: input.variant.id, ...(evidence ? { fonts: evidence.fonts, resources: evidence.resourceIds.length } : {}) }))
      await api(`/api/projects/${id}/deck`, payload({ action: 'advance', inputId: scope.inputId, reference, ...(evidence ? { evidence } : {}) }))
    }
  }
} finally { await browser.close() }
