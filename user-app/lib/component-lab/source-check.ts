import { MINIMUM_TEXT_CONTRAST, measurementIssues, type BoxConstraints, type ComponentContent, type ComponentProfile } from './contract'
import { proofCaseSchema } from './proof'

// The imported text must fit at least one supported container as well as the
// synthetic matrix. This checks usability, not visual similarity to the slide.
export const sourceConstraints = (p: ComponentProfile): BoxConstraints => ({ width: p.maxWidth, maxHeight: p.maxHeight, widthMode: 'fill', heightMode: 'hug' })
export function validateSourceCheck(p: ComponentProfile, content: ComponentContent, raw: unknown) {
  const check = proofCaseSchema.parse(raw), constraints = sourceConstraints(p)
  if (check.id !== 'source') throw Error('Отсутствует проверка исходного текста.')
  if (check.status === 'fits' && (!check.chosen?.fits || check.chosen.fields.some(f => !f.align) || measurementIssues(p, content, check.chosen, constraints).length)) throw Error('Измерения исходного текста не подтверждены.')
  if (check.status === 'needs-space' && (!check.chosen || !measurementIssues(p, content, check.chosen, constraints).length)) throw Error('Ограничение исходного текста не подтверждено.')
  const visible = p.fields.filter(f => content[f.id]?.trim())
  const passed = check.status === 'fits' && check.pixels?.length === visible.length && new Set(check.pixels.map(v => v.id)).size === visible.length && visible.every(f => check.pixels!.some(v => v.id === f.id && v.count >= 3 && v.contrast >= MINIMUM_TEXT_CONTRAST))
  return { content, constraints, check, passed: !!passed && (!p.artwork || check.artwork?.hash === p.artwork.hash && check.artwork.count >= 3) }
}
