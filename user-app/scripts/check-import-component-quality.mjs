// Read-only audit of the real imported catalog. Never calls models or saves rules.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { build, stop } from 'esbuild'
import { chromium } from '@playwright/test'

const [upload, output = 'outputs/diagnostics/import-component-quality', source] = process.argv.slice(2)
if (!upload) throw Error('Usage: check-import-component-quality.mjs UPLOAD_ID [OUTPUT] [SOURCE_PPTX]')
const origin = 'http://127.0.0.1:5184', folder = resolve(output), hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
await mkdir(folder, { recursive: true })
const before = await (await fetch(`${origin}/api/uploads/${upload}/editable-system`)).json()
if (!before.catalog) throw Error('Catalog unavailable')
const bundle = await build({ stdin: { contents: `
export {sourceCandidate} from './lib/component-lab/source';
export {resolveComponentFonts} from './browser/component-lab/fonts';
export {checkQuality} from './browser/component-lab/qualification';
export {measureComponent} from './browser/component-lab/measure';
export {sampleContent} from './lib/component-lab/cases';
export {ensureUploadFonts} from './browser/fonts';
export {qualifyEditableCatalog} from './lib/design-system/editable-qualification';
export {readPresentation} from './browser/presentation-source';
`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', globalName: 'QualityAudit', write: false })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = [], blocked = [], checks = []
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue()
    blocked.push(route.request().url()); return route.abort()
  })
  await page.goto(`${origin}/api/uploads/${upload}/fonts`)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  if (source) {
    await page.route('**/__quality_source', route => route.fulfill({ contentType: 'application/octet-stream', path: resolve(source) }))
    const imported = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/__quality_source')).arrayBuffer())
      const { snapshot, assets, previews } = await window.QualityAudit.readPresentation(bytes, 'Source comparison.pptx')
      const resources = await Promise.all(assets.map(async a => ({ id: a.id, bytes: a.bytes.length, origins: a.origins,
        sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', a.bytes))].map(n => n.toString(16).padStart(2, '0')).join('') })))
      return { snapshot, resources, previews }
    })
    await writeFile(`${folder}/fresh-snapshot.json`, JSON.stringify(imported.snapshot))
    await writeFile(`${folder}/fresh-resources.json`, JSON.stringify(imported.resources, null, 2))
    for (const p of imported.previews) await writeFile(`${folder}/import-${p.id}.jpg`, Buffer.from(p.dataUrl.split(',')[1], 'base64'))
    console.log(JSON.stringify({ freshSlides: imported.snapshot.slideCount, previews: imported.previews.length, objects: imported.snapshot.elements.length, sourceId: imported.snapshot.sourceId,
      incomplete: imported.snapshot.slides.filter(s => s.warnings.some(w => /normalized-page-unavailable|preview-unavailable/.test(w))).map(s => s.number) }))
  }
  const initial = await page.evaluate(async ({ catalog, upload }) => {
    const api = window.QualityAudit
    document.body.replaceChildren(); document.body.style.margin = '0'
    const fontWarnings = await api.ensureUploadFonts(upload)
    const qualification = await api.qualifyEditableCatalog(catalog)
    const candidates = await Promise.all(catalog.families.flatMap(f => f.variants).map(t => api.sourceCandidate(t, catalog.id)))
    window.auditCandidates = candidates.filter(c => c.profile)
    return { fontWarnings, qualification, candidates: candidates.map(c => ({ id: c.template.id, name: c.template.name, family: c.profile?.family, reason: c.reason })) }
  }, { catalog: before.catalog, upload })
  await writeFile(`${folder}/html-qualification.json`, JSON.stringify(initial.qualification, null, 2))
  await writeFile(`${folder}/candidates.json`, JSON.stringify(initial.candidates, null, 2))
  const count = initial.candidates.filter(c => c.family).length
  for (let i = 0; i < count; i++) {
    const result = await page.evaluate(async ({ i, upload }) => {
      const api = window.QualityAudit, candidate = window.auditCandidates[i]
      const resolved = await api.resolveComponentFonts(upload, candidate.profile, { states: {} })
      const report = await api.checkQuality(resolved.profile, resolved.fonts)
      const original = await api.measureComponent(resolved.profile, candidate.content, { width: 800, maxHeight: 1000, widthMode: 'fill', heightMode: 'hug' }, resolved.fonts)
      window.auditCurrent = { ...resolved, candidate }
      return { id: candidate.template.id, profile: resolved.profile, fonts: resolved.fonts.faces, report, original }
    }, { i, upload })
    await writeFile(`${folder}/${result.id}.json`, JSON.stringify(result, null, 2))
    const summary = { id: result.id, technical: result.report.technical, coverage: result.report.coverage, original: result.original.status,
      failures: result.report.cases.filter(c => c.assertion === false || c.evidence && !c.evidence.passed).map(c => ({ id: c.id, status: c.measurement.status, issues: c.measurement.issues, pixels: c.evidence?.pixels })) }
    checks.push(summary); console.log(JSON.stringify(summary))
    if (i === 0 || i === 4) for (const [name, width, height] of [['portrait', 320, 900], ['square', 560, 560], ['landscape', 800, 400]]) {
      await page.evaluate(async ({ width, height }) => {
        const api = window.QualityAudit, { profile, fonts } = window.auditCurrent
        document.body.replaceChildren()
        const target = document.createElement('div'); target.id = 'preview'; target.style.width = `${width}px`; document.body.appendChild(target)
        const measured = await api.measureComponent(profile, api.sampleContent(profile, 'medium'), { width, maxHeight: height, widthMode: 'fill', heightMode: 'fill' }, fonts, { target })
        if (measured.status !== 'fits') target.textContent = measured.status
      }, { width, height })
      await page.locator('#preview').screenshot({ path: `${folder}/${result.id}-${name}.png` })
    }
  }
  const after = await (await fetch(`${origin}/api/uploads/${upload}/editable-system`)).json()
  const summary = { upload, catalogId: before.catalog.id, variants: initial.candidates.length,
    html: { passed: initial.qualification.checks.filter(c => c.passed).length, failed: initial.qualification.checks.filter(c => !c.passed) },
    fontWarnings: initial.fontWarnings, adaptive: checks, unchangedCatalog: hash(before.catalog) === hash(after.catalog), errors, blocked }
  await writeFile(`${folder}/summary.json`, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ variants: summary.variants, htmlPassed: summary.html.passed, adaptive: checks.length, passed: checks.filter(c => c.technical === 'passed').length, unchangedCatalog: summary.unchangedCatalog, errors, blocked }))
  if (!summary.unchangedCatalog || errors.length || blocked.length) process.exitCode = 1
} finally { await browser.close(); stop() }
