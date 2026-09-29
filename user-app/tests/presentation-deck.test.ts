import { seedQualifiedCatalogFixture } from './helpers/calibrated-catalog'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deckInput, deckEvidence, deckScene } from './fixtures/deck'
import { DECK_RENDERER, MAX_SCENE_ATTEMPTS, boundText, slotContent, validateScene, type DeckReport } from '../lib/presentations/deck-contract'
import { compileDeckScene, geometryIssues, roundedPath } from '../lib/presentations/deck-compiler'
import { acceptedVariants } from '../lib/presentations/recipes/catalog'
import { contentHash, installSemanticCatalog } from '../lib/design-system/catalog'
import { deckContext, readDeck, startDeckAction } from '../lib/presentations/deck'
import { recipeContext, type RecipePlanState } from '../lib/presentations/recipe-plan'
import { RECIPE_SELECTION_VERSION } from '../lib/presentations/recipe-selection'
import { structureContext, type StructureState } from '../lib/presentations/structure'
import { assembleOutline, OUTLINE_VERSION } from '../lib/presentations/outline'
import { addBankStyle, createProject, updateProject } from '../lib/workspace/storage'
import { memoryBucket } from './helpers/memory-bucket'
import { sceneTask } from '../lib/presentations/deck-task'
import { nextOperation, slideInput, deckRequests, MAX_DECK_REQUESTS } from '../lib/presentations/deck-workflow'
import { replacementChoices, validateReplacement } from '../lib/presentations/deck-reselection'
import { validateResourceResult, resourceTask } from '../lib/presentations/deck-resources'
import { validateVisualReview } from '../lib/presentations/deck-review'
import type { ComponentDefinition } from '../lib/design-system/types'

const config = { apiKey: 'test-secret-do-not-store', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
const response = (value: unknown) => new Response(JSON.stringify({ id: 'mock-response', model: config.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { total_tokens: 50 } }), { headers: { 'Content-Type': 'application/json' } })
const png = async () => `data:image/png;base64,${(await readFile('public/recipes/accepted-10-v1/minimal-center-38--3.png')).toString('base64')}`
async function fixture(count = 1, direction = false, options: { text?: string; resources?: ComponentDefinition[]; variantId?: string } = {}) {
  const store = memoryBucket(), input = deckInput(), now = new Date().toISOString()
  if (options.variantId) input.variant = acceptedVariants.find(v => v.id === options.variantId)!
  const style = { id: input.brand.uploadId, name: input.brand.name, fileName: 'test.pptx', sourceId: input.brand.sourceId, createdAt: now, slideCount: 1, componentCount: 0, styleCount: 1, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  await installSemanticCatalog(store.bucket, style.id, { schemaVersion: 1, compilerVersion: 'test', sourceId: style.sourceId, name: style.name, tokens: input.brand.tokens, components: options.resources ?? [], excluded: [], notes: [] },
    { version: 'test', sourceRevision: style.sourceId, coverage: { records: 0, processed: 0, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] })
  await seedQualifiedCatalogFixture(store.bucket, style.id)
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Deck unit fixture', uploadId: style.id,
    text: options.text ?? Array.from({ length: count }, () => `# ${input.content[0].text}\n${input.content[1].text}${direction ? '\nВизуально: не выводить эту инструкцию.' : ''}`).join('\n\n') }, style)
  const q2 = await structureContext(store.bucket, project.id, config)
  const outline = assembleOutline(q2.material, q2.parts, q2.parts.map(part => ({ slides: [...new Set(part.fragments.map(f => f.sectionId))].map(sectionId => {
    const fs = part.fragments.filter(f => f.sectionId === sectionId)
    return { kind: 'statement' as const, headingFragmentId: fs[0].id, fragmentIds: fs.map(f => f.id), blocks: fs.slice(1).filter(f => f.kind !== 'direction').map(f => ({ kind: 'text' as const, role: 'support' as const, fragmentIds: [f.id] })) }
  }) })))
  const structure: StructureState = { version: OUTLINE_VERSION, id: crypto.randomUUID(), materialId: q2.material.id, projectId: project.id, sourceRevision: project.revision, status: 'ready', startedAt: now, finishedAt: now, completedParts: 1, totalParts: 1, liveRequests: 0, cacheHits: 0, modelRunIds: [], outline }
  await store.bucket.put(`${q2.prefix}/state.json`, JSON.stringify(structure))
  const q3 = await recipeContext(store.bucket, project.id, config)
  const plan: RecipePlanState = { version: RECIPE_SELECTION_VERSION, id: crypto.randomUUID(), inputId: q3.inputId, projectId: project.id, materialId: q2.material.id, uploadId: style.id, catalogId: q3.brand.catalogId,
    outlineHash: q3.outlineHash, recipeCatalogHash: q3.recipeCatalogHash, status: 'ready', startedAt: now, finishedAt: now, completedParts: 1, totalParts: 1, liveRequests: 0, cacheHits: 0, modelRunIds: [], fitVerified: false,
    selections: outline.slides.map(s => ({ slideId: s.id, recipeId: input.variant.recipe.id, variantId: input.variant.id, reason: 'Unit fixture only' })) }
  await store.bucket.put(`${q3.prefix}/state.json`, JSON.stringify(plan))
  return { ...store, project, context: await deckContext(store.bucket, project.id, config) }
}
const measurement = (id: string, x: number, y: number) => ({ id, x, y, width: 300, height: 80, lines: 1 })
const report = (hash: string): DeckReport => ({ renderer: DECK_RENDERER, sceneHash: hash, issues: [], texts: [measurement('title', 450, 280), measurement('subtitle', 450, 680)] })

