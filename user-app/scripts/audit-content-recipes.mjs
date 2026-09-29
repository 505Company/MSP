import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const name = process.argv[2]
if (!name || !/^[a-z0-9-]{1,60}$/u.test(name)) throw Error('Expected saved run name')
const root = `outputs/diagnostics/content-recipes/${name}`, origin = 'http://127.0.0.1:5184'
const report = JSON.parse(await readFile(`${root}/report.json`, 'utf8'))
const paths = [`${root}/report.json`, 'outputs/diagnostics/free-flex-thinking-3/run-1/source.json', 'outputs/diagnostics/qwen-pixel-service/source.json', 'outputs/diagnostics/qwen-pixel-service/experiment.json']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const hashes = async () => Promise.all(paths.map(async p => hash(await readFile(p))))
const before = await hashes(), errors = [], blocked = [], links = [], viewports = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(r.method()) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    blocked.push(`${r.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await page.goto(`${origin}/${root}/index.html`)
  await page.waitForFunction(() => document.images.length === 6 && [...document.images].every(i => i.complete && i.naturalWidth === 1920 && i.naturalHeight === 1080))
  for (const url of [...new Set(await page.locator('a').evaluateAll(nodes => nodes.map(n => n.href)))]) {
    if (new URL(url).origin !== origin) throw Error('Unexpected external link')
    const response = await page.request.get(url)
    links.push({ url, status: response.status() })
    if (!response.ok()) throw Error(`Broken report link: ${url}`)
  }
  for (const width of [1680, 800]) {
    await page.setViewportSize({ width, height: 1100 })
    viewports.push({ width, noOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) })
  }
  const artifacts = await Promise.all(report.results.map(async r => {
    const result = JSON.parse(await readFile(`${root}/slide-${r.slide}/result.json`, 'utf8'))
    return { slide: r.slide, pngHash: hash(await readFile(`${root}/${r.png}`)), planHash: result.trials.at(-1).planHash }
  }))
  const unchanged = JSON.stringify(before) === JSON.stringify(await hashes())
  const audit = { errors, blocked, links, viewports, artifacts, unchanged, modelCalls: 0 }
  await writeFile(`${root}/browser-audit.json`, JSON.stringify(audit, null, 2))
  console.log(JSON.stringify({ ...audit, links: links.length }))
  if (errors.length || blocked.length || !unchanged || viewports.some(v => !v.noOverflow)) process.exitCode = 1
} finally { await browser.close() }
