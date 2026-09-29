import type { SourceSnapshot } from '../digital-designer/source-types'
import type { ImportOmission } from './semantic-isolation'

/** Incomplete source geometry cannot be used as a complete component. Isolate
 * its whole slide, retain the evidence, and let healthy slides continue. */
export function unavailableSourceSlides(snapshot: SourceSnapshot) {
  return snapshot.slides.filter(s => s.warnings.some(w => w.startsWith('normalized-page-unavailable')))
}

export function sourceReadOmissions(snapshot: SourceSnapshot): ImportOmission[] {
  return unavailableSourceSlides(snapshot).map(slide => {
    const warning = slide.warnings.find(w => w.startsWith('normalized-page-unavailable'))!
    const code = /^normalized-page-unavailable \(([^)]+)\)/.exec(warning)?.[1]
    return { name: `Не удалось прочитать слайд ${slide.number}`, slides: [slide.number],
      elementIds: snapshot.elements.filter(e => e.slide === slide.number).map(e => e.id),
      reason: `Часть исходных объектов недоступна${code ? ` (${code})` : ''}. Слайд пропущен при создании компонентов; исходный файл и доступные ресурсы сохранены.` }
  })
}