test('binding covers every source UTF-16 character exactly once; no rewritten text, duplication, omission, invented slots or fonts', () => {
  const input = deckInput(), good = deckScene(input), evidence = deckEvidence()
  validateScene(good, input, evidence)
  assert.equal(boundText(good.texts[1], input), input.content[1].text)
  for (const change of [
    (s: typeof good) => s.texts.pop(), (s: typeof good) => s.texts[1].parts[0].end--,
    (s: typeof good) => s.texts[1].parts.push(s.texts[1].parts[0]), (s: typeof good) => s.texts[0].id = 'invented',
    (s: typeof good) => Object.assign(s.texts[0], { text: 'Переписанный текст' }), (s: typeof good) => s.fontFamily = 'Invented Font',
    (s: typeof good) => s.colors[0].hex = '#FF0000', (s: typeof good) => s.texts[0].yOffset = 96,
  ]) { const bad = structuredClone(good); change(bad); assert.throws(() => validateScene(bad, input, evidence)) }
})
test('compiled scene retains editable text and native gradient, exact source and authored font sizes', () => {
  const input = deckInput(), scene = deckScene(input), component = compileDeckScene(scene, input)
  const text = component.scene.elements.filter(e => e.kind === 'text')
  assert.deepEqual(text.map(e => e.text), input.content.map(f => f.text))
  assert.deepEqual(text.map(e => e.fontSize), [72, 32]); assert.ok(text.every(e => e.flow?.autoFit === 'NONE'))
  assert.ok(component.scene.elements.some(e => e.kind === 'rectangle' && e.gradient))
  assert.ok(!component.scene.elements.some(e => e.id === 'badgePanel')); assert.equal(component.source.assetIds.length, 0)
})
test('source directions remain instructions; heading cannot become a label and prose cannot become a badge', async () => {
  const f = await fixture(1, true), input = f.context.inputs[0]
  assert.equal(input.content.length, 2); assert.equal(input.directions.length, 1)
  assert.ok(!input.content.some(c => c.text.startsWith('Визуально:')))
  const scene = deckScene(input), bad = structuredClone(scene)
  bad.texts[0].id = 'label'
  assert.throws(() => validateScene(bad, input, deckEvidence()), error => JSON.stringify(error).includes('heading-must-use-title-slot'))
  bad.texts[0].id = 'title'; bad.texts[1].id = 'badge'
  assert.throws(() => validateScene(bad, input, deckEvidence()), error => JSON.stringify(error).includes('badge-requires-explicit-badge'))
  const glyph = structuredClone(scene), end = input.content[1].text.length
  glyph.texts[1].parts = [{ fragmentId: input.content[1].id, start: 0, end: end - 1 }, { fragmentId: input.content[1].id, start: end - 1, end }]
  assert.throws(() => validateScene(glyph, input, deckEvidence()), error => JSON.stringify(error).includes('glyph-split'))
})
test('editorial slots preserve Q2 block grouping and cannot steal an argument into the optional intro', () => {
  const input = deckInput(); input.variant = acceptedVariants.find(v => v.id === 'editorial-insight-04--1')!
  input.content = [input.content[0], ...['А', 'Б', 'В'].flatMap((text, i) => [0,1].map(n => ({ id: `b${i}-${n}`, text, blockId: `block-${i}`, kind: 'step', role: 'primary' })))]
  assert.deepEqual(slotContent('point2', input).map(c => c.id), ['b1-0', 'b1-1'])
  assert.equal(slotContent('body', input).length, 0); assert.equal(slotContent('footer', input).length, 0)
  const task = sceneTask(input, deckEvidence(), 'test-image')
  assert.ok(!JSON.stringify(task.schema).includes('"enum":["body"]'))
  assert.ok(!JSON.stringify(task.schema).includes('"enum":[]'))
})
test('authored rounded masks retain distinct corner radii as editable paths', () => {
  const path = roundedPath(200, 100, [0, 0, 20, 20])
  assert.match(path, /^M 0 0 L 200 0/); assert.match(path, /L 200 80/); assert.match(path, /L 20 100/)
})
test('separator changes layout only between fragments and never rewrites source words', () => {
  const input = deckInput(), text = { id: 'subtitle', yOffset: 0, separator: 'space' as const,
    parts: input.content.map(c => ({ fragmentId: c.id, start: 0, end: c.text.length })) }
  assert.equal(boundText(text, input), input.content.map(c => c.text).join(' '))
  assert.equal(boundText({ ...text, separator: 'newline' }, input), input.content.map(c => c.text).join('\n'))
})
test('geometry rejects real overflow, excess lines, overlap and missing measurements; no shrink repair', () => {
  const input = deckInput(), scene = deckScene(input), metrics = report('a'.repeat(64)).texts
  assert.deepEqual(geometryIssues(scene, input, metrics), [])
  metrics[0].height = 600; metrics[0].lines = 8
  const issues = geometryIssues(scene, input, metrics)
  assert.ok(issues.some(i => i.code === 'text-overflow')); assert.ok(issues.some(i => i.code === 'text-overlap'))
  assert.ok(geometryIssues(scene, input, []).every(i => i.code === 'missing-measurement'))
})
test('model receives chosen reference, real resource previews, exact ranges and measured repair evidence', () => {
  const input = deckInput(), evidence = { ...deckEvidence(), sheet: 'data:image/png;base64,resource' }
  const task = sceneTask(input, evidence, 'data:image/png;base64,reference', { scene: deckScene(), issues: [{ code: 'overflow', message: 'subtitle 150 >112' }], preview: 'data:image/png;base64,failed' })
  const content = task.messages[1].content
  assert.ok(Array.isArray(content)); assert.equal(content.filter(c => c.type === 'image_url').length, 3)
  assert.ok(JSON.stringify(task).includes('subtitle 150 >112')); assert.ok(!JSON.stringify(task).includes(config.apiKey))
})
test('Q4→browser measurement→Q5 preserves prior attempts, ready native scene, replay without a new paid request', async t => {
  const f = await fixture(), input = f.context.inputs[0]; let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => { calls++; const body = JSON.parse(init!.body as string)
    if (body.response_format.json_schema.name === 'presentation_visual_review') {
      const data = JSON.parse(body.messages[1].content[0].text)
      return response({ slides: data.slides.filter((s: { target: boolean }) => s.target).map((s: { slideId: string; sceneHash: string }) => ({ slideId: s.slideId, sceneHash: s.sceneHash, verdict: 'pass', action: 'keep', issues: [] })) })
    }
    return response(deckScene(input)) })
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  const first = await startDeckAction(f.bucket, f.context, action, config); await first.execute!()
  assert.equal(first.state.slides[0].status, 'render')
  const failed = report(first.state.slides[0].attempts[0].sceneHash!); failed.texts[1].height = 140
  await startDeckAction(f.bucket, f.context, { action: 'report', inputId: f.context.inputId, slideId: input.slideId, report: failed, preview: await png() }, config)
  const second = await startDeckAction(f.bucket, f.context, action, config); await second.execute!()
  const last = second.state.slides[0].attempts.at(-1)!
  await startDeckAction(f.bucket, f.context, { action: 'report', inputId: f.context.inputId, slideId: input.slideId, report: report(last.sceneHash!), preview: await png() }, config)
  assert.equal((await readDeck(f.bucket,f.context))!.slides[0].status, 'fitted')
  for (let i = 0; i < 3; i++) { const step = await startDeckAction(f.bucket,f.context,action,config); await step.execute?.() }
  const ready = await readDeck(f.bucket, f.context)
  assert.equal(ready!.status, 'ready'); assert.equal(ready!.slides[0].attempts.length, 2)
  assert.ok(f.data.has(`${f.context.prefix}/slides/${input.slideId}/scene.json`))
  assert.equal((await startDeckAction(f.bucket, f.context, action, config)).execute, null); assert.equal(calls, 3)
  assert.ok([...f.data.values()].every(v => !v.value.includes(config.apiKey)))
})
test('contract failures and measured failures share one three-attempt budget; malformed reports and references cannot advance it', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ wrong: 'schema' }) })
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  await assert.rejects(() => startDeckAction(f.bucket, f.context, { ...action, reference: 'data:image/png;base64,AAA' }, config))
  assert.equal(calls, 0)
  for (let n = 0; n < MAX_SCENE_ATTEMPTS; n++) { const job = await startDeckAction(f.bucket, f.context, action, config); await job.execute!() }
  await startDeckAction(f.bucket, f.context, action, config)
  assert.equal((await readDeck(f.bucket, f.context))!.status, 'blocked')
  assert.equal((await startDeckAction(f.bucket, f.context, { ...action, retry: true }, config)).execute, null)
  assert.equal(calls, 3)
})
test('concurrent tabs reserve once; content edits during response cannot publish a stale slide', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: f.project.text + '\nНовое условие.' })
    return response(deckScene(f.context.inputs[0]))
  })
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  const results = await Promise.allSettled([1,2].map(() => startDeckAction(f.bucket, f.context, action, config)))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const job = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof startDeckAction>>>).value
  await assert.rejects(() => job.execute!(), /изменились/); assert.equal(calls, 1); assert.equal(job.state.slides[0].status, 'failed')
})
test('reload between slides preserves completed work; a report is bound to its scene hash', async t => {
  const f = await fixture(2); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => response(deckScene(f.context.inputs[calls++])))
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  const one = await startDeckAction(f.bucket, f.context, action, config); await one.execute!()
  const id = f.context.inputs[0].slideId, attempt = one.state.slides[0].attempts[0]
  await assert.rejects(() => startDeckAction(f.bucket, f.context, { action: 'report', inputId: f.context.inputId, slideId: id, report: report('0'.repeat(64)), preview: action.reference }, config))
  await startDeckAction(f.bucket, f.context, { action: 'report', inputId: f.context.inputId, slideId: id, report: report(attempt.sceneHash!), preview: await png() }, config)
  const sameContext = await deckContext(f.bucket, f.project.id, config)
  assert.equal(sameContext.inputId, f.context.inputId)
  const two = await startDeckAction(f.bucket, sameContext, action, config); await two.execute!()
  assert.equal(two.state.slides[0].status, 'fitted'); assert.equal(two.state.slides[1].status, 'render'); assert.equal(calls, 2)
  assert.equal(attempt.sceneHash, await contentHash(attempt.scene))
})
test('a restart after the model response reuses that exact response before any new request', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(deckScene(f.context.inputs[0])) })
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  const one = await startDeckAction(f.bucket, f.context, action, config); await one.execute!()
  const hash = one.state.slides[0].attempts[0].sceneHash
  one.state.slides[0].status = 'running'; delete one.state.slides[0].attempts[0].scene; delete one.state.slides[0].attempts[0].sceneHash
  await f.bucket.put(`${f.context.prefix}/state.json`, JSON.stringify(one.state))
  const restored = await startDeckAction(f.bucket, f.context, action, config)
  assert.equal(restored.execute, null); assert.equal(restored.state.slides[0].status, 'render')
  assert.equal(restored.state.slides[0].attempts[0].sceneHash, hash); assert.equal(calls, 1)
})
test('invalid model JSON enters bounded repair but a provider outage never retries itself', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] }), { headers: { 'Content-Type': 'application/json' } })
    return new Response('Unavailable', { status: 503 })
  })
  const action = { action: 'advance' as const, inputId: f.context.inputId, reference: await png(), evidence: deckEvidence() }
  const one = await startDeckAction(f.bucket, f.context, action, config); await one.execute!()
  assert.equal(one.state.slides[0].status, 'pending'); assert.equal(one.state.slides[0].attempts[0].raw, '{broken')
  const two = await startDeckAction(f.bucket, f.context, action, config)
  await assert.rejects(() => two.execute!(), /HTTP 503/)
  assert.equal(two.state.status, 'failed'); assert.equal((await startDeckAction(f.bucket, f.context, action, config)).execute, null)
  assert.equal(calls, 2)
})

