/** Read-only rendering of a saved component, with a comparison to the former
 * clipped SVG image. Neither user rules nor application catalogues are written. */
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { sourceCandidate } from '../lib/component-lab/source'

const [input, output] = process.argv.slice(2)
if (!input || !output?.startsWith('outputs/')) throw Error('Usage: check-component-border.ts INPUT_JSON outputs/DIRECTORY')
const saved = JSON.parse(await readFile(input, 'utf8')), candidate = await sourceCandidate(saved.template, saved.catalogId)
if (!candidate.profile) throw Error(candidate.reason)
const bundle = await build({ stdin: { contents: "export {sourceFonts} from './browser/component-lab/fonts'; export {measureComponent,renderCommittedComponent} from './browser/component-lab/measure'; export {toPng} from 'html-to-image';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'BorderCheck', write: false })
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
await mkdir(output, { recursive: true })
try {
 const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
 await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.pathname === '/__component-border-check') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>' })
  if (request.method() !== 'GET' || url.origin !== 'http://127.0.0.1:5184' || !/^\/(fonts\/|api\/(fonts\/google|uploads\/[^/]+\/(fonts|assets\/)))/.test(url.pathname)) return route.abort('blockedbyclient')
  return route.continue()
 })
 await page.goto('http://127.0.0.1:5184/__component-border-check')
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const result = await page.evaluate(async ({ profile, content, upload }) => {
  const api = (window as unknown as { BorderCheck: typeof import('../browser/component-lab/fonts') & typeof import('../browser/component-lab/measure') & typeof import('html-to-image') }).BorderCheck
  const fonts = await api.sourceFonts(upload, profile, true), host = document.createElement('div'); document.body.appendChild(host)
  const measurement = await api.measureComponent(profile, content, { width: 600, maxHeight: 400, widthMode: 'fill', heightMode: 'fill', allowedStates: ['vertical'] }, fonts, { target: host })
  if (measurement.status !== 'fits') throw Error(JSON.stringify(measurement))
  await api.renderCommittedComponent(host, profile, content, measurement, fonts)
  const node = host.firstElementChild as HTMLElement, layer = node.querySelector<HTMLElement>('[aria-hidden="true"]')!
  const fixed = await api.toPng(node, { pixelRatio: 2, fontEmbedCSS: fonts.css })
  const { width, height, graphic } = profile.source
  const sized = graphic.replace('width="100%" height="100%"', `width="${width}" height="${height}"`)
  const svg = /<svg\b[^>]*\bxmlns=/.test(sized) ? sized : sized.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  layer.style.borderImageSource = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  const before = await api.toPng(node, { pixelRatio: 2, fontEmbedCSS: fonts.css })
  return { measurement, fixed, before }
 }, { profile: candidate.profile, content: candidate.content!, upload: saved.upload })
 for (const key of ['fixed', 'before'] as const) await writeFile(`${output}/${key}.png`, Buffer.from(result[key].split(',')[1], 'base64'))
 await writeFile(`${output}/measurement.json`, JSON.stringify(result.measurement, null, 2))
 console.log(JSON.stringify({ component: candidate.profile.id, status: result.measurement.status, width: result.measurement.chosen?.width, height: result.measurement.chosen?.height, modelRequests: 0, applicationWrites: 0 }))
} finally { await browser.close() }
