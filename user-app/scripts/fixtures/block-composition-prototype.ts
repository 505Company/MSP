import { BLOCK_PROTOTYPE_VERSION, type BlockInstruction, type BlockInstructions } from '../../lib/presentations/recipes/block-composition-prototype'

// Two MANUAL instructions on the same original slide. Neither is a Qwen answer.
// No coordinates, CSS, fonts, sizes, source text or old whole-slide recipe IDs.
const ref = (fragmentId: string) => [{ fragmentId, start: 0, end: null }]
const card = 'rf-9ee1e260d64d4793-1'
const text = (id: string, role: 'title' | 'section' | 'note', fragment: string): BlockInstruction => ({ id, rule: 'text', role, refs: ref(fragment) })
const metric = (id: string, value: string, caption: string, emphasis: 'hero' | 'peer' | 'support', componentId: string | null = card): BlockInstruction =>
  ({ id, rule: 'metric', sizing: 'fill', emphasis, componentId, value: ref(value), caption: ref(caption) })
const list = (id: string, fragments: string[]): BlockInstruction => ({ id, rule: 'list', items: fragments.map(ref) })
export const blockPrototypeCases: { id: string; name: string; description: string; instruction: BlockInstructions }[] = [
  { id: 'A', name: 'Один главный факт', description: '76% — доминирующий факт без подложки; две меньшие карточки сверху справа, список регионов под ними.', instruction: {
    version: BLOCK_PROTOTYPE_VERSION, intent: 'Главное сообщение — самостоятельное планирование. Две другие метрики поддерживают его; регионы составляют отдельную группу подтверждений.',
    blocks: [text('title', 'title', 'f1'),
      { id: 'body', rule: 'row', sizing: 'fill', proportions: 'fact-explanations', children: [metric('main-fact', 'f2', 'f3', 'hero', null),
        { id: 'evidence', rule: 'stack', sizing: 'fill', children: [
          { id: 'supporting-facts', rule: 'row', sizing: 'hug', children: [metric('online', 'f4', 'f5', 'support'), metric('route', 'f6', 'f7', 'support')] },
          { id: 'regions', rule: 'stack', sizing: 'fill', children: [text('regions-heading', 'section', 'f8'), list('region-list', ['f9', 'f10', 'f11', 'f12', 'f13'])] },
        ] },
      ] }, text('source', 'note', 'f14')],
  } },
  { id: 'B', name: 'Три равноправных факта', description: 'Три крупные библиотечные карточки в ряд; региональные данные — отдельная нижняя полоса с двумя текстовыми колонками.', instruction: {
    version: BLOCK_PROTOTYPE_VERSION, intent: 'Три показателя равноправно описывают рынок. Региональные данные читаются вторым уровнем в отдельной нижней группе.',
    blocks: [text('title', 'title', 'f1'),
      { id: 'body', rule: 'stack', sizing: 'fill', children: [
        { id: 'market-facts', rule: 'row', sizing: 'fill', children: [metric('independent', 'f2', 'f3', 'peer'), metric('online', 'f4', 'f5', 'peer'), metric('route', 'f6', 'f7', 'peer')] },
        { id: 'regions', rule: 'stack', sizing: 'hug', children: [text('regions-heading', 'section', 'f8'),
          { id: 'region-columns', rule: 'row', sizing: 'hug', children: [list('regions-first', ['f9', 'f10', 'f11']), list('regions-second', ['f12', 'f13'])] },
        ] },
      ] }, text('source', 'note', 'f14')],
  } },
]
