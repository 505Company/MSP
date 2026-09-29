import test from 'node:test'
import assert from 'node:assert/strict'
import { unzlibSync } from 'fflate'
import { memoryBucket } from './helpers/memory-bucket'
import { installSemanticCatalog } from '../lib/design-system/catalog'
import { reconstructCandidate, reconstructionState } from '../lib/design-system/reconstruction'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../lib/design-system/editable-contract'
import { RECONSTRUCTION_VERSION } from '../lib/design-system/reconstruction-contract'
import { readModelRun } from '../lib/uploads/model-run'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import type { ComponentLibrary } from '../lib/design-system/types'

const config = { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test' }
const reply = { kind: 'illustration', name: 'Source illustration', description: 'Preserved', rotations: [0], allowRecolor: false, reason: 'Not a repeated pattern' }
async function fixture() {
 const { bucket, data } = memoryBucket()
 const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'source', name: 'Graphics', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [], slides: [{ id: 's1', number: 1, width: 1000, height: 500, part: 'slide1', text: '', warnings: [] }], elements: [] }
 const components: ComponentLibrary['components'] = [1, 2].map(n => {
  const element = { id: `image-${n}`, name: 'Image', kind: 'raster' as const, bounds: { x: n * 100, y: 0, width: 200, height: 200 }, rotation: 0, opacity: 1, visible: true, zIndex: n, assetId: `asset-${n}`, reason: 'source-image' }
  snapshot.assets.push({ id: element.assetId, mime: 'image/png', byteLength: 9, origins: [] })
  snapshot.elements.push({ id: element.id, slide: 1, kind: element.kind, name: element.name, properties: element })
  return { id: `component-${n}`, name: 'Graphic', kind: 'atom', source: { slide: 1, rootId: element.id, elementIds: [element.id], ancestorIds: [], assetIds: [element.assetId] }, scene: { width: 200, height: 200, elements: [element] }, slots: [], fixedTextIds: [], issues: [], semantics: [{ findingId: 'test', name: 'Graphic', role: 'illustration', basis: 'visual_observation' }] }
 })
 await installSemanticCatalog(bucket, 'test', { schemaVersion: 1, compilerVersion: 'fixture', sourceId: 'source', name: 'Graphics', tokens: { colors: [], fonts: [] }, components, excluded: [], notes: [] }, { version: 'fixture', sourceRevision: 'source', coverage: { records: 2, processed: 2, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] })
 await bucket.put('visual/test/manifest.json', JSON.stringify({ snapshot }))
 for (const n of [1, 2]) await bucket.put(`visual/test/asset-${n}`, new Uint8Array([1, 2, 3]))
 await bucket.put(`editable-systems/test/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: 'editable' }))
 await bucket.put('editable', JSON.stringify({ version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, id: 'cards', sourceRevision: 'source', families: [] }))
 const initial = await reconstructionState(bucket, 'test'), rgba = new Uint8Array(32 * 24 * 4)
 for (let i = 0; i < rgba.length; i += 4) { rgba[i] = i % 255; rgba[i + 2] = 128; rgba[i + 3] = 255 }
 const input = { revision: initial.revision, candidateId: initial.pending[0].id, pixels: { width: 32, height: 24, rgba: Buffer.from(rgba).toString('base64') } }
 return { bucket, data, input, initial, rgba }
}

test('a rejected graphic is recorded once and does not stop the next candidate', async t => {
 const { bucket, input, initial } = await fixture(); let calls = 0
 t.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? new Response('Rejected image', { status: 400 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] }) })
 const failed = await reconstructCandidate(bucket, 'test', input, config)
 assert.equal(failed.status, 'retained'); assert.match(failed.reason, /400/)
 assert.equal((await reconstructionState(bucket, 'test')).completed, 1)
 const resumed = await reconstructCandidate(bucket, 'test', { ...input, candidateId: initial.pending[1].id }, config)
 assert.equal(resumed.status, 'retained'); assert.equal(resumed.name, reply.name)
 assert.equal((await reconstructionState(bucket, 'test')).pending.length, 0)
 assert.deepEqual(await reconstructCandidate(bucket, 'test', input, config), failed)
 assert.equal(calls, 2)
})

test('an old rejected image is retained without another paid request after a crash', async t => {
 const { bucket, input } = await fixture(), prefix = `reconstructions/test/${RECONSTRUCTION_VERSION}/models/${input.candidateId}`
 await bucket.put(`${prefix}/current.json`, JSON.stringify({ runId: 'failed' }))
 await bucket.put(`${prefix}/runs/failed.json`, JSON.stringify({ id: 'failed', status: 'failed', error: { code: 'QWEN_HTTP_400' } }))
 t.mock.method(globalThis, 'fetch', async () => { throw Error('Must not request again') })
 const result = await reconstructCandidate(bucket, 'test', input, config)
 assert.equal(result.status, 'retained'); assert.equal(result.modelRunId, 'failed'); assert.match(result.reason, /400/)
})

test('the model receives exactly the measured RGBA preview, not an unrelated original-size image', async t => {
 const { bucket, input, rgba } = await fixture()
 t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), content = body.messages[1].content
  const image = Buffer.from(content.find((x: { type: string }) => x.type === 'image_url').image_url.url.split(',')[1], 'base64')
  assert.equal(image.subarray(1, 4).toString(), 'PNG')
  assert.equal(image.readUInt32BE(16), 32); assert.equal(image.readUInt32BE(20), 24)
  const chunks = []; for (let offset = 8; offset < image.length;) { const length = image.readUInt32BE(offset); if (image.subarray(offset + 4, offset + 8).toString() === 'IDAT') chunks.push(image.subarray(offset + 8, offset + 8 + length)); offset += 12 + length }
  const decoded = unzlibSync(Buffer.concat(chunks)); for (let y = 0; y < 24; y++) { assert.equal(decoded[y * 129], 0); assert.deepEqual(decoded.slice(y * 129 + 1, (y + 1) * 129), rgba.slice(y * 128, (y + 1) * 128)) }
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] })
 })
 await reconstructCandidate(bucket, 'test', input, config)
})

for (const status of [401, 403, 429, 500]) test(`a shared provider failure ${status} is not silently skipped`, async t => {
 const { bucket, input } = await fixture()
 t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status }))
 await assert.rejects(reconstructCandidate(bucket, 'test', input, config), { code: `QWEN_HTTP_${status}` })
 assert.equal((await reconstructionState(bucket, 'test')).completed, 0)
})

test('transport preview correction reuses a successful recognition with identical source scope and geometry', async t => {
 const { bucket, input, initial, data } = await fixture(); let calls = 0
 t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] }) })
 await reconstructCandidate(bucket, 'test', input, config)
 const prefix = `reconstructions/test/${RECONSTRUCTION_VERSION}/models/${input.candidateId}`, run = (await readModelRun(bucket, prefix))!
 const key = `${prefix}/inputs/${run.inputHash}.json`, saved = await (await bucket.get(key))!.json<{ task: { messages: { content: { type: string; image_url?: { url: string } }[] }[] } }>()
 saved.task.messages[1].content.find(c => c.type === 'image_url')!.image_url!.url = 'data:image/png;base64,bGVnYWN5'
 await bucket.put(key, JSON.stringify(saved))
 for (const entry of [...data.keys()]) if (entry.startsWith(`${prefix}/cache/`)) data.delete(entry)
 await bucket.delete(`reconstructions/test/${RECONSTRUCTION_VERSION}/${initial.revision}/results/${input.candidateId}.json`)
 const replay = await reconstructCandidate(bucket, 'test', input, config)
 assert.equal(replay.modelRunId, run.id); assert.equal(calls, 1)
})
