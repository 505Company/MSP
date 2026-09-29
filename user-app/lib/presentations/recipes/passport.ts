import source from './layout-engine-v1/source.json' with { type: 'json' }
import { adaptationLevel, LAYOUT_CANVAS, LAYOUT_RECIPE_VERSION, layoutStates } from './layout-engine-v1/states'

export const RECIPE_PASSPORT_VERSION = 'recipe-passport-1'
export const RECIPE_RULES_VERSION = 'recipe-rules-1'
export const recipeRules = {
  version: RECIPE_RULES_VERSION,
  preserveEverySourceCharacter: true,
  inventContent: false,
  arbitraryFontShrink: false,
  arbitraryGeometry: false,
  measurement: 'actual-font-ink-and-png',
  escalation: ['local-block', 'neighbour-rebalance', 'compatible-state'],
  exhausted: 'reject-with-evidence',
} as const

/** A common library envelope, not a second copy of an executor's geometry. */
export type RecipePassport = {
  schemaVersion: typeof RECIPE_PASSPORT_VERSION
  id: string; version: string; name: string; purpose: string
  rulesVersion: typeof RECIPE_RULES_VERSION
  origin: { kind: 'author' | 'template'; sourceHash: string; uploadId?: string; slideIds: string[]; modelRunId?: string }
  scope: { kind: 'portable' } | { kind: 'design-system'; uploadId: string }
  executor: 'layout-engine-v1' | 'native-template-v1'
  canvas: { width: number; height: number }
  invariants: string[]
  capacity: { description: string; itemCount?: number }
  states: { id: string; family: string; evidence: 'authored' | 'observed' | 'proposed'; geometryRef: string }[]
  transitions: { from: string; to: string; level: 1 | 2 | 3; when: string }[]
  qualification: { technical: 'unverified' | 'passed' | 'failed'; artistic: 'pending' | 'accepted' | 'rejected'; receipt?: string }
}

export function authoredRecipePassport(): RecipePassport {
  return {
    schemaVersion: RECIPE_PASSPORT_VERSION, id: 'layout-engine-v1', version: LAYOUT_RECIPE_VERSION,
    name: 'Титульные и тезисные композиции', purpose: 'Крупный тезис с необязательными пояснениями, фактами и графикой.',
    rulesVersion: RECIPE_RULES_VERSION, origin: { kind: 'author', sourceHash: source.sourceSha256, slideIds: [] },
    scope: { kind: 'portable' }, executor: 'layout-engine-v1', canvas: LAYOUT_CANVAS,
    invariants: ['geometry-from-authored-state', 'fonts-and-colors-from-design-system', 'exact-source-coverage'],
    capacity: { description: 'По совместимости ролей и измерениям конкретного состояния; не универсальная схема для таблиц и процессов.' },
    states: layoutStates.map(s => ({ id: s.id, family: s.family, evidence: 'authored', geometryRef: `layout-engine-v1/states#${s.id}` })),
    transitions: layoutStates.flatMap(from => layoutStates.filter(to => to.id !== from.id).map(to => ({
      from: from.id, to: to.id, level: adaptationLevel(from, to) as 1 | 2 | 3,
      when: 'Previous measured state failed; target supports every bound semantic role.',
    }))),
    // Existing run receipts remain per-deck evidence, not blanket qualification.
    qualification: { technical: 'unverified', artistic: 'pending' },
  }
}