test('full visual resource search covers every catalogue page before shortlisting, including a useful resource after the former first 20', async t => {
  const base = compileDeckScene(deckScene(),deckInput()).scene.elements.find(e => e.kind === 'rectangle')!
  const resources: ComponentDefinition[] = Array.from({length:41},(_,i) => ({ id:`resource-${i}`,name:`Иллюстрация ${i}`,kind:'atom',source:{slide:i+1,rootId:`r${i}`,elementIds:[`r${i}`],ancestorIds:[],assetIds:[]},
    scene:{width:1920,height:1080,elements:[{...structuredClone(base),bounds:{...base.bounds,width:base.bounds.width-i*2},id:`r${i}`,zIndex:0}]},slots:[],fixedTextIds:[],issues:[],semantics:[{findingId:`f${i}`,name:'Абстракция',role:'decoration',basis:'test'}] }))
  const f = await fixture(1,false,{resources}), action = {action:'advance' as const,inputId:f.context.inputId}; let calls = 0
  t.mock.method(globalThis,'fetch',async (_url: string | URL | Request, init?: RequestInit) => {
    calls++; const body = JSON.parse(init!.body as string), data = JSON.parse(body.messages[1].content[0].text)
    assert.ok(data.resources.every((r:{tags:string[];description:string})=>r.tags.includes('illustration')&&r.description.length>0))
    const candidates = data.resources.filter((r: {available:boolean}) => r.available), selected = candidates.at(-1)
    return response({selections:data.slides.map((s:{id:string}) => ({slideId:s.id,ranked:[{componentId:selected.componentId,score:selected.componentId==='resource-40'?100:40,reason:'Контроль полного каталога'}]}))})
  })
  const initial = await startDeckAction(f.bucket,f.context,action,config)
  assert.equal(initial.state.pages.length,2)
  for (const page of initial.state.pages) await startDeckAction(f.bucket,f.context,{action:'catalog',inputId:f.context.inputId,pageId:page.id,evidence:{...deckEvidence(),resourceIds:page.ids,sheet:await png()}},config)
  for (let i=0;i<2;i++) {const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute!()}
  const state=(await readDeck(f.bucket,f.context))!, input=slideInput(f.context,state,state.slides[0])
  assert.equal(calls,2);assert.equal(state.pages.flatMap(p=>p.availableIds!).length,41)
  assert.ok(input.resources.some(r=>r.id==='resource-40'));assert.ok(input.resources.length<=24)
  assert.equal(nextOperation(f.context,state).kind,'evidence')
  const page=state.pages[1],query={id:'query-1',slideIds:[input.slideId]}
  assert.throws(()=>validateResourceResult({selections:[{slideId:input.slideId,ranked:[{componentId:'foreign',score:100,reason:'x'}]}]},page,query))
  assert.ok(JSON.stringify(resourceTask(page,query,f.context.inputs,await png())).includes('resource-40'))
  assert.equal(deckRequests(state),2)
})

