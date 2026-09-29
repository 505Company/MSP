import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { digest, inventory, loadJson, saveJson } from './pixel-pilot-store'

const output = 'outputs/diagnostics/qwen-pixel-service', origin = 'http://127.0.0.1:5184'
const evidence = async (path: string): Promise<{ path: string; hash: string }[]> => {
  const files: { path: string; hash: string }[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = `${path}/${entry.name}`
    if (entry.isDirectory()) files.push(...await evidence(next))
    else if (/\.(json|png)$/.test(entry.name) && !entry.name.startsWith('audit-')) files.push({ path: next, hash: createHash('sha256').update(await readFile(next)).digest('hex') })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
const before = await evidence(output), beforeApp = digest(inventory().filter(r => !/^(fonts|processing-worker)\//.test(r.key)))
for (const args of [['scripts/run-pixel-pilot.ts', '--audit-only'], ['scripts/make-pixel-documents.ts']]) {
  const command = spawnSync(process.execPath, ['--import', 'tsx', ...args], { encoding: 'utf8' })
  if (command.status !== 0) throw Error(command.stderr || command.stdout || 'Audit generation failed')
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const blocked: string[] = [], errors: string[] = [], viewports: unknown[] = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 })
    const response = await page.goto(`${origin}/${output}/index.html`)
    if (response?.status() !== 200) throw Error(`Gallery unavailable: ${response?.status()}`)
    await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth === 1920))
    const summary = await page.evaluate(() => ({ width: innerWidth, images: document.images.length, primary: document.images[0]?.getAttribute('src'), noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth, rejectedNotice: document.body.textContent?.includes('черновик, не принят') }))
    if (!summary.images || !summary.noHorizontalOverflow || !summary.rejectedNotice) throw Error(JSON.stringify(summary))
    await page.screenshot({ path: `${output}/audit-desktop-${width}.png`, animations: 'disabled' })
    for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')!))) {
      const target = resolve(output, href)
      if (!target.startsWith(`${resolve(output)}/`) || !(await stat(target)).isFile()) throw Error(`Invalid document link: ${href}`)
    }
    await page.locator('details').evaluateAll(nodes => nodes.forEach(n => n.setAttribute('open', '')))
    const expandedFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    if (!expandedFits) throw Error('Expanded history overflows the viewport')
    viewports.push({ ...summary, expandedFits })
  }
  const documents = await readFile(`${output}/DOCUMENTS.md`, 'utf8')
  for (const [, href] of documents.matchAll(/\]\(([^)]+)\)/g)) if (!(await stat(resolve(output, href))).isFile()) throw Error(`Missing document: ${href}`)
  const unchanged = digest(before) === digest(await evidence(output))
  const applicationUnchanged = beforeApp === digest(inventory().filter(r => !/^(fonts|processing-worker)\//.test(r.key)))
  const manifest = await loadJson(`${output}/experiment.json`)
  const report = { modelCalls: 0, used: manifest.used, limit: manifest.maxRequests, unchanged, evidenceFiles: before.length, applicationUnchanged, blocked, errors, viewports }
  await saveJson(`${output}/audit-verification.json`, report)
  console.log(JSON.stringify(report))
  if (!unchanged || !applicationUnchanged || blocked.length || errors.length) throw Error('Read-only audit verification failed')
} finally { await browser.close() }
