import test from 'node:test'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION} from '../lib/design-system/editable-contract'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { calibrationState, saveQualifications, startCalibrationJob, readCalibratedCatalog, readCalibrationOmissions } from '../lib/design-system/calibration'
import { isolateFamilyReply, ISOLATED_FAMILY } from '../lib/design-system/calibration-isolation'
import { CALIBRATION_VERSION, QUALIFICATION_VERSION, FUNCTIONAL_SELECTION_VERSION, coalescePrimitiveFamilies, validateFamilyReply, validateFamilyMerge, reconcileFamilyReply, componentReuseIssue, equivalentVariant, fieldKind, type ComponentQualification, type FamilyReply } from '../lib/design-system/calibration-contract'
import { contentHash, installSemanticCatalog, listCatalog, getCatalogComponent } from '../lib/design-system/catalog'
import type { ComponentDefinition } from '../lib/design-system/types'
import { componentUsage } from '../lib/design-system/component-curation'
import { recipeBrand } from '../lib/presentations/recipe-brand'

const config = { apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://provider.invalid/v1' }
function component(id: string, width = 140): ComponentDefinition {
  return { id, name: 'Шаг ' + id, kind: 'compound', source: { slide: 1, rootId: id, elementIds: [id], ancestorIds: [], assetIds: [] }, scene: { width, height: 60, elements: [{ id, name: 'Описание', kind: 'text', bounds: { x: 0, y: 0, width, height: 60 }, visible: true, opacity: 1, rotation: 0, zIndex: 0, text: id, fontSize: 20, fontFamily: 'Arial', fontStyle: 'Regular' }] },
    slots: [{ id, elementId: id, label: 'Описание', defaultText: id, policy: 'fixed-box', maxLength: 5000 }], fixedTextIds: [], issues: [], semantics: [] }
}
async function report(c: ComponentDefinition, ready = true): Promise<ComponentQualification> {
  return { version: QUALIFICATION_VERSION, componentId: c.id, definitionHash: await contentHash(c), ready,
    fields: c.slots.map(s => ({ id: s.id, label: s.label, kind: fieldKind(s), samples: ['Новый текст'], testedMaxLength: 11 })),
    cases: (['source', 'short', 'typical', 'long', 'boundary'] as const).map(name => ({ name, values: {}, fits: ready, roundTrip: ready, issues: [] })),
    issues: ready ? [] : [{ code: 'font-unavailable', message: 'Нет шрифта' }], preview: 'data:image/png;base64,fixture', signature: Array(4800).fill(127), environment: { userAgent: 'unit-test', fonts: [] } }
}
async function fixture() {
  const { bucket, data } = memoryBucket(), components = [component('first'), component('second', 144), component('broken', 220)]
  const catalogId = await installSemanticCatalog(bucket, 'style', { schemaVersion: 1, compilerVersion: 'fixture', sourceId: 'source', name: 'Fixture', tokens: { fonts: [], colors: [] }, components, excluded: [], notes: [] },
    { version: 'fixture', sourceRevision: 'source', coverage: { records: 3, processed: 3, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] })
  return { bucket, data, components, catalogId }
}
test('family contract rejects missing, duplicated and invented source membership', () => {
  const valid: FamilyReply = { families: [{ name: 'Шаг', description: 'Для этапа', tags: ['steps', 'text'], parameters: ['Описание'], memberIds: ['a', 'b'] }], excluded: [] }
  assert.equal(validateFamilyReply(valid, ['a', 'b']).families.length, 1)
  for (const members of [['a'], ['a', 'a', 'b'], ['a', 'b', 'fake']]) assert.throws(() => validateFamilyReply({ ...valid, families: [{ ...valid.families[0], memberIds: members }] }, ['a', 'b']))
})
test('a rejected family cannot stop comparison, discard its valid neighbours or trigger a repeat on reopen', async t => {
  const f = await fixture()
  await saveQualifications(f.bucket, 'style', f.catalogId, await Promise.all(f.components.map(c => report(c))))
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    calls++
    const request = JSON.parse(String(options!.body)), { phase, entries } = JSON.parse(request.messages[1].content[0].text)
    const family = (memberIds: string[]) => ({ name: 'Шаг процесса', description: 'Этап', tags: ['steps', 'text'], parameters: ['Описание'], memberIds })
    const output = phase === 'merge'
      ? { families: entries.map((e: { id: string }) => ({ name: 'Шаг процесса', memberIds: [e.id] })), excluded: [] }
      : { families: [family(entries.filter((e: { name: string }) => e.name !== 'Шаг second').map((e: { id: string }) => e.id)), family([entries.find((e: { name: string }) => e.name === 'Шаг second').id, 'invented'])], excluded: [] }
    return new Response(JSON.stringify({ id: 'fixture', model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }))
  })
  for (let i = 0; i < 3; i++) {
    const state = await calibrationState(f.bucket, 'style')
    if (state.calibrated) break
    const job = state.job!
    await (await startCalibrationJob(f.bucket, 'style', { catalogId: f.catalogId, inputHash: state.inputHash!, jobId: job.id, sheets: [{ ids: job.entries.map(e => e.id), dataUrl: 'data:image/jpeg;base64,fixture' }] }, config)).execute()
  }
  const catalog = (await calibrationState(f.bucket, 'style')).calibrated!
  assert.ok(catalog)
  assert.deepEqual(catalog.families.flatMap(f => f.memberIds).sort(), ['broken', 'first'])
  assert.match(catalog.excluded.find(e => e.id === 'second')!.reason, /Неоднозначное семейство/)
  assert.equal(calls, 3, 'Comparison, one clarification and merge; reopen uses the saved partial part')
  assert.equal(catalog.liveRequests, 3)
  assert.deepEqual((await getCatalogComponent(f.bucket, 'style', 'second')).component, f.components[1])
  assert.deepEqual((await readCalibrationOmissions(f.bucket, 'style')).map(o => [o.name, o.slides]), [['Шаг second', [1]]])
  const responses = [...f.data].filter(([key]) => /\/responses\//.test(key)).map(([, value]) => JSON.parse(value.value).content)
  assert.ok(responses.some(content => content.includes('invented')), 'The original rejected response stays immutable')
})
test('family isolation never chooses a conflicting owner, accepts unknown IDs or rewrites raw evidence', () => {
  const proposal = { name: 'Шаг', description: 'Этап', tags: ['steps'], parameters: [] }
  const raw = { families: [{ ...proposal, memberIds: ['a', 'b'] }, { ...proposal, memberIds: ['b', 'c', 'foreign'] }, { ...proposal, memberIds: ['source-d'] }], excluded: [] }
  const before = JSON.stringify(raw), ids = ['a', 'b', 'c', 'd', 'missing'], aliases = { 'source-d': 'd' }
  const result = isolateFamilyReply(raw, ids, r => reconcileFamilyReply(r, ids, aliases), aliases)
  assert.deepEqual(result.families.flatMap(f => f.memberIds), ['a', 'd'])
  assert.deepEqual(result.excluded.map(e => e.id).sort(), ['b', 'c', 'missing'])
  assert.ok(result.excluded.every(e => e.reason === ISOLATED_FAMILY))
  assert.equal(JSON.stringify(raw), before)
  const entries = ['f1', 'f2'].map(id => ({ id, description: { ...proposal, name: id, kind: 'compound', memberIds: [id] } }))
  const merged = isolateFamilyReply({ families: [{ name: 'Шаг', memberIds: ['f1'] }, { name: 'Не подтверждено', memberIds: ['f2', 'foreign'] }], excluded: [] }, ['f1', 'f2'], r => validateFamilyMerge(r, entries))
  assert.deepEqual(merged.families.map(f => f.memberIds), [['f1']])
  assert.deepEqual(merged.excluded.map(e => e.id), ['f2'])
})
test('an entirely unreadable family answer is recorded once and does not request an empty merge', async t => {
  const f = await fixture()
  await saveQualifications(f.bucket, 'style', f.catalogId, await Promise.all(f.components.map(c => report(c))))
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify({ id: 'fixture', model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: 'unreadable' } }] }))
  })
  const state = await calibrationState(f.bucket, 'style'), job = state.job!
  await (await startCalibrationJob(f.bucket, 'style', { catalogId: f.catalogId, inputHash: state.inputHash!, jobId: job.id, sheets: [{ ids: job.entries.map(e => e.id), dataUrl: 'data:image/jpeg;base64,fixture' }] }, config)).execute()
  const after = await calibrationState(f.bucket, 'style')
  assert.ok(after.calibrated)
  assert.equal(after.job, null)
  assert.equal(after.calibrated.families.length, 0)
  assert.deepEqual(after.calibrated.excluded.map(e => e.id).sort(), ['broken', 'first', 'second'])
  assert.equal((await calibrationState(f.bucket, 'style')).job, null)
  assert.ok(calls <= 2)
})
test('conflict reconciliation preserves raw replies and cannot conceal missing or invented objects',()=>{
 const raw:FamilyReply={families:[{name:'Фон',description:'Фон',tags:['background'],parameters:[],memberIds:['a','b','b']}],excluded:[{id:'b',reason:'Сомнение'}]}
 const snapshot=JSON.stringify(raw),result=reconcileFamilyReply(raw,['a','b'])
 assert.deepEqual(result.families[0].memberIds,['a'])
 assert.deepEqual(result.excluded.map(x=>x.id),['b'])
 assert.equal(JSON.stringify(raw),snapshot)
 assert.throws(()=>reconcileFamilyReply(raw,['a','b','missing']),/проверку/)
 assert.throws(()=>reconcileFamilyReply(raw,['a']),/проверку/)
})
test('an incompatible merge retains checked atom and construct families and still requires complete coverage',()=>{
 const description={description:'Маркер',tags:['marker'],parameters:[]}
 const entries=[{id:'f1',description:{...description,name:'Круг',kind:'atom'}},{id:'f2',description:{...description,name:'Номер в круге',kind:'compound',parameters:['Номер']}},{id:'f3',description:{...description,name:'Иконка',kind:'atom'}}]
 const raw={families:[{name:'Маркер списка',memberIds:['f1','f2']},{name:'Иконка',memberIds:['f3']}],excluded:[]},before=JSON.stringify(raw)
 const result=validateFamilyMerge(raw,entries)
 assert.deepEqual(result.families.map(f=>[f.name,f.memberIds]),[['Круг',['f1']],['Номер в круге',['f2']],['Иконка',['f3']]])
 assert.equal(JSON.stringify(raw),before)
 assert.throws(()=>validateFamilyMerge({...raw,families:raw.families.slice(0,1)},entries))
})
test('qualification requires current definition and all test cases; a client flag cannot approve a failed case', async () => {
  const f = await fixture(), c = f.components[0], q = await report(c)
  await assert.rejects(() => saveQualifications(f.bucket, 'style', f.catalogId, [{ ...q, definitionHash: 'old' }]), /исходному/)
  await assert.rejects(() => saveQualifications(f.bucket, 'style', f.catalogId, [{ ...q, cases: q.cases.slice(0, 1) }]), /сценарии/)
  q.cases[0].roundTrip = false; q.ready = true
  await saveQualifications(f.bucket, 'style', f.catalogId, [q])
  assert.equal((await calibrationState(f.bucket, 'style')).passed, 0)
})

