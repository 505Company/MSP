import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const name = process.argv[2] ?? 'run-1'
if (!/^[a-z0-9-]{1,60}$/u.test(name)) throw Error('Invalid run name')
const root = `outputs/diagnostics/free-flex-thinking-3/${name}`, origin = 'http://127.0.0.1:5184'
const result = JSON.parse(await readFile(`${root}/result.json`, 'utf8'))
if (result.prepareOnly) throw Error('The live comparison has not completed')
const protectedFiles = [`${root}/result.json`, `${root}/source.json`, 'outputs/diagnostics/qwen-pixel-service/source.json', 'outputs/diagnostics/qwen-pixel-service/experiment.json']
const hashes = async () => Promise.all(protectedFiles.map(async p => createHash('sha256').update(await readFile(p)).digest('hex')))
const before = await hashes(), errors = [], blocked = [], links = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(r.method()) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    blocked.push(`${r.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await page.goto(`${origin}/${root}/index.html`)
  await page.locator('img').evaluateAll(images => images.forEach(i => i.loading = 'eager'))
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth === 1920 && i.naturalHeight === 1080))
  for (const url of [...new Set(await page.locator('a').evaluateAll(nodes => nodes.map(n => n.href)))]) {
    if (new URL(url).origin !== origin) throw Error('Unexpected external gallery link')
    const response = await page.request.get(url); links.push({ url, status: response.status() })
    if (!response.ok()) throw Error(`Broken local report link: ${url}`)
  }
  const images = await page.locator('img').evaluateAll(nodes => nodes.map(i => ({ src: i.getAttribute('src'), width: i.naturalWidth, height: i.naturalHeight })))
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await page.screenshot({ path: `${root}/gallery-desktop.png`, fullPage: true, animations: 'disabled' })
  const unchanged = JSON.stringify(before) === JSON.stringify(await hashes())
  await writeFile(`${root}/browser-audit.json`, JSON.stringify({ errors, blocked, links, images, noOverflow, unchanged, modelCalls: 0 }, null, 2))
  console.log(JSON.stringify({ errors, blocked, links: links.length, images: images.length, noOverflow, unchanged, modelCalls: 0 }))
  if (errors.length || blocked.length || !noOverflow || !unchanged) process.exitCode = 1
} finally { await browser.close() }
