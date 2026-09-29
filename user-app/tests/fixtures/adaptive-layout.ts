import { layoutInput, layoutPlan } from './layout'
import type { AdaptivePlan } from '../../lib/presentations/adaptive-layout'
import { ADAPTIVE_COMPONENTS_VERSION } from '../../lib/presentations/adaptive-components'
import type { TextElementIR } from '../../vendor/drag/src/core/model'
import { sourceText } from './native-layout'

export function adaptiveFixture() {
  const input = layoutInput()
  input.colors.push({ id: 'surface', hex: '#EEF1F6' }, { id: 'accent', hex: '#004EA8' })
  input.content = [{ id: 'title', text: 'Сервис становится удобнее, когда команды понимают задачи клиента' },
    { id: 'h1', text: 'Понять задачу' }, { id: 'b1', text: 'Сотрудник выясняет контекст обращения и предлагает понятное решение.' },
    { id: 'h2', text: 'Сохранить выбор' }, { id: 'b2', text: 'Клиент сам определяет удобный способ продолжить работу.' },
    { id: 'h3', text: 'Объяснить результат' }, { id: 'b3', text: 'Каждый участник видит статус и следующий шаг.' },
    { id: 'h4', text: 'Помочь вовремя' }, { id: 'b4', text: 'Поддержка остаётся доступной после завершения заказа.' }]
  const plan: AdaptivePlan = { title: ['title'], footer: [], fontToken: 'font-1', rationale: 'Synthetic fixture, not a user slide or model reply.',
    colors: { ...layoutPlan().colors, surface: 'surface', accent: 'accent', onAccent: 'white' },
    blocks: Array.from({ length: 4 }, (_, i) => ({ emphasis: 'normal', parts: [{ role: 'heading', fragments: [`h${i + 1}`] }, { role: 'body', fragments: [`b${i + 1}`] }] })),
  }
  return { input, plan }
}

export function adaptiveComponentFixture() {
  const { input, plan } = adaptiveFixture()
  plan.version = ADAPTIVE_COMPONENTS_VERSION
  const field = (id: string, text: string, y: number, size: number): TextElementIR => ({
    ...sourceText(id, text, 28, y, 444, size * 1.5, size, 'Missing Source Font').properties, id, kind: 'text',
  } as unknown as TextElementIR)
  input.components = [{ id: 'native-metric', name: 'Synthetic source metric', description: 'Test only, not a real library qualification', tags: ['test'], kind: 'metric',
    width: 500, height: 240, slide: 1, sourceIds: ['test-panel', 'test-value', 'test-caption'], memberIds: [], dataStatus: 'native', graphicHtml: {},
    style: { background: '#EAF5F0', padding: 0 }, config: {}, data: { value: '999%', text: 'Old example caption' },
    sourceLayout: { graphicIds: ['test-panel'], graphic: '<svg viewBox="0 0 500 240" width="100%" height="100%"><rect width="500" height="240" rx="8" fill="#EAF5F0"/><path d="M0 0H12V240H0Z" fill="#00784D"/></svg>', text: [
      { binding: { field: 'value' }, element: field('test-value', '999%', 10, 90) },
      { binding: { field: 'text' }, element: field('test-caption', 'Old example caption', 160, 32) },
    ] },
  }]
  // Recovered native numbers have no paragraph list, unlike ordinary PPTX text.
  delete input.components[0].sourceLayout!.text[0].element.paragraphs
  input.content = [{ id: 'title', text: 'Измеримый результат' }, { id: 'value1', text: '72%' }, { id: 'label1', text: 'Завершили задачу' },
    { id: 'value2', text: '18%' }, { id: 'label2', text: 'Вернулись снова' }, { id: 'heading', text: 'Что изменилось' }, { id: 'body', text: 'Команда упростила путь клиента и сохранила все важные условия.' }]
  plan.blocks = [{ emphasis: 'plain', parts: [1, 2].map(i => ({ role: 'body', fragments: [`value${i}`, `label${i}`],
    component: { id: 'native-metric', fields: [{ path: 'value', fragments: [`value${i}`] }, { path: 'text', fragments: [`label${i}`] }] } })) },
    { emphasis: 'normal', parts: [{ role: 'heading', fragments: ['heading'] }, { role: 'body', fragments: ['body'] }] }]
  input.content.push({ id: 'group-heading', text: 'Показатели' })
  plan.blocks[0].parts.unshift({ role: 'heading', fragments: ['group-heading'] })
  return { input, plan }
}

export function adaptiveGridFixture() {
  const fixture = adaptiveComponentFixture()
  fixture.plan.version = 'adaptive-blocks-3'
  return fixture
}

export function adaptivePaletteFixture() {
  const fixture = adaptiveGridFixture()
  fixture.plan.version = 'adaptive-blocks-4'
  fixture.plan.blocks[0].panelColors = null
  fixture.plan.blocks[1].panelColors = { background: 'accent', foreground: 'white' }
  return fixture
}
