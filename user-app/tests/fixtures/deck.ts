import { acceptedVariants } from '../../lib/presentations/recipes/catalog'
import { DECK_RENDERER, type BoundScene, type DeckEvidence, type SceneInput } from '../../lib/presentations/deck-contract'
export const deckInput = (): SceneInput => ({ slideId: 'slide-1', title: 'Новый этап', variant: acceptedVariants.find(v => v.id === 'minimal-center-38--3')!,
  content: [{ id: 'f1', text: 'Новый этап', kind: 'heading', role: 'primary' }, { id: 'f2', text: 'До 42,5 % — только при выполнении условия. 🧭', kind: 'text', role: 'support' }], directions: [], resources: [],
  brand: { uploadId: '11111111-1111-4111-8111-111111111111', catalogId: 'a'.repeat(64), sourceId: 'b'.repeat(64), name: 'Test brand',
    tokens: { fonts: [{ family: 'Play', sizes: [32, 72], occurrences: 2 }], colors: ['#000000', '#FFFFFF', '#0077FF'].map(hex => ({ hex, occurrences: 1 })) },
    rules: [], calibrationId: null, fontPolicy: 'Actual fonts only', resources: [], resourceStatus: 'test', unresolved: 0 } })
export const deckEvidence = (): DeckEvidence => ({ renderer: DECK_RENDERER, fonts: ['Play'], resourceIds: [], sheet: null })
export const deckScene = (input = deckInput()): BoundScene => ({ variantId: input.variant.id, fontFamily: 'Play', background: '#000000',
  colors: [{ role: 'purple', hex: '#000000' }, { role: 'ink', hex: '#000000' }, { role: 'white', hex: '#FFFFFF' }], resources: [],
  texts: input.content.map((f, index) => ({ id: index ? 'subtitle' : 'title', yOffset: 0, separator: 'newline', parts: [{ fragmentId: f.id, start: 0, end: f.text.length }] })), designRationale: 'Тестовая привязка исходных фрагментов.' })
