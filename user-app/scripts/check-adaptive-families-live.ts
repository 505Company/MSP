/** Read-only visual comparison of actual imported components. Output is a
 * diagnostic artifact, never a replacement catalog, rule or generated deck. */
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { saveJson } from './pixel-pilot-store'
import { readSourceScene } from '../lib/design-system/source-scene'
import type { SourceCandidate } from '../lib/component-lab/source'
import type { PreparedComponent } from '../lib/component-lab/preparation-jobs'
import type { VisualManifest } from '../lib/digital-designer/visual-package'

const [upload, output, ...ids] = process.argv.slice(2)
if (!/^[a-f\d-]{36}$/.test(upload ?? '') || !output || !ids.length) throw Error('Usage: check-adaptive-families-live.ts UPLOAD OUTPUT COMPONENT...')
const origin = 'http://127.0.0.1:5184', errors: string[] = []
const candidates = (await (await fetch(`${origin}/api/uploads/${upload}/component-profiles?candidates=1`)).json() as { candidates: SourceCandidate[] }).candidates
const manifest = JSON.parse(await readFile('outputs/diagnostics/vk-education-import/manifest.json', 'utf8')) as VisualManifest
const scene = readSourceScene(manifest.snapshot)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const rows: { id: string; name: string; source: string; replacements: unknown; admission: boolean; variants: { name: string; image?: string; status: string; state?: string; issues: string[]; pixels?: boolean }[] }[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await page.goto(`${origin}/processing-worker`)
  for (const id of ids) {
    const candidate = candidates.find(c => c.template.id === id)
    const ready = (await (await fetch(`${origin}/api/uploads/${upload}/component-preparation?component=${encodeURIComponent(id)}`)).json() as { prepared?: PreparedComponent }).prepared
    if (!candidate?.profile || !ready) throw Error(`No prepared component: ${id}`)
    const t = candidate.template, records = t.sourceIds.flatMap(id => scene.records.get(id) ?? []), slide = manifest.snapshot.slides.find(s => s.number === t.slide)!
    const x = Math.max(0, Math.min(...records.map(r => r.bounds.x)) - 20), y = Math.max(0, Math.min(...records.map(r => r.bounds.y)) - 20)
    const crop = { x, y, width: Math.min(slide.width - x, Math.max(...records.map(r => r.bounds.x + r.bounds.width)) - x + 20), height: Math.min(slide.height - y, Math.max(...records.map(r => r.bounds.y + r.bounds.height)) - y + 20) }
    const source = await page.evaluate(async ({ upload, slide, crop }) => {
      const image = new Image(); image.src = `/api/uploads/${upload}/assets/preview-${slide.id}`; await image.decode()
      const sx = image.naturalWidth / slide.width, sy = image.naturalHeight / slide.height, canvas = document.createElement('canvas')
      canvas.width = Math.ceil(crop.width); canvas.height = Math.ceil(crop.height)
      canvas.getContext('2d')!.drawImage(image, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    }, { upload, slide, crop })
    const row: typeof rows[number] = { id, name: t.name, source: `${id}-source.png`, replacements: ready.profile.fontReplacements ?? [], admission: ready.generationAdmission, variants: [] }
    await writeFile(`${output}/${row.source}`, Buffer.from(source.split(',')[1], 'base64'))
    for (const variant of [
      { name: 'Исходный текст · вертикально', key: 'vertical', width: 420, maxHeight: 850, state: 'vertical' as const },
      { name: 'Исходный текст · горизонтально', key: 'horizontal', width: 1000, maxHeight: 600, state: ready.profile.states.includes('horizontal') ? 'horizontal' as const : 'vertical' as const },
      { name: 'Новый проверочный текст', key: 'new', width: 900, maxHeight: 500, state: undefined },
    ]) {
      const result = await page.evaluate(async ({ ready, upload, variant }) => {
        const fontsPath = '/browser/component-lab/fonts.ts', measurePath = '/browser/component-lab/measure.ts'
        const resources = await (await import(fontsPath) as typeof import('../browser/component-lab/fonts')).sourceFonts(upload, ready.profile, true)
        const { measureComponent, pixelEvidence } = await import(measurePath) as typeof import('../browser/component-lab/measure')
        document.querySelector('#family-proof')?.remove(); const host = document.createElement('div'); host.id = 'family-proof'; host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;background:white'; document.body.appendChild(host)
        const example = { number: '3,7 млн', ordinal: '02', title: 'Новый взгляд на задачу', body: 'Команда сравнивает результаты и выбирает решение, которое сохраняет смысл и помогает следующему этапу работы.', caption: 'Новых обращений обработано за год', quote: 'Хорошее решение начинается с точного вопроса. Мы проверяем предположения и сохраняем то, что подтверждается на практике.', author: 'Алексей Петров, исследователь' }
        const content = variant.key === 'new' ? Object.fromEntries(ready.profile.fields.map(f => [f.id, example[f.role]])) : ready.source.content
        const measurement = await measureComponent(ready.profile, content, { width: variant.width, maxHeight: variant.maxHeight, widthMode: 'fill', heightMode: 'hug', ...(variant.state ? { allowedStates: [variant.state] } : {}) }, resources, { target: host })
        const pixels = measurement.status === 'fits' ? await pixelEvidence(host.firstElementChild as HTMLElement, measurement.chosen!, resources) : undefined
        return { status: measurement.status, state: measurement.chosen?.state, issues: measurement.issues, pixels: pixels?.passed, measurement, preview: pixels?.preview }
      }, { ready, upload, variant })
      const image = result.status === 'fits' ? `${id}-${variant.key}.png` : undefined
      if (image) await writeFile(`${output}/${image}`, Buffer.from(result.preview!.split(',')[1], 'base64'))
      const { preview: _preview, ...measurement } = result; void _preview
      await saveJson(`${output}/${id}-${variant.key}.json`, measurement)
      row.variants.push({ name: variant.name, image, status: result.status, state: result.state, issues: result.issues, pixels: result.pixels })
    }
    rows.push(row); console.log(JSON.stringify({ id, admission: row.admission, variants: row.variants.map(v => ({ status: v.status, pixels: v.pixels })) }))
  }
} finally { await browser.close() }
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
await saveJson(`${output}/visual-review.json`, { upload, modelRequests: 0, mutationRequests: 0, errors, rows })
await writeFile(`${output}/index.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><title>MSP · Адаптивные семейства</title><style>body{background:#f5f6fa;color:#20304b;font:16px/1.5 system-ui;margin:32px}h1{font-size:30px}h2{margin-top:40px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}article{background:white;border:1px solid #dde1ea;padding:14px;border-radius:10px}img{width:100%;height:auto}p{max-width:1100px}.note{font-size:13px;color:#69758a}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}}</style><h1>Исходный компонент и его адаптивные состояния</h1><p>Слева — область исходного слайда из сохранённого превью импорта. Далее — общий HTML/CSS-движок на исходном и новом проверочном тексте. Ни компоненты, ни ручные правила библиотеки не изменены. Запросов к модели: 0.</p>${rows.map(r => `<h2>${esc(r.name)} · ${esc(r.id)}</h2><p class="note">Допуск в новые презентации: ${r.admission ? 'да' : 'нет'} · Замены шрифтов: ${esc(JSON.stringify(r.replacements))}</p><div class="grid"><article><b>Исходник</b><img src="${r.source}" alt="Исходная область"></article>${r.variants.map(v => `<article><b>${esc(v.name)}</b><p class="note">${esc(v.status)} · ${esc(v.state ?? '')}</p>${v.image ? `<img src="${v.image}" alt="Адаптация">` : `<p>Недостаточно места в выбранной форме. Текст сохранён.</p><p class="note">${esc(v.issues.join(', '))}</p>`}</article>`).join('')}</div>`).join('')}</html>`)
if (errors.length) throw Error(errors.join('\n'))
