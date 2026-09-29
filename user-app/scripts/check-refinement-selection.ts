/** Reproduce a region inside the user's saved slide, without product writes. */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { regionSources } from '../lib/design-system/refinement-coverage'
import { readSourceScene } from '../lib/design-system/source-scene'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
const visual: VisualManifest = JSON.parse(await readFile('outputs/diagnostics/refinement-selection/visual.json', 'utf8'))
const scene = readSourceScene(visual.snapshot)
for (const slide of [2, 5, 9]) console.log(JSON.stringify({ slide, objects: [...scene.records.values()].filter(r => r.source.slide === slide && !('children' in r.element)).map(r => ({ id: r.element.id, kind: r.element.kind, bounds: r.bounds, disposition: r.disposition, ...('assetId' in r.element ? { assetId: r.element.assetId } : {}) })) }))
const sources = regionSources(visual.snapshot, 9, { x: .415, y: .24, width: .544, height: .235 })
assert.ok(sources.length, 'The visibly selected card must have source evidence')
console.log(JSON.stringify({ accepted: true, sources }))
