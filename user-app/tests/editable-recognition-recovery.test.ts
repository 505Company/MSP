import test from 'node:test'
import assert from 'node:assert/strict'
import { editableRecognitionTask, editableState, buildEditableSystem, validateRecognitionReply, compileEditableSlides } from '../lib/design-system/editable-analysis'
import { sourceCoverage } from '../lib/design-system/component-intent'
import { readSourceScene } from '../lib/design-system/source-scene'
import { initializeCatalog } from '../lib/design-system/catalog'
import { memoryBucket } from './helpers/memory-bucket'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import type { EditableTemplate } from '../lib/design-system/editable-contract'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../lib/design-system/editable-contract'

function source(): SourceSnapshot {
  return { schemaVersion: 1, sourceId: 'd'.repeat(64), name: 'Cover', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [],
    slides: [{ id: 's01', number: 1, width: 960, height: 540, part: 'ppt/slides/slide1.xml', text: '', warnings: [] }],
    elements: [{ id: 'background', name: 'Background', kind: 'rectangle', slide: 1,
      properties: { bounds: { x: 0, y: 0, width: 960, height: 540 }, visible: true, opacity: 1, rotation: 0, zIndex: 0, fill: { type: 'solid', color: { r: 0, g: 0.47, b: 1, a: 1 } } } }] }
}
type Schema = { required?: string[]; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; enum?: string[]; const?: string; minItems?: number; maxItems?: number }
async function fixture(snapshot = source()) {
  const { bucket, data } = memoryBucket()
  const visual = { snapshot, previews: [{ id: 's01', mime: 'image/png' }] } as VisualManifest
  await initializeCatalog(bucket, 'import', snapshot)
  await bucket.put('visual/import/manifest.json', JSON.stringify(visual))
  await bucket.put('visual/import/preview-s01', 'preview')
  return { bucket, data, visual }
}

test('editable construction skips unreadable source pages and publishes their omission without a model call',async t=>{
  const s=source();s.slideCount=2;s.slides.push({...s.slides[0],id:'s02',number:2,warnings:['normalized-page-unavailable (page-image-byte-limit)']})
  const {bucket}=await fixture(s),state=await editableState(bucket,'import')
  assert.deepEqual(state.jobs.flatMap(j=>j.slides),[1])
  const part={id:state.jobs[0].id,slides:[1],reply:{slides:[{slide:1,blocks:[],note:'Complete page'}]},runId:'saved',liveRequests:0}
  await bucket.put(`editable-systems/import/${EDITABLE_VERSION}/${state.revision}/parts/${part.id}.json`,JSON.stringify(part))
  t.mock.method(globalThis,'fetch',async()=>{throw Error('No model required for saved parts')})
  const final=await editableState(bucket,'import')
  assert.ok(final.catalog);assert.deepEqual(final.catalog!.coverage.map(s=>s.slide),[1])
  assert.deepEqual(final.catalog!.omissions?.[0].slides,[2])
})

test('a compiler upgrade rebuilds completed parts locally without changing recognition evidence or calling the model', async t => {
  const { bucket, data } = await fixture(), initial = await editableState(bucket, 'import')
  const root = `editable-systems/import/${EDITABLE_VERSION}`, prefix = `${root}/${initial.revision}`
  const part = { id: initial.jobs[0].id, slides: [1], reply: { slides: [{ slide: 1, blocks: [], note: 'Background source', objectRoles: [{ sourceId: 'background', role: 'background', reason: 'Native slide fill' }] }] }, runId: 'saved', liveRequests: 1 }
  await bucket.put(`${prefix}/parts/${part.id}.json`, JSON.stringify(part))
  const evidence = data.get(`${prefix}/parts/${part.id}.json`)!.value
  await bucket.put(`${root}/current.json`, JSON.stringify({ key: 'old-catalog' }))
  const old = JSON.stringify({ version: EDITABLE_VERSION, compilerVersion: 'editable-html-compiler-13', id: 'old', sourceRevision: initial.revision, families: [] })
  await bucket.put('old-catalog', old)
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Local compiler upgrades cannot call a model') })
  const replay = await editableState(bucket, 'import')
  assert.equal(replay.catalog?.compilerVersion, EDITABLE_COMPILER_VERSION)
  assert.equal(replay.jobs.length, 0)
  assert.deepEqual(replay.catalog?.modelRunIds, ['saved'])
  assert.equal(data.get(`${prefix}/parts/${part.id}.json`)!.value, evidence)
  assert.equal(await (await bucket.get('old-catalog'))!.text(), old)
})