test('exhausted Q5 reselects an untried eligible recipe through Qwen and preserves all prior attempts and content', async t => {
  const f=await fixture(1,false,{text:'# Заголовок'}), before=JSON.stringify(f.context.inputs[0].content)
  let calls=0, chosen=''
  t.mock.method(globalThis,'fetch',async (_url: string | URL | Request, init?: RequestInit)=>{
    calls++;const body=JSON.parse(init!.body as string)
    if(body.response_format.json_schema.name==='presentation_recipe_reselection') {
      const ids=body.response_format.json_schema.schema.properties.variantId.anyOf[0].enum
      assert.ok(ids.length>0);assert.ok(!ids.includes(f.context.inputs[0].variant.id));chosen=ids[0]
      return response({variantId:chosen,reason:'Совместимая композиция с отдельным тезисом и контекстом'})
    }
    return response({wrong:'scene'})
  })
  const action={action:'advance' as const,inputId:f.context.inputId,reference:await png(),evidence:deckEvidence()}
  for(let i=0;i<3;i++){const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute!()}
  const select=await startDeckAction(f.bucket,f.context,action,config);await select.execute!()
  assert.equal(select.state.slides[0].variantId,chosen);assert.equal(select.state.slides[0].attempts.length,3)
  assert.deepEqual(select.state.slides[0].tried,[f.context.inputs[0].variant.id,chosen]);assert.equal(calls,4)
  assert.equal(JSON.stringify(slideInput(f.context,select.state,select.state.slides[0]).content),before)
  assert.equal(nextOperation(f.context,select.state).kind,'scene')
  const input=f.context.inputs[0], semantic={id:input.slideId,kind:'statement' as const,heading:{fragmentId:'f1',text:'Заголовок'},blocks:[{kind:'text' as const,role:'support' as const,fragmentIds:['f2'],text:'Первый'},{kind:'text' as const,role:'support' as const,fragmentIds:['f3'],text:'Второй'}],directions:[]}
  assert.deepEqual(replacementChoices(input,semantic,[input.variant.id,chosen,'another-visited'],[]),[])
  assert.throws(()=>validateReplacement({variantId:input.variant.id,reason:'Вернуться'},acceptedVariants.filter(v=>v.id===chosen)))
})

