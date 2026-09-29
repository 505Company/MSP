import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { digest, saveJson } from './pixel-pilot-store'

const name = process.argv[2]
if (!name || !/^[a-z0-9-]+$/u.test(name)) throw Error('Run name required')
const dir = `outputs/diagnostics/content-recipes/${name}`, report = JSON.parse(await readFile(`${dir}/report.json`, 'utf8'))
const origin = 'http://127.0.0.1:5184', path = `/outputs/diagnostics/content-recipes/${name}`
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors: string[] = [], missing: string[] = [], receipts: Record<string, unknown>[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    return url.origin === origin && ['GET', 'HEAD'].includes(req.method()) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await page.goto(`${origin}${path}/index.html`)
  const links = await page.locator('a').evaluateAll(nodes => nodes.map(a => (a as HTMLAnchorElement).href))
  for (const href of [...new Set(links)].filter(h => h.startsWith(origin))) if (!(await page.request.get(href)).ok()) missing.push(href)
  for (const width of [1600, 800]) {
    await page.setViewportSize({ width, height: 1000 })
    receipts.push({ width, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) })
  }
  const items = report.results.filter((r: { png: string }) => r.png)
  for (let i = 0; i < items.length; i += 12) {
    const chunk = items.slice(i, i + 12), html = `<html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#eee;font:18px system-ui}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}figure{margin:0;background:white}img{width:100%;display:block}figcaption{padding:8px}</style><div class="grid">${chunk.map((r: { png: string; family: string; frame: string }) => `<figure><img src="${origin}${path}/${r.png}"><figcaption>${r.family} · ${r.frame}</figcaption></figure>`).join('')}</div></html>`
    await page.setViewportSize({ width: 1920, height: 1080 }); await page.setContent(html)
    await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => (i as HTMLImageElement).decode())))
    await page.screenshot({ path: `${dir}/contact-${i / 12 + 1}.png`, fullPage: true })
  }
} finally { await browser.close() }
for (const r of report.results.filter((r: { png: string }) => r.png)) receipts.push({ frame: r.frame, pngHash: digest(await readFile(`${dir}/${r.png}`)) })
await saveJson(`${dir}/gallery-audit.json`, { errors, missing, receipts, reviewedVisually: false })
await writeFile(`${dir}/coverage.md`, `# Полный каталог Figma\n\n24 семейства, 34 состояния. 29:210 — wireframe 6:98. Все привязки здесь локальные, модель не вызывалась.\n\n| Семейство | Figma | Проверка |\n|---|---|---|\n${report.results.map((r: { family: string; frame: string; passed: boolean }) => `| ${r.family} | ${r.frame} | ${r.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n`)
console.log(JSON.stringify({ dir, errors, missing, galleryChecks: receipts.slice(0, 2) }))
if (errors.length || missing.length || receipts.some(r => r.horizontalOverflow)) process.exitCode = 1
