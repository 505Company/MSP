import test from 'node:test'
import assert from 'node:assert/strict'
import { componentFingerprint, componentUsage, curateComponents } from '../lib/design-system/component-curation'
import type { ComponentDefinition } from '../lib/design-system/types'
import type { ElementIR, TextElementIR } from '../vendor/drag/src/core/model'

function component(id = 'one', name = 'Фигура'): ComponentDefinition {
  const leaf: ElementIR = { id, name, kind: 'rectangle', bounds: { x: 40, y: 70, width: 200, height: 80 }, visible: true, opacity: 1, rotation: 0, zIndex: 3, fill: { type: 'solid', color: { r: .1, g: .3, b: .7, a: 1 } } }
  return { id, name, kind: 'atom', source: { slide: 1, rootId: id, elementIds: [id], ancestorIds: [], assetIds: [] }, slots: [], fixedTextIds: [], issues: [], semantics: [],
    scene: { width: 200, height: 80, elements: [{ id: 'viewport-' + id, name, kind: 'group', bounds: { x: -40, y: -70, width: 200, height: 80 }, visible: true, opacity: 1, rotation: 0, zIndex: 0, children: [leaf] }] } }
}
function leaf(c: ComponentDefinition) { const root = c.scene.elements[0]; assert.ok('children' in root); return root.children[0] }
function textComponent(text: string, editable = true) {
  const c = component(text, 'Заголовок'), base = leaf(c)
  const t: TextElementIR = { ...base, kind: 'text', text, fontFamily: 'Arial', fontSize: 24, fontStyle: 'Bold', styleRuns: [{ start: 0, end: text.length, fontFamily: 'Arial', fontSize: 24, fontStyle: 'Bold' }] }
  const root = c.scene.elements[0]; assert.ok('children' in root); root.children = [t]
  if (editable) c.slots = [{ id: text, elementId: t.id, label: 'Заголовок', defaultText: text, policy: 'fixed-box', maxLength: 5000 }]
  else c.fixedTextIds = [t.id]
  return c
}

test('renamed and moved instances merge without mutating immutable source definitions', () => {
  const a = component(), b = component('two', 'Другое имя')
  b.source.slide = 5; leaf(b).bounds.x += 150; b.scene.elements[0].bounds.x -= 150
  const before = structuredClone([a, b]), selected = curateComponents([a, b])
  assert.equal(selected.components.length, 1)
  assert.deepEqual(selected.components[0].occurrenceIds, ['one', 'two'])
  assert.deepEqual(selected.components[0].slides, [1, 5])
  assert.deepEqual([a, b], before)
})

test('different colors, size, opacity, rotation, crops and internal arrangement remain distinct', () => {
  const original = component(), variants = [
    (c: ComponentDefinition) => { const e = leaf(c); assert.ok('fill' in e); e.fill!.color.r = .8 },
    (c: ComponentDefinition) => { c.scene.width += 1 },
    (c: ComponentDefinition) => { c.scene.elements[0].opacity = .5 },
    (c: ComponentDefinition) => { c.scene.elements[0].rotation = 15 },
    (c: ComponentDefinition) => { const e = leaf(c); assert.ok('fill' in e); e.clipBounds = { x: 0, y: 0, width: 20, height: 30 } },
    (c: ComponentDefinition) => { leaf(c).bounds.x += 10 },
  ]
  for (const mutate of variants) {
    const c = structuredClone(original); mutate(c)
    assert.notEqual(componentFingerprint(original), componentFingerprint(c))
  }
})

test('only plain confirmed backgrounds leave the catalog; gradients, illustrations and panels survive', () => {
  const flat = component('flat', 'Фон'), gradient = component('gradient', 'Фон'), panel = component('panel', 'Подложка карточки')
  const e = leaf(gradient); assert.ok('fill' in e)
  e.gradient = { type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, stops: [{ position: 0, color: { r: 0, g: 0, b: 1, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] }
  const selected = curateComponents([flat, gradient, panel])
  assert.deepEqual(selected.omitted, [{ id: 'flat', reason: 'solid-background' }])
  assert.deepEqual(selected.components.map(c => c.id), ['gradient', 'panel'])
  assert.ok(selected.components[0].tags.includes('background'))
})

test('whole plain editable fields ignore example copy, while fixed and rich copy remain distinct', () => {
  const a = textComponent('Первый заголовок'), b = textComponent('Второй')
  assert.equal(componentFingerprint(a), componentFingerprint(b))
  assert.notEqual(componentFingerprint(textComponent('Первая подпись', false)), componentFingerprint(textComponent('Вторая подпись', false)))
  const rich = textComponent('Два стиля')
  const t = leaf(rich) as TextElementIR
  t.styleRuns = [{ start: 0, end: 3, fontFamily: 'Arial', fontSize: 24, fontStyle: 'Bold' }, { start: 3, end: t.text.length, fontFamily: 'Arial', fontSize: 24, fontStyle: 'Regular' }]
  assert.notEqual(componentFingerprint(a), componentFingerprint(rich))
})

test('different image resources remain separate and get tags usable by the generator', () => {
  const a = component('photo-a', 'Фото команды'), b = component('photo-b', 'Фото команды')
  for (const c of [a, b]) {
    const root = c.scene.elements[0]; assert.ok('children' in root)
    root.children = [{ ...leaf(c), kind: 'raster', assetId: c.id, reason: 'original' }]
    c.source.assetIds = [c.id]; c.semantics = [{ findingId: c.id, name: c.name, role: 'photo', basis: 'visual_observation' }]
  }
  assert.equal(curateComponents([a, b]).components.length, 2)
  assert.deepEqual(componentUsage(a).tags, ['photo'])
})

test('blocking definitions are omitted; source warnings do not remove usable components', () => {
  const blocked = component('blocked'), usable = component('usable')
  blocked.issues.push({ code: 'effects', message: 'Unsupported' })
  usable.issues.push({ code: 'source-warning', severity: 'warning', message: 'Compare with source' })
  const selected = curateComponents([blocked, usable])
  assert.deepEqual(selected.components.map(c => c.id), ['usable'])
  assert.deepEqual(selected.omitted, [{ id: 'blocked', reason: 'unsupported' }])
})