test('the new import response grammar requires the ledger even on a slide without components', async () => {
  const { bucket, visual } = await fixture()
  const task = await editableRecognitionTask(bucket, 'import', { visual, native: [] }, { slides: [1] })
  const slide = (task.schema as Schema).properties!.slides.items!
  assert.ok(slide.required?.includes('objectRoles'), 'A grammar-valid empty slide must still account for its source objects')
  for (const branch of slide.properties!.blocks.items!.anyOf!) {
    if (branch.properties!.kind.enum!.some(k => ['text', 'metric', 'feature'].includes(k))) {
      assert.ok(branch.required?.includes('adaptation'), 'Reusable text blocks require semantic intent in the response grammar')
      const intents = branch.properties!.adaptation.anyOf!
      assert.deepEqual(intents.map(b => b.properties!.family.const), ['fixed'], 'A slide without native text cannot acquire invented text fields')
      assert.equal(intents[0].properties!.fields.maxItems, 0)
    }
  }
})

test('fresh recognition requires table cells and chart series, and keeps native data as a separate path', async () => {
  const { bucket, visual } = await fixture()
  const branches = async (native: EditableTemplate[] = []) => {
    const task = await editableRecognitionTask(bucket, 'import', { visual, native }, { slides: [1] })
    return (task.schema as Schema).properties!.slides.items!.properties!.blocks.items!.anyOf!
  }
  const fromShapes = await branches()
  for (const [kind, required] of [['table', ['columns', 'rows']], ['chart', ['categories', 'series']]] as const) {
    const choices = fromShapes.filter(b => b.properties!.kind.enum!.includes(kind))
    assert.equal(choices.length, 1)
    for (const field of required) {
      assert.ok(choices[0].properties!.data.required?.includes(field), `${kind} must request ${field} before validation`)
      assert.equal(choices[0].properties!.data.properties![field].minItems, 1)
    }
    assert.ok(!choices[0].properties!.dataStatus.enum?.includes('native'))
    assert.equal(choices[0].properties!.data.properties!.items, undefined, 'Totals and chart values cannot go into an unrendered items field')
  }
  assert.ok(fromShapes.find(b => b.properties!.kind.enum!.includes('chart'))!.properties!.config.required?.includes('chartType'))
  const native = { id: 'native-table', slide: 1, kind: 'table', sourceIds: ['background'] } as EditableTemplate
  const withNative = (await branches([native])).filter(b => b.properties!.kind.enum!.includes('table'))
  assert.equal(withNative.length, 2, 'Cells from a supplied native table must not be transcribed by the model')
  const direct = withNative.find(b => b.properties!.dataStatus.enum?.join(',') === 'native')!
  assert.deepEqual(direct.properties!.data.properties, {})
  const after = await branches()
  assert.equal(after.filter(b => b.properties!.kind.enum!.includes('table')).length, 1, 'Context must not leak to another request')
})

test('adaptive fields can reference only supplied native text, never a raster or shape', async () => {
  const snapshot = source(), properties = { bounds: { x: 20, y: 20, width: 300, height: 60 }, visible: true, opacity: 1, rotation: 0, zIndex: 1 }
  snapshot.elements.push(
    { id: 'native-text', name: 'Caption', kind: 'text', slide: 1, properties: { ...properties, text: 'A real caption', fontFamily: 'Arial', fontSize: 24 } },
    { id: 'picture', name: 'Text inside an image', kind: 'raster', slide: 1, properties: { ...properties, source: '/picture.png' } },
  )
  const { bucket, visual } = await fixture(snapshot)
  const task = await editableRecognitionTask(bucket, 'import', { visual, native: [] }, { slides: [1] })
  const branches = (task.schema as Schema).properties!.slides.items!.properties!.blocks.items!.anyOf!
  for (const branch of branches) {
    assert.ok(branch.properties!.adaptation.anyOf, 'Every optional intent uses the same native field contract')
    for (const intent of branch.properties!.adaptation.anyOf!) {
      if (intent.properties!.family.const === 'fixed') continue
      assert.deepEqual(intent.properties!.fields.items!.properties!.sourceId.enum, ['native-text'])
      if (intent.properties!.family.const === 'title-body') {
        assert.equal(intent.properties!.fields.minItems, 2, 'A title alone is not a title/body pair')
        assert.equal(intent.properties!.fields.maxItems, 2)
      }
    }
  }
})

test('the import completes when Qwen follows its response grammar, without a manual restart', async t => {
  const { bucket, data } = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++
    const request = JSON.parse(String(init?.body)), slideSchema = request.response_format.json_schema.schema.properties.slides.items as Schema
    // Reproduce the saved VK answer: it describes roles in note, but omits an
    // optional objectRoles field. A required response field removes this path.
    const roles = slideSchema.required?.includes('objectRoles') ? { objectRoles: { background: ['background'], decoration: [], context: [], unresolved: [] } } : {}
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ slides: [{ slide: 1, blocks: [], ...roles, note: 'The slide background is accounted for.' }] }) } }] })
  })
  const catalog = await buildEditableSystem(bucket, 'import', { apiKey: 'test', model: 'test', baseUrl: 'https://example.test/v1' })
  assert.equal(catalog.coverage[0].objects?.complete, true)
  assert.equal(calls, 1)
  assert.ok([...data.keys()].some(k => k.includes('/parts/slides-1.json')))
  assert.equal((await buildEditableSystem(bucket, 'import', { apiKey: 'test', model: 'test', baseUrl: 'https://example.test/v1' })).id, catalog.id)
  assert.equal(calls, 1, 'Completed work survives resuming')
})