test('a conflicting model assignment isolates the affected graphics and lets the checked catalog finish', async t => {
  const f = await fixture()
  for (const c of f.components) { c.kind='atom'; c.slots=[]; c.scene.elements=[{...c.scene.elements[0],kind:'ellipse'}] }
  const catalogId=await installSemanticCatalog(f.bucket,'style',{schemaVersion:1,compilerVersion:'fixture',sourceId:'source',name:'Fixture',tokens:{fonts:[],colors:[]},components:f.components,excluded:[],notes:[]},
    {version:'fixture',sourceRevision:'source',coverage:{records:3,processed:3,unresolved:0,rulesUnresolved:0,complete:true},decisions:[],styleRoles:[],rules:[]})
  await saveQualifications(f.bucket,'style',catalogId,await Promise.all(f.components.map(async c=>{const q=await report(c);q.cases=q.cases.slice(0,1);return q})))
  let calls=0
  t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
    calls++;const request=JSON.parse(String(options!.body)),{phase,entries}=JSON.parse(request.messages[1].content[0].text)
    const output=phase==='merge'?{families:[{name:'Графика',memberIds:entries.map((e:{id:string})=>e.id)}],excluded:[]}:
      {families:[{name:'Фон',description:'Фон',tags:['background'],parameters:[],memberIds:entries.map((e:{id:string})=>e.id)},
        {name:'Фотография',description:'Фото',tags:['image'],parameters:[],memberIds:[entries.find((e:{name:string})=>e.name==='Шаг second').id]}],excluded:[]}
    return new Response(JSON.stringify({id:'fixture',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}))
  })
  while(!(await calibrationState(f.bucket,'style')).calibrated){
    const s=await calibrationState(f.bucket,'style'),j=s.job!
    await(await startCalibrationJob(f.bucket,'style',{catalogId,inputHash:s.inputHash!,jobId:j.id,sheets:[{ids:j.entries.map(e=>e.id),dataUrl:'data:image/jpeg;base64,fixture'}]},config)).execute()
  }
  const result=(await calibrationState(f.bucket,'style')).calibrated!
  assert.ok(result.families.flatMap(f=>f.memberIds).includes('first'))
  assert.ok(!result.families.flatMap(f=>f.memberIds).includes('second'))
  assert.match(result.excluded.find(e=>e.id==='second')!.reason,/Неоднозначное семейство/)
  assert.equal(calls,2,'One comparison and merge; a permanent conflict must not trigger paid retries')
  assert.ok(await getCatalogComponent(f.bucket,'style','second'),'The original graphic is preserved')
})
test('whole catalog comparison publishes one family with qualified variants and preserves every raw definition', async t => {
  const f = await fixture()
  await saveQualifications(f.bucket, 'style', f.catalogId, await Promise.all(f.components.map((c, i) => report(c, i !== 2))))
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    calls++
    const request = JSON.parse(String(options!.body)), entries = JSON.parse(request.messages[1].content[0].text).entries
    const raw: FamilyReply = { families: [{ name: 'Шаг процесса', description: 'Обозначает этап процесса', tags: ['steps', 'text'], parameters: ['Описание'], memberIds: entries.map((e: { id: string }) => e.id) }], excluded: [] }
    const output = JSON.parse(request.messages[1].content[0].text).phase === 'merge' ? { ...raw, families: raw.families.map(({name,memberIds}) => ({name,memberIds})) } : raw
    return new Response(JSON.stringify({ id: 'fixture', model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { total_tokens: 10 } }))
  })
  while (!(await calibrationState(f.bucket, 'style')).calibrated) {
    const state = await calibrationState(f.bucket, 'style'), job = state.job!
    const started = await startCalibrationJob(f.bucket, 'style', { catalogId: f.catalogId, inputHash: state.inputHash!, jobId: job.id, sheets: [{ ids: job.entries.map(e => e.id), dataUrl: 'data:image/jpeg;base64,fixture' }] }, config)
    await started.execute()
  }
  const catalog = (await readCalibratedCatalog(f.bucket, 'style', f.catalogId))!
  assert.equal(catalog.version, CALIBRATION_VERSION); assert.equal(catalog.families.length, 1); assert.equal(catalog.families[0].variants.length, 1)
  assert.deepEqual(catalog.families[0].variants[0].memberIds, ['first', 'second'])
  assert.equal(catalog.excluded.find(e => e.id === 'broken')?.reason, 'Нет шрифта')
  assert.equal(calls, 2); assert.equal(catalog.liveRequests, 2)
  const page = (await listCatalog(f.bucket, 'style', new URLSearchParams('component=second')))!
  assert.equal(page.total, 1); assert.equal(page.focusedId, 'first'); assert.equal(page.items[0].name, 'Шаг процесса')
  assert.deepEqual((await getCatalogComponent(f.bucket, 'style', 'second')).component, f.components[1])
  assert.equal((await calibrationState(f.bucket, 'style')).job, null)
  const editable={version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,id:'editable',catalogId:f.catalogId,families:[{id:'new',sourceIds:['first'],variants:[{id:'v',sourceIds:['first']}]}],qualification:{checks:[{id:'v',passed:true}]}}
  await f.bucket.put(`editable-systems/style/${EDITABLE_VERSION}/current.json`,JSON.stringify({key:'editable-fixture.json'}))
  await f.bucket.put('editable-fixture.json',JSON.stringify(editable))
  assert.equal((await listCatalog(f.bucket,'style',new URLSearchParams()))!.total,1,'Replacing one occurrence cannot hide its entire family')
  editable.families[0].sourceIds.push('second');await f.bucket.put('editable-fixture.json',JSON.stringify(editable))
  assert.equal((await listCatalog(f.bucket,'style',new URLSearchParams()))!.total,0,'The family is hidden only after every qualified occurrence has a replacement')
  const catalogRoot = `component-calibration/style/${f.catalogId}/${CALIBRATION_VERSION}`, oldId = 'a'.repeat(64)
  await f.bucket.put(`${catalogRoot}/catalogs/${oldId}.json`, JSON.stringify({ ...catalog, id: oldId, functionalVersion: 'old-rules' }))
  await f.bucket.put(`${catalogRoot}/current.json`, JSON.stringify({ id: oldId }))
  await f.bucket.delete(`${catalogRoot}/comparison.json`) // migrate a catalog saved by the previous release
  const outdated = await calibrationState(f.bucket, 'style')
  assert.ok(outdated.calibrated); assert.equal(outdated.job, null)
  assert.equal(calls, 2, 'new deterministic selection rules reuse the saved model comparison')
  assert.equal((await readCalibratedCatalog(f.bucket, 'style', f.catalogId))?.functionalVersion, FUNCTIONAL_SELECTION_VERSION)
})
test('pixel similarity cannot merge fixed copy, different field types or orientation', async () => {
  const a = component('one'), b = component('two'), qa = await report(a), qb = await report(b)
  assert.ok(equivalentVariant(a, b, qa, qb))
  b.slots[0].label = 'Номер'; assert.equal(equivalentVariant(a, b, qa, qb), false)
  b.slots[0].label = 'Описание'; b.scene.width = 20; assert.equal(equivalentVariant(a, b, qa, qb), false)
  b.scene.width = 140; a.fixedTextIds = ['one']; b.fixedTextIds = ['two']; assert.equal(equivalentVariant(a, b, qa, qb), false)
})
test('legend usage describes its role and generation only sees calibrated resource IDs', () => {
  const c = component('legend'); c.name = 'Пункт легенды MAU'
  assert.equal(componentUsage(c).description, 'Обозначает ряд данных')
  const library = { schemaVersion: 1 as const, compilerVersion: 'fixture', sourceId: 'source', name: 'Fixture', tokens: { fonts: [{ family: 'Arial', sizes: [20], occurrences: 1 }], colors: [{ hex: '#000000', occurrences: 1 }, { hex: '#FFFFFF', occurrences: 1 }] }, components: [], excluded: [], notes: [] }
  const semantic = { version: 'fixture', sourceRevision: 'source', coverage: { records: 0, processed: 0, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] }
  const brand = recipeBrand('style', 'catalog', library, semantic, { version: CALIBRATION_VERSION, qualificationVersion: QUALIFICATION_VERSION, functionalVersion: FUNCTIONAL_SELECTION_VERSION, id: 'qualified', catalogId: 'catalog', createdAt: '', families: [], excluded: [], sourceCount: 0, qualifiedCount: 0, liveRequests: 0, cacheHits: 0, modelRunIds: [] })
  assert.equal(brand.calibrationId, 'qualified'); assert.deepEqual(brand.resources, [])
})

