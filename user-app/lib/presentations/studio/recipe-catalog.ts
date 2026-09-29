import { studioRecipes } from './recipes'
import { executablePacks } from './recipe-packs'
import { tableVariants } from './recipe-variants'
import { recipeCollections, type RecipeCollection, type RecipeTag } from './recipe-metadata'

export type CatalogRecipe = { id: string; name: string; family?: string; derived: boolean; tags: RecipeTag[] }
export type CatalogCollection = RecipeCollection & { recipes: CatalogRecipe[] }

const modeNames: Record<string, string> = {
  'title-only': 'Крупный заголовок', 'title-support': 'Заголовок и пояснение', 'semantic-graphic': 'Тезис и графика',
  'context-title': 'Заголовок с контекстом', 'dense-editorial': 'Редакционный разбор', 'text-heavy': 'Развёрнутый текст',
  'single-visual': 'Один визуальный акцент', 'visual-mosaic': 'Мозаика изображений', 'intro': 'Вводный слайд',
  'intro-reverse': 'Вводный слайд с обратным акцентом', 'split-intro': 'Вводный слайд в двух частях', 'three-intro': 'Три вводных блока',
  'fact-visual': 'Факт и изображение', 'long-thesis': 'Развёрнутый тезис', 'quote': 'Цитата', 'photo-note': 'Фото с подписью',
  'metric-visual': 'Показатель и изображение', 'text-columns': 'Текстовые колонки', 'four-steps': 'Четыре шага',
  'comparison': 'Сравнение', 'theses-visual': 'Тезисы и изображение', 'fact-explanations': 'Факт с пояснениями',
  'columns-photo': 'Колонки и фото', 'feature-metrics': 'Описание и показатели',
  'two-explanations': 'Два пояснения', 'principles': 'Принципы', 'mixed-summary': 'Сводка', 'long-article': 'Большая статья',
  'quote-comment': 'Цитата и комментарий', 'authors-cover': 'Обложка с авторами', 'chapter-cover': 'Обложка раздела',
  'split-cover': 'Обложка в двух частях', 'media-intro': 'Вводный слайд с медиа', 'dated-passport': 'Паспорт с датой',
  'sidebar-cover': 'Обложка с боковой областью', 'metadata-cover': 'Обложка с реквизитами', 'partners-cover': 'Обложка с партнёрами',
  'key-metrics': 'Ключевые показатели', 'seven-theses': 'Семь тезисов', 'five-steps': 'Пять шагов', 'day-scenario': 'Сценарий дня',
  'reading-three-columns': 'Текст в трёх колонках', 'reading-margin-quote': 'Текст и цитата на полях',
  'reading-four-editorial-columns': 'Четыре редакционные колонки', 'reading-quote-banner': 'Текст и полоса с цитатой',
  'reading-title-rail-tiers': 'Текст с боковым заголовком', 'reading-modular-essay': 'Статья по разделам', 'reading-source-dossier': 'Досье с источниками',
  'data-metrics-methods': 'Показатели и методика', 'data-evidence-table': 'Таблица данных', 'data-hero-fact-clarifications': 'Главный факт и уточнения',
  'data-evidence-matrix': 'Матрица данных', 'data-checkpoint-trajectory': 'Контрольные точки', 'data-approach-table': 'Подход и таблица',
  'display-wide-fact': 'Крупный факт', 'display-four-orientations': 'Четыре направления', 'display-two-approaches': 'Два подхода',
  'instructions-ten-step-grid': 'Десять шагов', 'instructions-horizontal-timeline': 'Горизонтальная шкала времени',
  'instructions-argument-chain': 'Цепочка аргументов', 'instructions-recommendations-exceptions': 'Рекомендации и исключения',
  'instructions-twelve-point-plan': 'План из двенадцати пунктов', 'instructions-six-faq': 'Шесть вопросов и ответов',
  'instructions-eight-theses': 'Восемь тезисов', 'display-seven-theses': 'Семь тезисов с акцентом',
  'media-title-map-modules': 'Заголовок, карта и модули', 'media-quote-statistics': 'Цитата и статистика',
  'media-case-result': 'Кейс и результат', 'media-closing-system': 'Итоговая композиция',
  'opener-bottom-introduction': 'Обложка с нижним вводным блоком', 'opener-large-quotation': 'Обложка с крупной цитатой',
  'opener-dated-passport': 'Титульный паспорт с датой', 'opener-mini-contents': 'Обложка с кратким содержанием',
}

/** Read-only view of the very same states used by the executor. Source aliases
 * do not gain duplicate entries; added variants retain their collection tag. */
export const studioRecipeCatalog: CatalogCollection[] = recipeCollections.map(collection => {
  const incoming = executablePacks.find(({ bundle }) => bundle.sourceSection === collection.section)
  const recipes: CatalogRecipe[] = incoming
    ? incoming.states.map(state => ({
      id: `${collection.section}/${state.id}`, name: tableVariants[state.id]?.label ?? modeNames[state.modeId] ?? state.modeId,
      family: incoming.bundle.families.find(f => f.id === state.familyId)?.name,
      derived: !!tableVariants[state.id], tags: collection.tags,
    }))
    : studioRecipes.filter(r => r.id.startsWith(collection.section + '/')).map(r => ({
      id: r.id, name: modeNames[r.mode] ?? r.mode, derived: false, tags: collection.tags,
    }))
  return { ...collection, recipes }
})
