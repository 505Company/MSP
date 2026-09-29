import { pixelFixture } from './pixel-layout'
import { CONTENT_RECIPE_VERSION, type ContentRecipe, type RecipeBrand } from '../../lib/presentations/recipes/content-recipe'

/** Synthetic content, independent of the three tourism slides and saved runs. */
export function contentRecipeFixture(kind: ContentRecipe['recipe'] = 'metrics-list') {
  const { env } = pixelFixture(true)
  env.input.content = []
  const r = (id: string, text: string) => {
    env.input.content.push({ id, text })
    return [{ fragmentId: id, start: 0, end: null }]
  }
  const metric = (id: string) => ({ componentId: 'native-metric', value: r(`${id}-value`, '72%'), caption: r(`${id}-caption`, 'Завершили задачу без помощи') })
  const common: Pick<ContentRecipe, 'version' | 'title' | 'footer'> = { version: CONTENT_RECIPE_VERSION, title: r('title', 'Понятный путь помогает клиенту'), footer: [] }
  const list = () => ({ heading: r('list-heading', 'Что изменилось'), items: [r('item-1', 'Упростили поиск — 32%'), r('item-2', 'Сократили ожидание — 18%')] })
  let recipe: ContentRecipe
  if (kind === 'headline') recipe = { ...common, recipe: kind, support: [] }
  else if (kind === 'metrics-list') recipe = { ...common, recipe: kind, metrics: [metric('a'), metric('b')], list: list() }
  else if (kind === 'audience-feature') recipe = { ...common, recipe: kind, metrics: [metric('a'), metric('b')], list: list(),
    feature: { componentId: 'native-metric', heading: r('feature-heading', 'Результат команды'), metrics: [metric('c'), metric('d')].map(({ value, caption }) => ({ value, caption })) } }
  else recipe = { ...common, recipe: kind, principles: [
    { heading: r('h1', 'Понять задачу'), body: r('b1', 'Сначала выяснить, что человек хочет получить.') },
    { heading: r('h2', 'Объяснить решение'), body: r('b2', 'Показать понятный следующий шаг и сроки.') },
  ], evidence: [metric('a'), metric('b')] }
  const brand: RecipeBrand = { headingFont: 'font-1', bodyFont: 'font-1', metricFont: 'font-1', background: '#ffffff', headingColor: '#000000', bodyColor: '#000000' }
  return { env, recipe, brand }
}