test('near-identical samples retain different typography and palette as variants', async () => {
  const a = component('a'), b = component('b'), qa = await report(a), qb = await report(b)
  const text = b.scene.elements[0]; assert.ok(text.kind === 'text')
  text.fontSize = 24; assert.equal(equivalentVariant(a, b, qa, qb), false)
  text.fontSize = 20; text.colorRuns = [{ start: 0, end: 1, fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } }]
  assert.equal(equivalentVariant(a, b, qa, qb), false)
})

test('a flattened chart is kept as source artwork but cannot pose as a functional data component', () => {
  const c = component('chart'); c.name = 'Диаграмма 12%'; c.kind = 'atom'; c.slots = []
  c.scene.elements = [{...c.scene.elements[0],kind:'raster',assetId:'source-chart',reason:'source'}]
  assert.match(componentReuseIssue(c,{name:'Круговая диаграмма',tags:['chart']})!,/встроены в изображение/)
  assert.equal(componentReuseIssue(c,{name:'Иконка графика',tags:['icon']}),null)
  c.name = 'Изображение графика'
  assert.match(componentReuseIssue(c,{name:'Изображение графика',tags:['decoration','image']})!,/встроены в изображение/)
  c.name = 'Декоративная композиция'
  assert.equal(componentReuseIssue(c,{name:'Фирменный узор',tags:['decoration']}),null)
  c.name = 'Карточка показателя'; c.scene.elements = [{ ...c.scene.elements[0], kind: 'path', pathData: 'M0 0H100V100H0Z' }]
  assert.match(componentReuseIssue(c,{name:'Карточка показателя',tags:['metric']})!,/нет изменяемых значений/)
})

