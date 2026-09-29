import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = 'outputs/diagnostics/qwen-fast-comparison', origin = 'http://127.0.0.1:5184'
const protectedFiles = [`${root}/comparison.json`, 'outputs/diagnostics/qwen-pixel-service/source.json', 'outputs/diagnostics/qwen-pixel-service/experiment.json']
const hashes = async () => Promise.all(protectedFiles.map(async p => createHash('sha256').update(await readFile(p)).digest('hex')))
const before = await hashes(), errors = [], blocked = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await page.goto(`${origin}/${root}/index.html`)
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth === 1920 && i.naturalHeight === 1080))
  const links = await page.locator('a').evaluateAll(nodes => nodes.map(n => n.href))
  const checked = []
  for (const url of [...new Set(links)]) {
    const response = await page.request.get(url)
    checked.push({ url, status: response.status() })
    if (!response.ok()) throw Error(`Broken comparison link: ${url}`)
  }
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  await page.screenshot({ path: `${root}/comparison-desktop.png`, fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 1000 })
  const narrowNoOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  const unchanged = JSON.stringify(before) === JSON.stringify(await hashes())
  await writeFile(`${root}/browser-audit.json`, JSON.stringify({ errors, blocked, links: checked, noOverflow, narrowNoOverflow, unchanged, modelCalls: 0 }, null, 2))
  console.log(JSON.stringify({ errors, blocked, noOverflow, narrowNoOverflow, unchanged, links: checked.length, modelCalls: 0 }))
  if (!unchanged || errors.length || blocked.length || !noOverflow || !narrowNoOverflow) process.exitCode = 1
} finally { await browser.close() }