test('Q6 reviews rendered evidence, corrects through Q4/Q5, rechecks the changed deck and caches the exact final hashes', async t => {
  const f=await fixture(), input=f.context.inputs[0];let calls=0,reviews=0,scenes=0
  t.mock.method(globalThis,'fetch',async (_url: string | URL | Request, init?: RequestInit)=>{
    calls++;const body=JSON.parse(init!.body as string)
    if(body.response_format.json_schema.name==='presentation_visual_review') {
      reviews++;const data=JSON.parse(body.messages[1].content[0].text)
      assert.ok(body.messages[1].content.filter((p:{type:string})=>p.type==='image_url').length>=2)
      return response({slides:data.slides.filter((s:{target:boolean})=>s.target).map((s:{slideId:string;sceneHash:string})=>({slideId:s.slideId,sceneHash:s.sceneHash,verdict:reviews===1?'revise':'pass',action:reviews===1?'adjust':'keep',issues:reviews===1?[{category:'hierarchy',evidence:'Основной акцент теряется в одинаковых цветах.',instruction:'Используй синий акцент из палитры.'}]:[]}))})
    }
    const scene=deckScene(input);if(++scenes>1)scene.colors.find(c=>c.role==='purple')!.hex='#0077FF'
    return response(scene)
  })
  const action={action:'advance' as const,inputId:f.context.inputId,reference:await png(),evidence:deckEvidence()}
  for(let step=0;step<16;step++) {
    const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute?.()
    const slide=job.state.slides[0],last=slide.attempts.at(-1)
    if(slide.status==='render')await startDeckAction(f.bucket,f.context,{action:'report',inputId:f.context.inputId,slideId:input.slideId,report:report(last!.sceneHash!),preview:await png()},config)
    if(job.state.status==='ready')break
  }
  const state=(await readDeck(f.bucket,f.context))!
  assert.equal(state.status,'ready');assert.equal(reviews,2);assert.equal(scenes,2);assert.equal(calls,4)
  assert.equal(state.rounds.length,2);assert.equal(state.slides[0].attempts[1].correctionRound,1)
  for(const attempt of state.slides[0].attempts)assert.equal(boundText(attempt.scene!.texts[1],input),input.content[1].text)
  await startDeckAction(f.bucket,f.context,action,config);assert.equal(calls,4)
  const targets=state.rounds[1].targets
  assert.throws(()=>validateVisualReview({slides:[{slideId:targets[0].slideId,sceneHash:'old',verdict:'pass',action:'keep',issues:[]}]},targets))
  state.rounds[1].targets[0].sceneHash='0'.repeat(64)
  await f.bucket.put(`${f.context.prefix}/state.json`,JSON.stringify(state))
  await assert.rejects(()=>readDeck(f.bucket,f.context),/проверка|колоде/)
})

