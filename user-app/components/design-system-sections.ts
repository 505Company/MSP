export const designSystemSections = [
  ['components', 'Компоненты'], ['colors', 'Цвета'], ['type', 'Типографика'],
  ['backgrounds', 'Фоны'], ['assets', 'Графика и иконки'], ['diagrams', 'Схемы'], ['composition', 'Композиция'],
  ['style', 'Правила стиля'], ['source', 'Исходные слайды'],
] as const
export type DesignSystemSection = typeof designSystemSections[number][0]
export function designSystemSection(value: string | null): DesignSystemSection {
  return designSystemSections.find(([id]) => id === value)?.[0] ?? 'components'
}
