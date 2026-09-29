import type { ComponentDefinition } from '../lib/design-system/types'
import type { ElementIR } from '../vendor/drag/src/core/model'
import { renderSlidePreview, measureTextBox } from '../vendor/drag/src/formats/pptx/preview'
import { renderComponent } from './component-execution'
import { ensureSceneFonts } from './fonts'
import { compileDeckScene, geometryIssues, resourceSupported } from '../lib/presentations/deck-compiler'
import { DECK_RENDERER, supportsRecipeRole, type BoundScene, type DeckEvidence, type DeckIssue, type RenderedDeckSlide, type SceneInput, type TextMeasurement } from '../lib/presentations/deck-contract'

type Assets = Array<{ id: string; bytes: Uint8Array }>
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Не удалось прочитать изображение')); image.src = src })
export async function prepareDeckEvidence(resources: ComponentDefinition[], families: string[], assets: Assets): Promise<DeckEvidence> {
  const fonts: string[] = []
  for (const family of families) {
    const faces = ['Regular', 'Bold'].map(style => ({ kind: 'text', visible: true, text: 'Текст', fontFamily: family, fontStyle: style })) as ElementIR[]
    if (!(await ensureSceneFonts(faces)).length) fonts.push(family)
  }
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = Math.max(1, Math.ceil(resources.length / 4)) * 200
  const ctx = canvas.getContext('2d')!, resourceIds: string[] = []
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const [index, c] of resources.entries()) {
    if (!resourceSupported(c)) continue
    try {
      const result = await renderComponent(c, {}, assets)
      if (!result.fits || !result.dataUrl) continue
      const img = await loadImage(result.dataUrl), x = index % 4 * 300, y = Math.floor(index / 4) * 200
      const scale = Math.min(280 / img.width, 160 / img.height)
      ctx.drawImage(img, x + (300 - img.width * scale) / 2, y + 32 + (160 - img.height * scale) / 2, img.width * scale, img.height * scale)
      ctx.fillStyle = '#111'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(`resource-${index + 1}`, x + 10, y + 24)
      resourceIds.push(c.id)
    } catch { /* Unrenderable resources are excluded before any paid selection. */ }
  }
  const sheet = resourceIds.length ? canvas.toDataURL('image/png') : null
  canvas.width = canvas.height = 0
  return { renderer: DECK_RENDERER, fonts, resourceIds, sheet }
}
function luminance(values: number[]) {
  const v = values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 })
  return v[0] * .2126 + v[1] * .7152 + v[2] * .0722
}
async function contrastIssues(component: ComponentDefinition, texts: TextMeasurement[], assets: Assets, scene: BoundScene, input: SceneInput): Promise<DeckIssue[]> {
  const background = { ...component.scene, schemaVersion: 1 as const, id: component.id, sourceIndex: 0, assets, degradations: [], elements: component.scene.elements.filter(e => e.kind !== 'text') }
  const image = await loadImage(await renderSlidePreview(background, 1024)), canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, scale = image.width / component.scene.width, issues: DeckIssue[] = []
  for (const e of component.scene.elements) {
    if (e.kind !== 'text') continue
    const fill = e.colorRuns?.[0]?.fill.color; if (!fill) continue
    const m = texts.find(t => t.id === e.id)!, b = e.bounds
    let lowest = Infinity
    // Conservative sampling across the full occupied text region, including
    // gradient/asset backgrounds, not just a declared background token.
    for (let row = 0; row <= 8; row++) for (let col = 0; col <= 12; col++) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((b.x + col / 12 * Math.min(m.width, b.width)) * scale)))
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((b.y + row / 8 * m.height) * scale)))
      const p = (y * canvas.width + x) * 4, bg = [pixels[p], pixels[p+1], pixels[p+2]], alpha = e.opacity * fill.a
      const fg = [fill.r, fill.g, fill.b].map((v, i) => v * 255 * alpha + bg[i] * (1 - alpha)), a = luminance(bg), c = luminance(fg)
      lowest = Math.min(lowest, (Math.max(a, c) + .05) / (Math.min(a, c) + .05))
    }
    if (lowest < 3) issues.push({ code: 'text-contrast', elementId: e.id, message: `${e.id}: контраст ${lowest.toFixed(2)}:1; требуется не менее 3:1 по всей области текста. Выбери другие цвета из палитры.` })
  }
  // A successfully decoded white illustration on a white background is still
  // invisible. Verify actual compositing, not merely the presence of an asset ID.
  for (const e of component.scene.elements.filter(e => e.kind === 'group' && e.id !== 'slide-background')) {
    const without = await loadImage(await renderSlidePreview({ ...background, elements: background.elements.filter(n => n.id !== e.id) }, 1024))
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(without, 0, 0)
    const under = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let samples = 0, visible = 0
    const b = e.bounds, left = Math.max(0, Math.floor(b.x * scale)), right = Math.min(canvas.width, Math.ceil((b.x + b.width) * scale))
    const top = Math.max(0, Math.floor(b.y * scale)), bottom = Math.min(canvas.height, Math.ceil((b.y + b.height) * scale))
    for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
      const p = (y * canvas.width + x) * 4; samples++
      if (Math.max(Math.abs(pixels[p]-under[p]), Math.abs(pixels[p+1]-under[p+1]), Math.abs(pixels[p+2]-under[p+2])) > 12) visible++
    }
    if (!samples || visible / samples < .005) {
      const role = input.variant.recipe.elements.find(n => n.id === e.id)?.resourceRole, current = scene.resources.find(r => r.role === role)
      const roles = input.brand.resources.find(r => r.id === current?.componentId)?.roles ?? [], alternatives: string[] = []
      for (const candidate of input.resources) {
        const meta = input.brand.resources.find(r => r.id === candidate.id)
        if (!meta || !supportsRecipeRole(meta, 'art') || !meta.roles.some(r => roles.includes(r)) || candidate.id === current?.componentId) continue
        try {
          const replacement = compileDeckScene({ ...scene, resources: scene.resources.map(r => r.role === role ? { ...r, componentId: candidate.id } : r) }, input, texts)
          const image = await loadImage(await renderSlidePreview({ ...background, elements: replacement.scene.elements.filter(n => n.kind !== 'text') }, 1024))
          ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0)
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let changed = 0
          for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
            const p = (y * canvas.width + x) * 4
            if (Math.max(Math.abs(pixels[p]-under[p]), Math.abs(pixels[p+1]-under[p+1]), Math.abs(pixels[p+2]-under[p+2])) > 12) changed++
          }
          if (changed / Math.max(1, samples) >= .005) alternatives.push(candidate.id)
        } catch { /* No compatibility claim for a resource that cannot render. */ }
      }
      issues.push({ code: 'graphic-invisible', elementId: e.id, alternatives, message: `${e.id}: выбранная графика сливается с фоном, видимо ${(100 * visible / Math.max(1, samples)).toFixed(1)}% области. ${alternatives.length ? `Браузер проверил замену в той же области и на том же фоне. Выбери подходящий ресурс ТОЛЬКО из alternatives: ${alternatives.join(', ')}.` : 'Выбери другой совместимый фон.'} Не удаляй обязательную иллюстрацию.` })
    }
  }
  canvas.width = canvas.height = 0; return issues
}
export async function renderDeckSlide(scene: BoundScene, input: SceneInput, sceneHash: string, assets: Assets): Promise<RenderedDeckSlide> {
  let component = compileDeckScene(scene, input)
  const fontIssues = await ensureSceneFonts(component.scene.elements), texts: TextMeasurement[] = []
  for (const e of component.scene.elements) if (e.kind === 'text') {
    const m = await measureTextBox(e, e.paragraphs![0])
    texts.push({ id: e.id, x: e.bounds.x, y: e.bounds.y, width: m.width, height: m.height, lines: m.lines! })
  }
  component = compileDeckScene(scene, input, texts)
  for (const t of texts) { const e = component.scene.elements.find(e => e.id === t.id)!; t.x = e.bounds.x; t.y = e.bounds.y }
  const issues: DeckIssue[] = [...fontIssues, ...geometryIssues(scene, input, texts)]
  let preview = ''
  try {
    issues.push(...await contrastIssues(component, texts, assets, scene, input))
    preview = await renderSlidePreview({ ...component.scene, schemaVersion: 1, id: component.id, sourceIndex: 0, assets, degradations: [] }, 1024)
  } catch { issues.push({ code: 'render-unavailable', message: 'Не удалось отрисовать все элементы слайда' }) }
  return { component, preview, report: { renderer: DECK_RENDERER, sceneHash, texts, issues } }
}