function groupedSource() {
  const snapshot = source(), properties = { bounds: { x: 0, y: 0, width: 300, height: 100 }, visible: true, opacity: 1, rotation: 0, zIndex: 1 }
  snapshot.elements.push(
    { id: 'heading-group', name: 'Heading group', kind: 'group', slide: 1, properties },
    { id: 'heading', name: 'Heading', kind: 'text', slide: 1, parentId: 'heading-group', properties: { ...properties, text: 'A grouped heading', fontFamily: 'Arial', fontSize: 24 } },
    { id: 'unrelated-group', name: 'Unrelated group', kind: 'group', slide: 1, properties },
  )
  const slide = { slide: 1, blocks: [], note: 'The heading is slide context.', objectRoles: { background: ['background'], decoration: [], context: ['heading-group', 'heading'], unresolved: [] } }
  const scene = readSourceScene(snapshot)
  assert.equal(scene.invalid.size, 0)
  return { snapshot, slide, scene, supplied: ['background', 'heading'] }
}

test('recognition accepts a disclosed parent group and its child as the same source role, without changing the reply', async () => {
  const { snapshot, slide } = groupedSource(), raw = { slides: [slide] }, before = JSON.stringify(raw)
  const parsed = validateRecognitionReply(raw, snapshot, [1], [])
  const compiled = await compileEditableSlides(snapshot, parsed.slides, 'import', [])
  assert.equal(compiled.coverage[0].objects?.complete, true)
  assert.deepEqual(compiled.coverage[0].objects?.context, ['heading'])
  assert.equal(JSON.stringify(raw), before)
})

test('group roles account for their supplied children but still reject conflicting ownership and unknown groups', () => {
  const { slide, scene, supplied } = groupedSource()
  slide.objectRoles.context = ['heading-group']
  assert.equal(sourceCoverage(slide, supplied, scene).complete, true, 'The supplied parent relation accounts for the child')
  assert.ok(sourceCoverage({ ...slide, blocks: [{ sourceIds: ['heading'] }] }, supplied, scene).issues.includes('overlapping-source-disposition'))
  assert.ok(sourceCoverage({ ...slide, objectRoles: { ...slide.objectRoles, decoration: ['heading'] } }, supplied, scene).issues.includes('overlapping-source-disposition'))
  assert.ok(sourceCoverage({ ...slide, objectRoles: { ...slide.objectRoles, context: ['heading', 'heading'] } }, supplied, scene).issues.includes('overlapping-source-disposition'))
  for (const id of ['invented-group', 'unrelated-group']) {
    const result = sourceCoverage({ ...slide, objectRoles: { ...slide.objectRoles, context: [id] } }, supplied, scene)
    assert.ok(result.issues.includes(`unknown-disposition:${id}`))
    assert.deepEqual(result.unassigned, ['heading'])
  }
})

test('one malformed adaptive block is skipped while its neighbour is published and retained on resume', async t => {
  const snapshot=source()
  for(const [i,id] of ['good','bad'].entries())snapshot.elements.push({id,name:id,kind:'text',slide:1,properties:{bounds:{x:40+i*420,y:80,width:380,height:90},visible:true,opacity:1,rotation:0,zIndex:1,text:id,fontFamily:'Arial',fontSize:24}})
  const {bucket}=await fixture(snapshot);let calls=0
  const block=(id:string)=>({id,name:id,description:'Текстовая карточка',tags:['текст'],kind:'text',sourceIds:[id],memberIds:[],style:{},config:{},data:{title:id},dataStatus:'readable',adaptation:{version:'component-intent-1',family:'fixed',fields:[],layouts:[],rationale:'Отдельный исходный заголовок'}})
  const bad={...block('bad'),adaptation:undefined}
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({slides:[{slide:1,blocks:[block('good'),bad],objectRoles:{background:['background'],decoration:[],context:[],unresolved:[]},note:''}]})}}]})})
  const config={apiKey:'test',model:'test',baseUrl:'https://example.test/v1'},catalog=await buildEditableSystem(bucket,'import',config)
  assert.equal(calls,2);assert.equal(catalog.families.flatMap(f=>f.variants).filter(v=>v.sourceIds.includes('good')).length,1)
  assert.equal(catalog.families.flatMap(f=>f.variants).some(v=>v.sourceIds.includes('bad')),false)
  assert.ok(catalog.omissions?.some(o=>o.elementIds.includes('bad')))
  assert.deepEqual(catalog.coverage[0].objects?.unresolved,['bad'])
  assert.equal((await buildEditableSystem(bucket,'import',config)).id,catalog.id);assert.equal(calls,2)
})
