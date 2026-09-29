/** Read-only reproduction of a saved import. Never calls Qwen or writes the app store. */
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { applicationSnapshot, saveJson } from './pixel-pilot-store'

const upload = process.argv[2], output = process.argv[3]
if (!/^[a-f0-9-]{36}$/.test(upload ?? '') || !output?.startsWith('outputs/')) throw Error('Usage: audit-incomplete-import.ts UPLOAD outputs/DIRECTORY')
const saved = applicationSnapshot(), manifest = await saved.read(`visual/${upload}/manifest.json`)
const source = saved.rows.find(r => r.key.startsWith('sources/') && r.key.endsWith(`/${upload}.pptx`))
if (!manifest || !source) throw Error('No saved PPTX and manifest')
const response = await fetch(`http://127.0.0.1:5184/api/uploads/${upload}/source`)
if (!response.ok) throw Error(`Source HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const bundle = await build({ stdin: { contents: `export { PptxCatalogReader } from './vendor/drag/src/formats/pptx/catalog'; export { readSlide } from './vendor/drag/src/formats/pptx/scene';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'ReaderAudit', plugins: [{ name: 'asset-budget-observer', setup(b) {
 b.onLoad({ filter: /\/pptx\/scene\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path, 'utf8'))
  .replaceAll('assetBytes += bytes.length;', 'assetBytes += bytes.length; console.info("ASSET_BUDGET", descriptor.sourceIndex + 1, "source", rel.target, bytes.length, assetBytes);')
  .replaceAll('assetBytes+=bytes.length;', 'assetBytes+=bytes.length;console.info("ASSET_BUDGET",descriptor.sourceIndex+1,"mask",wrapper.name,bytes.length,assetBytes);')
  .replaceAll('assetBytes+=rendered.bytes.length;', 'assetBytes+=rendered.bytes.length;console.info("ASSET_BUDGET",descriptor.sourceIndex+1,"appearance",wrapper.name,rendered.bytes.length,assetBytes);') }))
} }] })
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
 const page = await browser.newPage(), trace: string[] = []
 await page.route('**/*', route => route.abort('blockedbyclient'))
 page.on('console', m => { if (m.text().startsWith('ASSET_BUDGET')) trace.push(m.text()) })
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const numbers = manifest.snapshot.slides.filter((s: { warnings: string[] }) => s.warnings.some(w => w.startsWith('normalized-page-unavailable'))).map((s: { number: number }) => s.number)
 const results = await page.evaluate(async ({ base64, numbers }) => {
  const api = (window as unknown as { ReaderAudit: typeof import('../vendor/drag/src/formats/pptx/catalog') & typeof import('../vendor/drag/src/formats/pptx/scene') }).ReaderAudit
  const reader = new api.PptxCatalogReader(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), new DOMParser()), pages = reader.analyze().pages
  const results = []
  for (const number of numbers) {
   try { const result = await api.readSlide(reader, pages[number - 1]); results.push({ slide: number, complete: true, elements: result.elements.length, assets: result.assets?.length, assetBytes: result.assets?.reduce((n, a) => n + a.bytes.length, 0), warnings: result.degradations }) }
   catch (error) { results.push({ slide: number, complete: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  return results
 }, { base64: bytes.toString('base64'), numbers })
 await saveJson(`${output}/reader.json`, results); await writeFile(`${output}/asset-budget.log`, trace.join('\n'))
 console.log(JSON.stringify(results, null, 2))
 if (results.some(r => !r.complete)) process.exitCode = 1
} finally { await browser.close() }
