import { colorRoles, type LayoutInput, type LayoutPlan, type LayoutSpan } from '../../lib/presentations/layout-contract'
export function layoutInput(): LayoutInput {
  return { slideId: 'slide-1', title: 'Проверка нового рецепта', uploadId: 'ec623bca-3204-4d28-bfca-028c7c73638f', content: [{ id: 'f1', text: 'Открываем новое' }], directions: [],
    fonts: [{ id: 'font-1', family: 'Play' }], colors: [{ id: 'white', hex: '#FFFFFF' }, { id: 'black', hex: '#000000' }, { id: 'blue', hex: '#0077FF' }], components: [], graphics: [], rules: [] }
}
export const whole = (input: LayoutInput, index = 0): LayoutSpan[] => [{ fragmentId: input.content[index].id, start: 0, end: input.content[index].text.length }]
export function layoutPlan(input = layoutInput()): LayoutPlan {
  return { preferredState: 'title-1', fontToken: 'font-1', colors: Object.fromEntries(colorRoles.map(r => [r, r === 'background' || r === 'surface' ? 'white' : 'black'])) as LayoutPlan['colors'],
    primary: whole(input), support: [], context: [], facts: [], footer: [], visuals: [], connectorId: null, rationale: 'Synthetic renderer fixture, not a model response.' }
}
