import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceGraphic } from '../lib/design-system/editable-source'
import { readSourceScene } from '../lib/design-system/source-scene'
import { safeGraphic, graphicParts } from '../lib/component-lab/artwork'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { graphicHtml } from '../lib/design-system/diagram-graph'

export const gradientFixture = (type: 'linear' | 'radial' = 'linear'): SourceSnapshot => ({
 schemaVersion: 1, sourceId: 'gradients', name: 'Gradient', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [],
 slides: [{ id: 's1', number: 1, width: 200, height: 100, part: 'slide1', text: '', warnings: [] }],
 elements: [{ id: 'panel', name: 'Panel', slide: 1, kind: 'rectangle', properties: { bounds: { x: 0, y: 0, width: 200, height: 100 }, rotation: 0, opacity: 1, visible: true, zIndex: 0, gradient: { type, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, stops: [{ position: 0, color: { r: 0, g: .7, b: 1, a: .6 } }, { position: 1, color: { r: .2, g: .3, b: 1, a: 1 } }] } } }],
})
for (const type of ['linear', 'radial'] as const) test(`diagram HTML retains native ${type} gradient stops and transparency`, () => {
 const scene = readSourceScene(gradientFixture(type)), html = graphicHtml(scene.roots, 200, 100, 'test')
 assert.match(html, new RegExp(`<${type}Gradient`)); assert.match(html, /stop-opacity="0.6"/)
 assert.match(html, /fill="url\(#/)
 assert.match(html, /fill-opacity="1"/)
})
for (const type of ['linear', 'radial'] as const) test(`native ${type} gradients survive the SVG and adaptive artwork contracts`, () => {
 const svg = sourceGraphic(readSourceScene(gradientFixture(type)), 'panel', 'test')
 assert.match(svg, new RegExp(`<${type}Gradient`)); assert.match(svg, /stop-opacity="0.6"/)
 assert.equal(safeGraphic(svg), true)
 const parts = graphicParts(`<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(0 0)">${svg.replace('width="100%" height="100%"', 'width="200" height="100"')}</g></svg>`)
 assert.equal(parts?.length, 1); assert.deepEqual(parts?.[0].ids, ['panel'])
 assert.equal(safeGraphic(svg.replace(/fill="url\(#[^)]+\)"/, 'fill="url(https://example.test/evil.svg)"')), false)
})
