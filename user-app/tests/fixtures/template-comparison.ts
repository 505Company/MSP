import type { SourceSnapshot, SourceElement } from '../../lib/digital-designer/source-types'
import { compileTemplateRecipe, type TemplateProposal } from '../../lib/presentations/recipes/template-contract'
import { applyTemplateComparison, type TemplateComparison } from '../../lib/presentations/recipes/template-comparison'
import type { RecipeMaterial } from '../../lib/presentations/recipes/pilot-cases'
import type { TemplatePlan } from '../../lib/presentations/recipes/template-plan'
import { sourceText } from './native-layout'
import type { BoundsIR } from '../../vendor/drag/src/core/model'

export async function comparisonFixture(encoding: TemplateComparison['encoding'] = 'equal-badges') {
  const elements: SourceElement[] = []
  const rectangle = (id: string, x: number, y: number, width: number, height: number, channel: number) => elements.push({ id, slide: 1, name: id, kind: 'rectangle', properties: {
    bounds: { x, y, width, height }, visible: true, opacity: 1, rotation: 0, zIndex: 0, fill: { type: 'solid', color: { r: channel, g: channel, b: channel, a: 1 } },
  } })
  const addText = (id: string, text: string, x: number, y: number, w: number, h: number, size: number) => {
    const source = sourceText(id, text, x, y, w, h, size, 'Play')
    source.properties.textBox = { align: 'LEFT', vertical: 'TOP', wrap: true }
    source.properties.paragraphs = [{ start: 0, end: text.length, fontSize: size, align: 'LEFT', before: 0, after: 0, left: 0, right: 0, indent: 0, lineHeight: { unit: 'PERCENT', value: 100 } }]
    elements.push(source)
  }
  rectangle('background', 0, 0, 1200, 675, 1)
  addText('primary', 'Исходное сравнение', 30, 25, 1140, 60, 36)
  const proposal: TemplateProposal = { name: 'Две пары процентов', purpose: 'Сравнение двух серий', slideId: 's01', itemCount: 2,
    slots: [{ sourceId: 'primary', role: 'primary', item: 0, optional: false, ownerId: null }], graphics: [{ sourceId: 'background', usage: 'decoration', reason: 'Фон' }], sourceOnlyText: [], expandSlots: [], rationale: 'Synthetic fixture' }
  const comparison: TemplateComparison = { encoding, pairs: [], excludeGraphics: [], rationale: 'Synthetic model proposal' }
  const material: RecipeMaterial = { id: 'fixture', synthetic: true, itemCount: 2, fragments: [{ id: 'title', text: 'Новые данные' }] }
  const plan: TemplatePlan = { bindings: [{ sourceId: 'primary', fragments: ['title'] }], rationale: 'Synthetic binding, not a user slide' }
  for (let i = 1; i <= 2; i++) {
    const x = 30 + (i - 1) * 590
    for (const [role, y, h, text] of [['heading', 140, 40, `Тема ${i}`], ['body', 200, 110, 'Пояснение к новому показателю.']] as const) {
      const id = `${role}-${i}`
      addText(id, `Исходный ${role}`, x, y, 250, h, 22)
      proposal.slots.push({ sourceId: id, role, item: i, optional: false, ownerId: null })
      material.fragments.push({ id, text }); plan.bindings.push({ sourceId: id, fragments: [id] })
    }
    const pair = { item: i, first: { sourceId: `value-${i}-0`, graphicId: `bar-${i}-0` }, second: { sourceId: `value-${i}-1`, graphicId: `bar-${i}-1` } }
    comparison.pairs.push(pair)
    for (const [series, m] of [pair.first, pair.second].entries()) {
      const y = 140 + series * 65
      rectangle(m.graphicId, x + 290, y, series ? 210 : 250, 50, .85)
      addText(m.sourceId, `${series ? 60 : 80}% в ${series ? 2024 : 2025}`, x + 305, y + 8, 180, 34, 22)
      proposal.slots.push({ sourceId: m.sourceId, role: 'note', item: i, optional: true, ownerId: m.graphicId })
      proposal.graphics.push({ sourceId: m.graphicId, usage: 'decoration', reason: 'Подложка' })
      material.fragments.push({ id: m.sourceId, text: `${series ? 40 : 90}% в ${series ? 2026 : 2027}` })
      plan.bindings.push({ sourceId: m.sourceId, fragments: [m.sourceId] })
    }
  }
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'a'.repeat(64), name: 'Synthetic metric pairs', slideCount: 1,
    slides: [{ id: 's01', number: 1, width: 1200, height: 675, part: 'test.xml', text: '', warnings: [] }], elements, assets: [], colors: [], fonts: [{ family: 'Play', sizes: [22, 36], occurrences: 9 }], limitations: [] }
  const base = await compileTemplateRecipe(proposal, snapshot, 'fixture', 'synthetic-extraction')
  const recipe = await applyTemplateComparison(base, comparison, 'synthetic-comparison')
  return { snapshot, proposal, base, recipe, comparison, material, plan }
}

export async function balancedComparisonFixture() {
  const f = await comparisonFixture()
  for (const e of f.snapshot.elements) if (/^(heading|body|value|bar)-2(?:-|$)/.test(e.id)) {
    const bounds = e.properties.bounds as BoundsIR
    bounds.x -= 590; bounds.y += 220
  }
  f.snapshot.elements.find(e => e.id === 'heading-2')!.properties.textBox = { align: 'LEFT', vertical: 'TOP', wrap: false }
  f.material.fragments.find(e => e.id === 'heading-2')!.text = 'Длинный заголовок с обязательным переносом'
  f.snapshot.elements.push({ id: 'icon-wrapper', slide: 1, name: 'Clipped icon', kind: 'group', properties: {
    bounds: { x: 325, y: 375, width: 5, height: 5 }, clipsContent: true, visible: true, opacity: 1, rotation: 0, zIndex: 1,
  } }, { id: 'icon', parentId: 'icon-wrapper', slide: 1, name: 'Icon', kind: 'rectangle', properties: {
    bounds: { x: 0, y: 0, width: 5, height: 5 }, visible: true, opacity: 1, rotation: 0, zIndex: 1, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
  } })
  f.proposal.graphics.push({ sourceId: 'icon', usage: 'decoration', reason: 'Synthetic complete icon' })
  const base = await compileTemplateRecipe(f.proposal, f.snapshot, 'fixture', 'synthetic-extraction')
  const comparison: TemplateComparison = { ...f.comparison, layout: 'balanced-rows' }
  const recipe = await applyTemplateComparison(base, comparison, 'synthetic-balanced')
  return { ...f, base, comparison, recipe }
}