test('global budget blocks further paid work, including auxiliary stages, without dropping source or previews',async t=>{
  const f=await fixture();t.mock.method(globalThis,'fetch',async()=>response(deckScene(f.context.inputs[0])))
  const action={action:'advance' as const,inputId:f.context.inputId,reference:await png(),evidence:deckEvidence()}
  const first=await startDeckAction(f.bucket,f.context,action,config);await first.execute!()
  first.state.slides[0].status='pending';first.state.slides[0].attempts[0].requests=MAX_DECK_REQUESTS
  await f.bucket.put(`${f.context.prefix}/state.json`,JSON.stringify(first.state))
  const stopped=await startDeckAction(f.bucket,f.context,action,config)
  assert.equal(stopped.execute,null);assert.equal(stopped.state.status,'blocked');assert.match(stopped.state.error!,/лимит/)
})

test('replacement first offers a more spacious same-family option, then an eligible different family, with no revisits',()=>{
  const input=deckInput();input.variant=acceptedVariants.find(v=>v.id==='editorial-insight-04--1')!
  input.brand.resources=[{id:'panel',name:'Подложка',roles:['background'],width:1000,height:600,uses:['panel']},{id:'art',name:'Иллюстрация',roles:['illustration'],width:600,height:600,uses:['art']}]
  const slide={id:input.slideId,kind:'statement' as const,heading:{fragmentId:'f1',text:'Заголовок'},blocks:Array.from({length:4},(_,i)=>({kind:'text' as const,role:'support' as const,fragmentIds:[`f${i+2}`],text:`Тезис ${i+1}`})),directions:[]}
  const same=replacementChoices(input,slide,[input.variant.id],[{code:'text-overflow',message:'Недостаточно строк'}])
  assert.deepEqual(same.map(v=>v.id),['editorial-insight-04--3'])
  const other=replacementChoices({...input,variant:same[0]},slide,[input.variant.id,same[0].id],[{code:'text-overflow',message:'Недостаточно строк'}])
  assert.ok(other.length);assert.ok(other.every(v=>v.recipe.id!=='editorial-insight-04'))
})

