import type { SourceSnapshot, SourceElement } from '../../lib/digital-designer/source-types'
import type { TemplateProposal } from '../../lib/presentations/recipes/template-contract'
import type { TemplatePlan } from '../../lib/presentations/recipes/template-plan'
import type { RecipeMaterial } from '../../lib/presentations/recipes/pilot-cases'
import { sourceText } from './native-layout'

export function templateRecipeFixture() {
  const elements: SourceElement[] = []
  const rectangle = (id: string, x: number, y: number, width: number, height: number, channel: number) => elements.push({
    id, slide: 1, name: id, kind: 'rectangle', properties: { bounds: { x, y, width, height }, visible: true, opacity: 1, rotation: 0, zIndex: 0,
      fill: { type: 'solid', color: { r: channel, g: channel, b: channel, a: 1 } } },
  })
  rectangle('background', 0, 0, 1200, 675, 1)
  elements.push(sourceText('primary', 'Исходный заголовок', 30, 25, 1140, 60, 36, 'Play'))
  const proposal: TemplateProposal = { name: 'Четыре карточки', purpose: 'Сопоставление четырёх тезисов', slideId: 's01', itemCount: 4,
    slots: [{ sourceId: 'primary', role: 'primary', item: 0, optional: false, ownerId: null }],
    graphics: [{ sourceId: 'background', usage: 'decoration', reason: 'Фон' }], sourceOnlyText: [], expandSlots: [], rationale: 'Synthetic fixture' }
  const material: RecipeMaterial = { id: 'fixture', synthetic: true, itemCount: 4, fragments: [{ id: 'title', text: 'Новый заголовок' }] }
  const plan: TemplatePlan = { bindings: [{ sourceId: 'primary', fragments: ['title'] }], rationale: 'Synthetic test, not a user slide' }
  for (let i = 1; i <= 4; i++) {
    const x = 30 + (i - 1) * 290, ownerId = `panel-${i}`
    rectangle(ownerId, x, 140, 270, 370, .9)
    for (const [role, y, h] of [['heading', 170, 55], ['body', 250, 35]] as const) {
      const sourceId = `${role}-${i}`
      elements.push(sourceText(sourceId, `Исходный ${role} ${i}`, x + 20, y, 230, h, 22, 'Play'))
      proposal.slots.push({ sourceId, role, item: i, optional: false, ownerId })
      material.fragments.push({ id: sourceId, text: role === 'body' ? 'Один абзац с пояснением, которому требуется больше одной строки.' : `Тезис ${i}` })
      plan.bindings.push({ sourceId, fragments: [sourceId] })
      if (role === 'body') proposal.expandSlots.push(sourceId)
    }
    // An optional text field makes the candidate large enough for extraction.
    const note = sourceText(`note-${i}`, 'Старый факт', x + 20, 555, 230, 40, 18, 'Play')
    elements.push(note); proposal.slots.push({ sourceId: note.id, role: 'note', item: i, optional: true, ownerId: null })
    proposal.graphics.push({ sourceId: ownerId, usage: 'decoration', reason: 'Пустая подложка карточки' })
  }
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'a'.repeat(64), name: 'Synthetic template', slideCount: 1,
    slides: [{ id: 's01', number: 1, width: 1200, height: 675, part: 'test.xml', text: '', warnings: [] }], elements, assets: [], colors: [], fonts: [{ family: 'Play', sizes: [18, 22, 36], occurrences: 13 }], limitations: [] }
  return { snapshot, proposal, material, plan }
}
