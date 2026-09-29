import test from 'node:test'
import assert from 'node:assert/strict'
import { compileEditableProposal } from '../lib/design-system/editable-source'
import { nativeBoundText } from '../lib/design-system/editable-native-layout'
import type { EditableProposal } from '../lib/design-system/editable-contract'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'

test('a metric placeholder and caption in one rich text object become independent fields without losing typography', () => {
 const text = '???%\nПодпись\nпоказателя', ink = { type: 'solid', color: { r: .4, g: .8, b: 1, a: 1 } }
 const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'source', name: 'Metrics', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [], slides: [{ id: 's1', number: 1, width: 500, height: 300, part: 'slide', text, warnings: [] }], elements: [{ id: 'rich', name: 'Rich metric', kind: 'text', slide: 1, properties: { bounds: { x: 0, y: 0, width: 400, height: 220 }, rotation: 0, opacity: 1, visible: true, zIndex: 0, text, fontFamily: 'Play', fontStyle: 'Bold', fontSize: 72, flow: { columns: 1, gap: 0, autoFit: 'NONE' }, textBox: { align: 'LEFT', vertical: 'TOP', wrap: true }, paragraphs: [{ start: 0, end: text.length, align: 'LEFT', left: 0, right: 0, indent: 0, before: 0, after: 0, fontSize: 72 }], styleRuns: [{ start: 0, end: 4, fontFamily: 'Play', fontStyle: 'Bold', fontSize: 72 }, { start: 4, end: text.length, fontFamily: 'Play', fontStyle: 'Regular', fontSize: 24 }], colorRuns: [{ start: 0, end: text.length, fill: ink }] } }] }
 const proposal: EditableProposal = { id: 'metric', name: 'Metric', kind: 'metric', description: '', tags: [], sourceIds: ['rich'], memberIds: [], style: {}, config: {}, data: { value: '???', unit: '%' }, dataStatus: 'readable' }
 const original = JSON.stringify(snapshot), t = compileEditableProposal(proposal, 1, snapshot, 'test', [])
 assert.equal(t.sourceLayout!.text[0].binding.field, 'metric')
 assert.deepEqual(t.data.items?.map(i => i.text), ['Подпись', 'показателя'])
 const source = nativeBoundText(t.sourceLayout!.text[0], t.data)
 assert.equal(source.text, text)
 const changed = nativeBoundText(t.sourceLayout!.text[0], { ...t.data, value: '52', items: [{ text: 'Новая подпись' }, { text: 'данных' }] }, true)
 assert.equal(changed.text, '52%\nНовая подпись\nданных')
 assert.equal(changed.styleRuns![0].fontSize, 72); assert.equal(changed.styleRuns!.at(-1)!.fontSize, 24)
 assert.equal(JSON.stringify(snapshot), original)
 // A different number appearing in the caption must not be guessed as value.
 const unrelated = compileEditableProposal({ ...proposal, data: { value: '99', unit: '%' } }, 1, snapshot, 'test', [])
 assert.notEqual(unrelated.sourceLayout!.text[0].binding.field, 'metric')
})