test('saved resource-search reply survives a process interruption without a second request',async t=>{
  const base=compileDeckScene(deckScene(),deckInput()).scene.elements.find(e=>e.kind==='rectangle')!
  const resource:ComponentDefinition={id:'art',name:'Фирменная графика',kind:'atom',source:{slide:1,rootId:'a',elementIds:['a'],ancestorIds:[],assetIds:[]},scene:{width:1920,height:1080,elements:[{...base,zIndex:0}]},slots:[],fixedTextIds:[],issues:[],semantics:[{findingId:'a',name:'Графика',role:'decoration',basis:'test'}]}
  const f=await fixture(1,false,{resources:[resource]}),action={action:'advance' as const,inputId:f.context.inputId};let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return response({selections:[{slideId:'slide-1',ranked:[{componentId:'art',score:90,reason:'Соответствует стилю'}]}]})})
  const init=await startDeckAction(f.bucket,f.context,action,config)
  await startDeckAction(f.bucket,f.context,{action:'catalog',inputId:f.context.inputId,pageId:init.state.pages[0].id,evidence:{...deckEvidence(),resourceIds:['art'],sheet:await png()}},config)
  const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute!()
  const record=job.state.jobs[0];record.status='running';delete record.raw;delete record.result;delete record.applied
  await f.bucket.put(`${f.context.prefix}/state.json`,JSON.stringify(job.state))
  const restored=await startDeckAction(f.bucket,f.context,action,config)
  assert.equal(restored.execute,null);assert.equal(restored.state.jobs[0].status,'complete');assert.equal(calls,1)
  assert.equal(nextOperation(f.context,restored.state).kind,'evidence')
})

