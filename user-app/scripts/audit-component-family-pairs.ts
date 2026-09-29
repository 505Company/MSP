/** Read-only cross-family check of the exported live VK evidence. */
import fs from 'node:fs'
import { equivalentVariant, type CalibratedCatalog, type ComponentQualification } from '../lib/design-system/calibration-contract'
import type { ComponentDefinition } from '../lib/design-system/types'

const directory = 'outputs/stage-5-calibration'
const catalog: CalibratedCatalog = JSON.parse(fs.readFileSync(`${directory}/catalog.json`, 'utf8'))
const source: { library: { components: ComponentDefinition[] } } = JSON.parse(fs.readFileSync('outputs/q1-refinement/published-library.json', 'utf8'))
const signatures: ComponentQualification[] = JSON.parse(fs.readFileSync(`${directory}/signatures.json`, 'utf8'))
const definitions = new Map(source.library.components.map(c => [c.id, c]))
const reports = new Map(signatures.map(q => [q.componentId, q]))
const variants = catalog.families.flatMap(f => f.variants.map(v => ({ family: f.name, id: v.id })))
const matches: { family: string; id: string }[][] = []
for (let i = 0; i < variants.length; i++) for (let j = i + 1; j < variants.length; j++) {
  const a = variants[i], b = variants[j]
  if (a.family !== b.family && equivalentVariant(definitions.get(a.id)!, definitions.get(b.id)!, reports.get(a.id)!, reports.get(b.id)!)) matches.push([a, b])
}
const result = { calibrationId: catalog.id, families: catalog.families.length, variants: variants.length, matches }
fs.writeFileSync(`${directory}/cross-family-duplicates.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
