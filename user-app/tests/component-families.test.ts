import test from 'node:test'
import assert from 'node:assert/strict'
import { familyFixture } from '../component-lab/family-fixtures'
import { sourceCandidate } from '../lib/component-lab/source'
import { safeGraphic, graphicParts } from '../lib/component-lab/artwork'

test('families derive from native structure across unrelated styles without changing their sources', async () => {
  for (const [kind, family] of [['bare', 'number-caption'], ['badge', 'ordinal-caption'], ['media', 'media-text'], ['quote', 'quote-author']] as const) {
    const t = familyFixture(kind), original = JSON.stringify(t), c = await sourceCandidate(t, 'unrelated-catalog')
    assert.equal(c.profile?.family, family, c.reason); assert.equal(JSON.stringify(t), original)
    assert.equal(c.profile.source.graphic, '')
    if (kind === 'badge') assert.equal(c.profile.artwork?.field, c.profile.fields[0].id)
    if (kind === 'media') { assert.equal(c.profile.artwork?.width, 180); assert.match(c.profile.artwork!.svg, /clip-path/); assert.match(c.profile.artwork!.svg, /#b45834/) }
  }
})
test('unsafe artwork, unbound badges and overlapping illustrations are rejected rather than discarded', async () => {
  for (const svg of ['<svg><script/></svg>', '<svg><image href="https://example.com/x"/></svg>', '<svg><path style="fill:red"/></svg>', '<svg><g onload="x"/></svg>', '<svg><path></svg>']) assert.equal(safeGraphic(svg), false)
  const t = familyFixture('media'); t.sourceLayout!.text[0].element.bounds.x = 0
  assert.match((await sourceCandidate(t, 'x')).reason!, /пересекается/)
  const badge = familyFixture('badge'); badge.sourceLayout!.text[0].element.bounds.x = 130
  assert.equal((await sourceCandidate(badge, 'x')).profile, undefined)
  assert.deepEqual(graphicParts('<svg></svg>'), [])
})
