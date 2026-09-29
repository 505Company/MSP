import { build } from 'esbuild'
import { test, expect } from './workspace-fixture'
import { familyFixture } from '../../component-lab/family-fixtures'
import { layoutInput, layoutPlan } from '../fixtures/layout'
import { validateAdaptivePlan, validateAdaptiveFit, type AdaptivePlan } from '../../lib/presentations/adaptive-layout'
import { PREPARED_BOX_VERSION, type PreparedBoxes } from '../../lib/presentations/prepared-components'
import { PREPARATION_VERSION } from '../../lib/component-lab/preparation-jobs'

test('the generator measures badge, masked media and quotation fields with pinned fonts and source artwork', async ({ page }, info) => {
  await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const templates = (['badge', 'media', 'quote'] as const).map(familyFixture)
  const bundle = await build({ stdin: { contents: "export {sourceCandidate} from './lib/component-lab/source'; export {sourceFonts} from './browser/component-lab/fonts'; export {auditSourceFidelity} from './lib/component-lab/fidelity';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'PreparedFixtures', write: false })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const pins = await page.evaluate(async ({ templates, version }) => {
    const api = (window as unknown as { PreparedFixtures: typeof import('../../lib/component-lab/source') & typeof import('../../browser/component-lab/fonts') & typeof import('../../lib/component-lab/fidelity') }).PreparedFixtures
    const boxes: PreparedBoxes = {}
    for (const t of templates) {
      const candidate = await api.sourceCandidate(t, 'fixture'), profile = candidate.profile!, content = candidate.content!, resources = await api.sourceFonts('fixture', profile, true)
      boxes[t.id] = { version, inputHash: 'a'.repeat(64), ruleRevision: null, profile, rules: { states: {} }, faces: resources.faces!, assets: resources.artwork?.assets ?? [], proofHash: 'b'.repeat(64), fidelity: await api.auditSourceFidelity(t, profile, content), sourceContent: content }
    }
    return boxes
  }, { templates, version: PREPARATION_VERSION })
  for (const t of templates) {
    const pin = pins[t.id], content = pin.profile.fields.map((f, i) => ({ id: `field-${i}`, text: f.role === 'ordinal' ? '03' : f.role === 'author' ? 'Автор нового исследования' : f.role === 'title' ? 'Новый заголовок' : 'Другой материал сохраняет каждое слово и использует исходное оформление компонента.' }))
    const input = { ...layoutInput(), components: [t], preparedComponents: { [t.id]: pin }, content: [{ id: 'heading', text: 'Проверка нового содержания' }, ...content] }
    const plan: AdaptivePlan = { version: PREPARED_BOX_VERSION, title: ['heading'], footer: [], fontToken: 'font-1', colors: { ...layoutPlan().colors, onAccent: 'white' }, rationale: 'Synthetic renderer integration, no model response', blocks: [{ emphasis: 'plain', parts: [{ role: 'body', fragments: content.map(f => f.id), component: { id: t.id, fields: content.map((f, i) => ({ path: `slots.${i}`, fragments: [f.id] })) } }] }] }
    validateAdaptivePlan(plan, input, { fontTokens: ['font-1'] })
    const result = await page.evaluate(async ({ input, plan }) => {
      const f = '/browser/layout-fonts.ts', r = '/browser/adaptive-layout.ts', fonts = await (await import(f) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(input)
      return (await import(r) as typeof import('../../browser/adaptive-layout')).fitAdaptiveLayout(input, plan, 'c'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
    }, { input, plan })
    expect(result.fit.passed, JSON.stringify(result.fit.trials.at(-1)?.issues)).toBe(true)
    validateAdaptiveFit(result.fit, plan, input, 'c'.repeat(64), result.preview)
    await info.attach(`${t.id}.png`, { body: Buffer.from(result.preview.split(',')[1], 'base64'), contentType: 'image/png' })
    const forged = structuredClone(result.fit); forged.trials.at(-1)!.components![0].prepared!.constraints.background = '#000000'
    expect(() => validateAdaptiveFit(forged, plan, input, 'c'.repeat(64), result.preview)).toThrow()
    const oldPlan = { ...plan, version: 'adaptive-blocks-5' as const }
    expect(() => validateAdaptivePlan(oldPlan, input, { fontTokens: ['font-1'] })).toThrow()
  }
})

test('bare metrics, masked art, badges and quotes retain content in both axes and fail impossible boxes', async ({ page }) => {
  await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const bundle = await build({ stdin: { contents: "export {sourceCandidate} from './lib/component-lab/source'; export {sourceFonts} from './browser/component-lab/fonts'; export {measureComponent,pixelEvidence,renderCommittedComponent} from './browser/component-lab/measure';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Families', write: false })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const results = await page.evaluate(async templates => {
    const api = (window as unknown as { Families: typeof import('../../lib/component-lab/source') & typeof import('../../browser/component-lab/fonts') & typeof import('../../browser/component-lab/measure') }).Families
    const host = document.createElement('div'); document.body.appendChild(host)
    const result = []
    for (const t of templates) {
      const c = await api.sourceCandidate(t, 'fixture'), p = c.profile!, fonts = await api.sourceFonts('fixture', p, true)
      for (const box of [{ width: 900, maxHeight: 400 }, { width: 380, maxHeight: 900 }]) {
        const m = await api.measureComponent(p, c.content!, { ...box, widthMode: 'fill', heightMode: 'fill' }, fonts, { target: host })
        const pixel = m.status === 'fits' ? await api.pixelEvidence(host.firstElementChild as HTMLElement, m.chosen!, fonts) : undefined
        if (m.status === 'fits') await api.renderCommittedComponent(host, p, c.content!, m, fonts)
        result.push({ id: t.id, box, status: m.status, issues: m.issues, pixels: pixel?.passed, artwork: m.chosen?.artwork, sourceRatio: p.artwork ? p.artwork.width / p.artwork.height : null })
      }
      const content = { ...c.content, [p.fields.at(-1)!.id]: 'Длинный текст сохраняется полностью. '.repeat(100) }
      const impossible = await api.measureComponent(p, content, { width: 320, maxHeight: 100, widthMode: 'fill', heightMode: 'fill' }, fonts)
      result.push({ id: t.id, status: impossible.status, impossible: true })
    }
    host.remove(); return result
  }, (['bare', 'badge', 'media', 'quote'] as const).map(familyFixture))
  for (const r of results) {
    if ('impossible' in r) expect(r.status).toBe('needs-space')
    else { expect(r.status, JSON.stringify(r)).toBe('fits'); expect(r.pixels, JSON.stringify(r)).toBe(true); if (r.artwork) expect(r.artwork.box.width / r.artwork.box.height).toBeCloseTo(r.sourceRatio!, 3) }
  }
})
