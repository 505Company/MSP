import { chromium } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { StudioRun } from '../lib/presentations/studio/contract'
const run = JSON.parse(await readFile(process.argv[2], 'utf8')) as StudioRun, out = process.argv[3]
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage(), errors: string[] = []
  await page.addInitScript('globalThis.__name = value => value')
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort())
  await page.goto('http://localhost:5184/processing-worker')
  const report = []
  for (const work of run.slides) {
    const results = await page.evaluate(async ({ library, work, selected }) => {
      const path = '/browser/studio-color-zones.ts', { restyleStudioReceipt } = await import(path) as typeof import('../browser/studio-color-zones')
      const measure = (html: string) => {
        const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', width: '1920px', top: '0' }); host.innerHTML = html; document.body.appendChild(host)
        const root = host.querySelector<HTMLElement>('[data-studio-slide]')!, base = root.getBoundingClientRect()
        const geometry = [...root.querySelectorAll<HTMLElement>('[data-field], [data-component-field], [data-source-text]')].map(el => { const b = el.getBoundingClientRect(), css = getComputedStyle(el); return { text: el.textContent, x: b.x - base.x, y: b.y - base.y, w: b.width, h: b.height, font: css.fontFamily, size: css.fontSize } })
        const data = work.content.blocks.filter(b => b.data).map(b => root.querySelector(`[data-block="${b.id}"]`)?.innerHTML)
        const panels = root.querySelectorAll('[data-studio-accent-panel]').length
        host.remove(); return { geometry, data, panels }
      }
      const results = []
      for (const before of work.options?.map(o => o.receipt!) ?? [selected]) {
        const after = await restyleStudioReceipt(library, work, before)
        results.push({ before: measure(before.html), after: measure(after.html), receipt: after })
      }
      return results
    }, { library: run.library, work, selected: run.results[work.content.id] })
    for (const [i, result] of results.entries()) {
      assert.deepEqual(result.before.geometry, result.after.geometry, `${work.content.id}: geometry`)
      assert.deepEqual(result.before.data, result.after.data, `${work.content.id}: data`)
      const r = result.receipt
      await writeFile(`${out}/${work.content.id}-${i}.png`, Buffer.from(r.preview.split(',')[1], 'base64'))
      if (r.optionId === run.results[work.content.id].optionId) { run.results[work.content.id] = r; await writeFile(`${out}/${work.content.id}.png`, Buffer.from(r.preview.split(',')[1], 'base64')) }
      work.options![i].receipt = r
      report.push({ slide: r.slideId, option: r.optionId, treatment: r.brandAccents, geometry: 'unchanged', data: 'unchanged' })
    }
  }
  assert.deepEqual(errors, [])
  await writeFile(`${out}/run.json`, JSON.stringify(run))
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await page.setViewportSize({ width: 1500, height: 680 })
  await page.setContent(`<html><body style="margin:0;padding:18px;background:#e8ebf1;font:16px Arial"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${run.slides.map(s => run.results[s.content.id]).map((r, i) => `<div><img style="width:100%;display:block" src="${r.preview}"><div style="padding:8px">${i + 1} · ${r.brandAccents?.panel ? 'Акцентный блок' : i ? 'Акценты в тексте' : 'Обложка дизайн-системы'}</div></div>`).join('')}</div></body></html>`)
  await page.screenshot({ path: `${out}/gallery.png`, fullPage: true })
  console.log(JSON.stringify(report))
} finally { await browser.close() }
