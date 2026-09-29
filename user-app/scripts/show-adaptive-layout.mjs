// Read-only presentation and browser verification. Does not rerender or repair slides.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
const [output = 'outputs/diagnostics/adaptive-layout-live', origin = 'http://127.0.0.1:5184', comparisonOutput] = process.argv.slice(2)
const result = JSON.parse(await readFile(`${output}/result.json`, 'utf8'))
const get = async path => { const r = await fetch(origin + path); if (!r.ok) throw Error(await r.text()); return r.json() }
const state = async () => ({ project: await get(`/api/projects/${result.projectId}`), layout: await get(`/api/projects/${result.projectId}/layout`), job: (await get(`/api/projects/${result.projectId}/generation`)).job })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const before = await state(), escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const slides = before.layout.slides
const ready = slides.filter(s => s.phase === 'ready').length, measured = slides.filter(s => s.adaptiveFit?.passed || s.fit?.passed || s.templateFit?.passed).length
for (const slide of slides) {
  if (slide.previewRound === undefined) continue
  const url = `/api/projects/${result.projectId}/layout/preview?inputId=${result.inputId}&slideId=${slide.id}&round=${slide.previewRound}&render=${before.layout.renderVersion}`
  const response = await fetch(origin + url)
  if (!response.ok) throw Error(`Preview missing: ${slide.id}`)
  await writeFile(`${output}/generation/${slide.id}.png`, new Uint8Array(await response.arrayBuffer()))
}
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Автолейаут: контроль</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f2f4f6;color:#18202a;font:16px/1.5 system-ui,sans-serif;letter-spacing:0}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:30px;margin:0 0 12px}h2{font-size:21px;margin:0 0 12px}.lead{max-width:1050px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}section{margin-top:32px}figure{margin:0;min-width:0}img{width:100%;aspect-ratio:16/9;object-fit:contain;background:#fff;display:block;border:1px solid #d8dce2}a{color:#005db5}figcaption{padding:12px 0;font-size:15px}.ok{color:#16643c}.warn{color:#a43923}details{font-size:14px;margin-top:8px}summary{cursor:pointer}p{margin:8px 0}</style>
<main><h1>${escape(result.name ?? 'Автолейаут: контроль на исходном материале')}</h1><p class="lead">Содержание не менялось. Измерения: ${measured}/${slides.length}. Полная проверка, включая Qwen: ${ready}/${slides.length}. Это эксперимент, не художественная приёмка всего рецепта.</p>
<p>Расход: ${result.structureRequests} запрос подготовки + ${result.layoutBudget.used} оформления. <a href="${escape(result.url)}">Открыть проект</a> · <a href="result.json">Результат</a> · <a href="preservation.json">Сохранность прежней работы</a></p>
${comparisonOutput ? `<section><h2>До / после: тот же исходный материал</h2><div class="grid">${slides.map(s => `<figure><a href="/${escape(comparisonOutput)}/generation/${s.id}.png"><img src="/${escape(comparisonOutput)}/generation/${s.id}.png" alt="Прежний автолейаут"></a><figcaption>До: ${escape(s.title)}. Сохранённый PNG предыдущего эксперимента.</figcaption></figure><figure>${s.previewRound !== undefined ? `<a href="generation/${s.id}.png"><img src="generation/${s.id}.png" alt="Новый результат"></a>` : '<p>Нового PNG нет.</p>'}<figcaption>После: ${escape(s.title)}. ${escape(s.phase)}</figcaption></figure>`).join('')}</div></section>` : ''}
<section><h2>Результаты текущего запуска</h2><div class="grid">${slides.map(s => `<figure>${s.previewRound !== undefined ? `<a href="generation/${s.id}.png"><img src="generation/${s.id}.png" alt="${escape(s.title)}"></a>` : '<p>Попытка не дошла до изображения.</p>'}<figcaption><strong>${escape(s.title)}</strong><p class="${s.phase === 'ready' ? 'ok' : 'warn'}">${s.phase === 'ready' ? 'Измерения и проверка Qwen пройдены' : escape(s.phase)}</p><p>Библиотечные экземпляры: ${s.adaptiveFit?.trials.at(-1)?.components?.length ?? 0}</p>${s.error ? `<details><summary>Причина</summary>${escape(s.error)}</details>` : ''}</figcaption></figure>`).join('')}</div></section>
<p class="lead">Служебные фразы вроде «Мелкая подпись:» пока остались печатаемым содержанием. Исправлять это нужно в общем разборе материала и контракте группировки, не вручную в этих изображениях.</p></main></html>`
await writeFile(`${output}/index.html`, html)
const browser = await chromium.launch({ executablePath: process.env.MSP_BROWSER_PATH, headless: true })
const writes = [], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD'].includes(route.request().method())) return route.continue()
    writes.push({ method: route.request().method(), url: route.request().url() })
    return route.fulfill({ status: 409, json: { error: 'Read-only verification' } })
  })
  await page.goto(result.url)
  await page.locator('.ws-slide-open').first().waitFor({ timeout: 60000 })
  const count = await page.locator('.ws-slide-open').count()
  if (count !== slides.filter(s => s.previewRound !== undefined).length) throw Error(`Unexpected preview count: ${count}`)
  await page.screenshot({ path: `${output}/project-desktop.png`, fullPage: true, animations: 'disabled' })
  await page.locator('.ws-slide-open').nth(Math.min(2, count - 1)).click()
  await page.locator('.ws-slide-large img').waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('.ws-slide-large img'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth === 1920 })
  await page.screenshot({ path: `${output}/slide-viewer.png`, animations: 'disabled' })
  await page.getByRole('button', { name: 'Закрыть просмотр слайда' }).click()
  await page.reload(); await page.locator('.ws-slide-open').first().waitFor()
  const galleryUrl = `${origin}/${output}/index.html`
  await page.goto(galleryUrl)
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0))
  await page.screenshot({ path: `${output}/comparison-desktop.png`, fullPage: true, animations: 'disabled' })
  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  const unchanged = hash(before) === hash(await state())
  await writeFile(`${output}/ui-check.json`, JSON.stringify({ count, writes, errors, noHorizontalOverflow, unchanged, galleryUrl }, null, 2))
  console.log(JSON.stringify({ count, writes, errors, noHorizontalOverflow, unchanged, galleryUrl }))
  if (writes.length || errors.length || !unchanged || !noHorizontalOverflow) throw Error('Read-only UI verification failed')
} finally { await browser.close() }
