import test from 'node:test'
import assert from 'node:assert/strict'
import { familyFixture } from '../component-lab/family-fixtures'
import { sourceCandidate, digest } from '../lib/component-lab/source'
import { auditSourceFidelity } from '../lib/component-lab/fidelity'

export function panelMediaFixture() {
  const t = familyFixture('media'), l = t.sourceLayout!
  t.sourceIds.push('panel'); l.graphicIds.push('panel'); l.structure!.panels = 2
  const background = `<g transform="translate(0 0)"><svg viewBox="0 0 ${t.width} ${t.height}" width="${t.width}" height="${t.height}"><rect data-source-object="panel" width="${t.width}" height="${t.height}" rx="12" fill="#efeddd"/></svg></g>`
  l.graphic = l.graphic.replace(/(<svg[^>]*>)/, `$1${background}`)
  return t
}
test('a card separates its background from masked artwork without losing source properties', async () => {
  const t = panelMediaFixture(), before = structuredClone(t), c = await sourceCandidate(t, 'unrelated')
  assert.equal(c.profile?.family, 'media-text', c.reason)
  assert.match(c.profile.source.graphic, /data-source-object="panel"/)
  assert.doesNotMatch(c.profile.source.graphic, /illustration/)
  assert.deepEqual(c.profile.artwork!.ids, ['illustration'])
  assert.equal((await auditSourceFidelity(t, c.profile, c.content!)).status, 'preserved')
  assert.deepEqual(t, before)
  const corrupt = structuredClone(c.profile)
  corrupt.artwork!.svg = corrupt.artwork!.svg.replace('#b45834', '#000000')
  corrupt.artwork!.hash = await digest(corrupt.artwork!.svg)
  assert.equal((await auditSourceFidelity(t, corrupt, c.content!)).status, 'failed')
})
test('ambiguous foreground panels and actual text-art overlap are not called adaptive', async () => {
  const t = panelMediaFixture(), l = t.sourceLayout!
  l.text[0].element.bounds.x = 10
  assert.match((await sourceCandidate(t, 'x')).reason!, /пересекается/)
  const order = panelMediaFixture(), graphic = order.sourceLayout!.graphic
  const panel = graphic.match(/<g transform="translate\(0 0\)"><svg[^>]*><rect[^>]*\/><\/svg><\/g>/)![0]
  order.sourceLayout!.graphic = graphic.replace(panel, '').replace(/<\/svg>$/, panel + '</svg>')
  assert.equal((await sourceCandidate(order, 'x')).profile, undefined)
})