test('primitive aliases merge across semantic labels, while small visible differences remain variants', async () => {
  const a = component('circle-a'), b = component('circle-b')
  for (const c of [a,b]) {
    c.kind = 'atom'; c.slots = []; c.scene.width = c.scene.height = 60
    c.scene.elements = [{ ...c.scene.elements[0], kind: 'ellipse' }]
  }
  const qa = await report(a), qb = await report(b)
  const families: FamilyReply['families'] = [{name:'Декоративный круг',description:'Круглая форма',tags:['decoration'],parameters:[],memberIds:[a.id]},
    {name:'Маркер',description:'Круглый маркер',tags:['marker'],parameters:[],memberIds:[b.id]}]
  const merged = coalescePrimitiveFamilies(families,new Map([[a.id,a],[b.id,b]]),new Map([[a.id,qa],[b.id,qb]]))
  assert.equal(merged.length,1); assert.deepEqual(merged[0].tags,['decoration','marker']); assert.deepEqual(families[0].memberIds,[a.id])
  qa.signature = Array.from({length:4800},(_,i)=>[137,147,165][i%3]); qb.signature = [...qa.signature]
  qa.signature[99] = 0; qb.signature[189] = 0
  assert.equal(equivalentVariant(a,b,qa,qb),false)
})

test('requalification reuses semantic comparison and retains qualified singleton constructs', async t => {
 const f=await fixture();await saveQualifications(f.bucket,'style',f.catalogId,await Promise.all(f.components.map((c,i)=>report(c,i!==2))))
 let calls=0
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
  calls++;const req=JSON.parse(String(options!.body)),{phase,entries}=JSON.parse(req.messages[1].content[0].text)
  const output=phase==='merge'?{families:[{name:'Шаг процесса',memberIds:[entries[0].id]}],excluded:[]}:{families:[{name:'Шаг процесса',description:'Этап',tags:['steps','text'],parameters:['Описание'],memberIds:[entries[0].id]}],excluded:entries.slice(1).map((e:{id:string})=>({id:e.id,reason:'Уникальная конструкция; нет похожего семейства'}))}
  return new Response(JSON.stringify({id:'fixture',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}))
 })
 while(!(await calibrationState(f.bucket,'style')).calibrated){const s=await calibrationState(f.bucket,'style'),j=s.job!;await(await startCalibrationJob(f.bucket,'style',{catalogId:f.catalogId,inputHash:s.inputHash!,jobId:j.id,sheets:[{ids:j.entries.map(e=>e.id),dataUrl:'data:image/jpeg;base64,fixture'}]},config)).execute()}
 const before=(await calibrationState(f.bucket,'style')).calibrated!
 assert.ok(before.families.some(f=>f.memberIds.includes('second')),'A unique qualified construct cannot vanish during grouping')
 await saveQualifications(f.bucket,'style',f.catalogId,[await report(f.components[2])])
 const after=await calibrationState(f.bucket,'style')
 assert.ok(after.calibrated?.families.some(f=>f.memberIds.includes('broken')),'Recovered fonts should republish qualified members automatically')
 assert.notEqual(after.calibrated?.id,before.id);assert.equal(after.job,null);assert.equal(calls,2)
})
