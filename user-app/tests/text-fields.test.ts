import test from 'node:test'
import assert from 'node:assert/strict'
import type { TextElementIR } from '../vendor/drag/src/core/model'
import { createTextFields, fillTextFields } from '../lib/design-system/text-fields'

const run = (start: number, end: number, fontSize = 20) => ({ start, end, fontFamily: 'Arial', fontStyle: 'Regular' as const, fontSize })
const paragraph = (start: number, end: number) => ({ start, end, align: 'LEFT' as const, left: 0, right: 0, indent: 0, before: 0, after: 0, fontSize: 20 })
const text = (value: string): TextElementIR => ({ id: 'text', name: 'Текст', kind: 'text', text: value, fontFamily: 'Arial', fontSize: 20, bounds: { x: 5, y: 7, width: 300, height: 120 }, rotation: 0, opacity: 1, visible: true, zIndex: 1 })

test('equivalent PPTX fragments accept complete new paragraphs without duplicate run ranges', () => {
  const e = { ...text('Первая\nВторая'), styleRuns: [run(0, 6), run(6, 7), run(7, 13)], paragraphs: [paragraph(0, 6), paragraph(7, 13)] }
  const fields = createTextFields(e, 'Описание')
  assert.equal(fields.length, 1); assert.equal(fields[0].range, undefined)
  fillTextFields(e, fields, { text: 'Новое содержание\nДругая строка\nФинал' })
  assert.equal(e.styleRuns.length, 1); assert.equal(e.styleRuns[0].end, e.text.length)
  assert.equal(e.paragraphs.length, 3); assert.equal(e.paragraphs[2].end, e.text.length)
  assert.deepEqual(e.bounds, { x: 5, y: 7, width: 300, height: 120 })
})

test('speaker name and description retain their own size and weight after independently sized replacements', () => {
  const e: TextElementIR = { ...text('Иван\nСпикер'), styleRuns: [{ ...run(0, 4, 32), fontStyle: 'Bold' }, run(4, 11, 18)], paragraphs: [paragraph(0, 11)] }
  const fields = createTextFields(e, 'Спикер'), copy = structuredClone(e)
  assert.deepEqual(fields.map(s => s.defaultText), ['Иван', 'Спикер'])
  fillTextFields(copy, fields, { [fields[0].id]: 'Мария', [fields[1].id]: 'Руководитель программы' })
  assert.equal(copy.text, 'Мария\nРуководитель программы')
  assert.deepEqual(copy.styleRuns, [{ ...run(0, 5, 32), fontStyle: 'Bold' }, run(5, copy.text.length, 18)])
  assert.equal(e.text, 'Иван\nСпикер')
  assert.throws(() => fillTextFields(structuredClone(e), fields, { [fields[0].id]: 'Первая\nВторая' }), /абзацы/)
})

test('native bullet prefixes and paragraph spacing survive text replacement', () => {
  const e: TextElementIR = { ...text('• Первый\n• Второй'), styleRuns: [run(0, 17)], paragraphs: [{ ...paragraph(0, 8), markerLength: 2, indent: -12, left: 20 }, { ...paragraph(9, 17), markerLength: 2, indent: -12, left: 20, before: 8 }] }
  const fields = createTextFields(e, 'Пункт')
  assert.deepEqual(fields.map(s => s.defaultText), ['Первый', 'Второй'])
  fillTextFields(e, fields, { [fields[0].id]: 'Начало', [fields[1].id]: 'Следующий шаг' })
  assert.equal(e.text, '• Начало\n• Следующий шаг')
  assert.deepEqual(e.paragraphs?.map(p => [p.start, p.end, p.markerLength, p.before]), [[0, 8, 2, 0], [9, 24, 2, 8]])
  assert.equal(e.paragraphs?.[1].indent, -12)
})

test('inline color emphasis retains spaces and correct ranges without inheriting unrelated style', () => {
  const e: TextElementIR = { ...text('Новый важный текст'), styleRuns: [run(0, 6), run(6, 18)], colorRuns: [
    { start: 0, end: 6, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } } },
    { start: 6, end: 12, fill: { type: 'solid', color: { r: 0, g: .4, b: 1, a: 1 } } },
    { start: 12, end: 18, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } } },
  ] }
  const fields = createTextFields(e, 'Фраза')
  assert.deepEqual(fields.map(s => s.defaultText), ['Новый', 'важный', 'текст'])
  fillTextFields(e, fields, Object.fromEntries(fields.map((s, i) => [s.id, ['Наш', 'главный', 'результат'][i]])))
  assert.equal(e.text, 'Наш главный результат')
  const accent = e.colorRuns![1]
  assert.equal(e.text.slice(accent.start, accent.end), 'главный')
  assert.equal(e.styleRuns?.length, 1)
})

test('links, crossing source ranges and split Unicode characters remain unsupported', () => {
  const e = text('Ссылка')
  e.linkRuns = [{ start: 0, end: 6, url: 'https://example.org' }]
  assert.deepEqual(createTextFields(e, 'Текст'), [])
  const overlap = { ...text('Текст'), styleRuns: [run(0, 3), run(2, 5, 30)] }
  assert.deepEqual(createTextFields(overlap, 'Текст'), [])
  const unicode = { ...text('😀 текст'), styleRuns: [run(0, 1, 30), run(1, 8)] }
  assert.deepEqual(createTextFields(unicode, 'Текст'), [])
})
