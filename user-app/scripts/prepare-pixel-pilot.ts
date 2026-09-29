import { readFile } from 'node:fs/promises'
import { applicationSnapshot, digest, loadJson, saveJson } from './pixel-pilot-store'
import { layoutContext } from '../lib/presentations/layout-context'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { adaptiveComponents } from '../lib/presentations/adaptive-components'
import { prepareMaterial } from '../lib/presentations/material'

const output = 'outputs/diagnostics/qwen-pixel-service'
if (await loadJson(`${output}/source.json`)) throw Error('Source snapshot already exists; never overwrite an experiment input')
const projectId = '49cb55b7-2619-4405-b75a-c75c3e80882d'
const { rows, read, bucket } = applicationSnapshot()
const modelRow = rows.find(r => r.key.startsWith(`presentation-layouts/${projectId}/`) && r.key.includes('/plan/runs/'))!
const { model } = await read(modelRow.key)
const context = await layoutContext(bucket, projectId, model)
const catalog = await readEditableCatalog(bucket, context.uploadId)
const raw = await readFile('tests/fixtures/pixel-service.txt', 'utf8'), material = await prepareMaterial(raw)
const input = { ...context.inputs[0], slideId: 'custom-service', title: material.fragments[0].text, directions: [], content: material.fragments.map(f => ({ id: f.id, text: f.text })) }
const pass = new Set(catalog?.qualification?.checks.filter(c => c.passed).map(c => c.id))
const compositions = catalog!.families.flatMap(f => f.variants).filter(t => t.kind === 'composition' && pass.has(t.id))
const snapshot = { version: 'qwen-pixel-pilot-1', model, catalogId: catalog!.id, raw, input, compositions, materialId: material.id }
await saveJson(`${output}/source.json`, snapshot)
console.log(JSON.stringify({ model, catalogId: catalog!.id, sourceHash: digest(raw), fragments: input.content.length,
  components: adaptiveComponents(input).length, compositions: compositions.length,
}))