test('Q6 remaining visual defects stop at the second review; technical fit alone never becomes approved',async t=>{
  const f=await fixture(),input=f.context.inputs[0];let calls=0,scenes=0
  t.mock.method(globalThis,'fetch',async(_url:string|URL|Request,init?:RequestInit)=>{
    calls++;const body=JSON.parse(init!.body as string)
    if(body.response_format.json_schema.name!=='presentation_visual_review') {
      const scene=deckScene(input);if(++scenes>1)scene.colors.find(c=>c.role==='purple')!.hex='#0077FF'
      return response(scene)
    }
    const data=JSON.parse(body.messages[1].content[0].text)
    return response({slides:data.slides.filter((s:{target:boolean})=>s.target).map((s:{slideId:string;sceneHash:string})=>({slideId:s.slideId,sceneHash:s.sceneHash,verdict:'revise',action:'adjust',issues:[{category:'balance',evidence:'Визуальная проблема сохраняется.',instruction:'Исправь в рамках выбранного рецепта.'}]}))})
  })
  const action={action:'advance' as const,inputId:f.context.inputId,reference:await png(),evidence:deckEvidence()}
  for(let step=0;step<16;step++){
    const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute?.()
    const slide=job.state.slides[0],last=slide.attempts.at(-1)
    if(slide.status==='render')await startDeckAction(f.bucket,f.context,{action:'report',inputId:f.context.inputId,slideId:slide.id,report:report(last!.sceneHash!),preview:await png()},config)
    if(job.state.status==='blocked')break
  }
  const state=(await readDeck(f.bucket,f.context))!
  assert.equal(state.status,'blocked');assert.equal(state.rounds.length,2);assert.equal(state.slides[0].fittedAttempt,2);assert.equal(calls,4)
  await startDeckAction(f.bucket,f.context,{...action,retry:true},config);assert.equal(calls,4)
})

test('a visual repair that returns the same scene selects another option instead of reviewing the unchanged result',async t=>{
  const f=await fixture(1,false,{text:'# Заголовок'}),input=f.context.inputs[0],original=JSON.stringify(input.content);let selections=0
  t.mock.method(globalThis,'fetch',async(_url:string|URL|Request,init?:RequestInit)=>{
    const body=JSON.parse(init!.body as string),name=body.response_format.json_schema.name
    if(name==='presentation_visual_review') {
      const data=JSON.parse(body.messages[1].content[0].text),slide=data.slides[0]
      assert.ok(slide.recipe.textSlots.every((s:{maxYOffset:number})=>s.maxYOffset===0))
      return response({slides:[{slideId:slide.slideId,sceneHash:slide.sceneHash,verdict:'revise',action:'adjust',issues:[{category:'hierarchy',evidence:'Акцент нуждается в изменении.',instruction:'Улучши акцент в пределах разрешённой опции.'}]}]})
    }
    if(name==='presentation_recipe_reselection') {
      selections++;assert.match(body.messages[1].content[0].text,/visual-unchanged/)
      return response({variantId:body.response_format.json_schema.schema.properties.variantId.anyOf[0].enum[0],reason:'Выбрана другая совместимая опция'})
    }
    return response(deckScene(input))
  })
  const action={action:'advance' as const,inputId:f.context.inputId,reference:await png(),evidence:deckEvidence()}
  for(let step=0;step<12&&!selections;step++) {
    const job=await startDeckAction(f.bucket,f.context,action,config);await job.execute?.()
    const slide=job.state.slides[0],attempt=slide.attempts.at(-1)
    if(slide.status==='render') {
      const measured=report(attempt!.sceneHash!);measured.texts=measured.texts.filter(t=>attempt!.scene!.texts.some(s=>s.id===t.id))
      await startDeckAction(f.bucket,f.context,{action:'report',inputId:f.context.inputId,slideId:slide.id,report:measured,preview:await png()},config)
    }
  }
  const state=(await readDeck(f.bucket,f.context))!,slide=state.slides[0]
  assert.equal(selections,1);assert.equal(slide.tried.length,2);assert.equal(state.rounds.length,1)
  assert.equal(slide.attempts.length,2);assert.equal(slide.attempts[0].sceneHash,slide.attempts[1].sceneHash)
  assert.equal(JSON.stringify(slideInput(f.context,state,slide).content),original)
  assert.equal(nextOperation(f.context,state).kind,'scene')
})
