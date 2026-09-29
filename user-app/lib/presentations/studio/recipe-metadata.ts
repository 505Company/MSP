export type RecipeTag = 'experimental'
export const recipeTagLabels: Record<RecipeTag, string> = { experimental: 'Экспериментальные' }
export type RecipeCollection = { section: string; name: string; description: string; tags: RecipeTag[] }

/** All five collections participate in the default pool. Tags identify their
 * provenance; they are not a separate activation gate. */
export const recipeCollections: RecipeCollection[] = [
  { section: '6:185', name: 'Заголовки и редакционные композиции', description: 'Обложки, крупные тезисы, текст и визуальные акценты.', tags: [] },
  { section: '19:209', name: 'Содержание и иллюстрации', description: 'Вводные слайды, цитаты, факты и текстовые колонки.', tags: [] },
  { section: '33:223', name: 'Шаги, сравнения и показатели', description: 'Структурированные группы, пояснения и метрики.', tags: [] },
  { section: '39:514', name: 'Обложки, пояснения и сценарии', description: 'Редакционные блоки, паспорта, ключевые метрики и списки.', tags: ['experimental'] },
  { section: '39:798', name: 'Данные, инструкции и кейсы', description: 'Таблицы, сравнения, длинные тексты и варианты с группами KPI.', tags: ['experimental'] },
]

/** Derived and mirrored variants inherit the tag through their collection ID.
 * This also works for saved results created before tags were introduced. */
export function recipeTags(recipeId: string): RecipeTag[] {
  return recipeCollections.find(c => c.section === recipeId.split('/')[0])?.tags ?? []
}
