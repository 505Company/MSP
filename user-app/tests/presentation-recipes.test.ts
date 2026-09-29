import { seedQualifiedCatalogFixture } from './helpers/calibrated-catalog'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { acceptedVariants, recipeCatalogIdentity, recipeFamilies, selectorCatalog } from '../lib/presentations/recipes/catalog'
import provenance from '../lib/presentations/recipes/archive/accepted-10-v1/provenance.json'
import { recipeBrand } from '../lib/presentations/recipe-brand'
import { recipeExclusions, recipeSlides, validateRecipeReply, type RecipePart, type RecipeReply, type RecipeSlide } from '../lib/presentations/recipe-selection'
import { readRecipePlan, recipeContext, startRecipePlan, type RecipeContext } from '../lib/presentations/recipe-plan'
import { structureContext, readStructure, type StructureState } from '../lib/presentations/structure'
import { assembleOutline, OUTLINE_VERSION } from '../lib/presentations/outline'
import { createProject, updateProject, addBankStyle, archiveProject } from '../lib/workspace/storage'
import { installSemanticCatalog } from '../lib/design-system/catalog'
import type { ComponentLibrary } from '../lib/design-system/types'
import type { SemanticMetadata } from '../lib/design-system/semantic-library'
import type { BankStyle } from '../lib/workspace/types'
import { memoryBucket } from './helpers/memory-bucket'

const config = { apiKey: 'test-only-key', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
const library: ComponentLibrary = { schemaVersion: 1, compilerVersion: 'test-semantic', sourceId: 'a'.repeat(64), name: 'Test brand',
  tokens: { colors: [{ hex: '#000000', occurrences: 1 }, { hex: '#FFFFFF', occurrences: 1 }], fonts: [{ family: 'Arial', sizes: [32], occurrences: 1 }] },
  components: [], excluded: [], notes: [] }
const semantic: SemanticMetadata = { version: 'test', sourceRevision: 'a'.repeat(64), coverage: { records: 0, processed: 0, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] }
const brand = () => recipeBrand('style', 'catalog', library, semantic)
const payload = (c: RecipeContext) => ({ inputId: c.inputId, materialId: c.structure.material.id, uploadId: c.brand.uploadId })
function validReply(part: RecipePart): RecipeReply { return { selections: part.slides.map(s => ({ slideId: s.id, recipeId: 'minimal-center-38', variantId: 'minimal-center-38--3', reason: 'Тезис и короткое продолжение.' })) } }
function response(raw: unknown) { return new Response(JSON.stringify({ id: 'test', model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }], usage: { total_tokens: 50 } }), { headers: { 'Content-Type': 'application/json' } }) }
async function fixture(slides = 2) {
  const store = memoryBucket()
  const style: BankStyle = { id: crypto.randomUUID(), name: 'Тест', fileName: 'test.pptx', sourceId: library.sourceId, createdAt: new Date().toISOString(), slideCount: 1, componentCount: 0, styleCount: 2, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  await installSemanticCatalog(store.bucket, style.id, library, semantic)
  await seedQualifiedCatalogFixture(store.bucket, style.id)
  const text = Array.from({ length: slides }, (_, i) => `# Тезис ${i + 1}\nДо 42,5 % — только при условии. 🧭`).join('\n\n')
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Test recipes', uploadId: style.id, text }, style)
  const sc = await structureContext(store.bucket, project.id, config)
  // Explicit isolated Q2 fixture; no claim of a live model decision in unit tests.
  const outline = assembleOutline(sc.material, sc.parts, sc.parts.map(part => {
    const sections = [...new Set(part.fragments.map(f => f.sectionId))]
    return { slides: sections.map(section => { const fs = part.fragments.filter(f => f.sectionId === section); return {
      kind: 'statement' as const, headingFragmentId: fs[0].id, fragmentIds: fs.map(f => f.id),
      blocks: fs.slice(1).map(f => ({ kind: 'text' as const, role: 'support' as const, fragmentIds: [f.id] })) } }) }
  }))
  const structure: StructureState = { version: OUTLINE_VERSION, id: crypto.randomUUID(), materialId: sc.material.id, projectId: project.id,
    sourceRevision: project.revision, status: 'ready', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    completedParts: sc.parts.length, totalParts: sc.parts.length, liveRequests: 0, cacheHits: 0, modelRunIds: [], outline }
  await store.bucket.put(`${sc.prefix}/state.json`, JSON.stringify(structure))
  return { ...store, project, style, library, semantic, structure, context: await recipeContext(store.bucket, project.id, config) }
}

test('all 10 accepted families and 30 definitions/reference PNGs retain their exact provenance', async () => {
  const sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex')
  assert.equal(sha(await readFile('lib/presentations/recipes/archive/accepted-10-v1/accepted-10-v1.json')), provenance.catalogSha256)
  for (const family of new Set(acceptedVariants.map(e => e.recipe.id))) assert.equal(acceptedVariants.filter(e => e.recipe.id === family).length, 3)
  for (const e of acceptedVariants) {
    assert.equal(e.humanAcceptance, 'accepted')
    assert.equal(sha(await readFile(`public/recipes/accepted-10-v1/${e.preview}`)), provenance.previews[e.preview as keyof typeof provenance.previews])
  }
  assert.match(await recipeCatalogIdentity(), /^[a-f0-9]{64}$/)
  assert.equal(recipeFamilies.length, 10); assert.equal(selectorCatalog().length, 10)
  assert.ok(selectorCatalog().every(f => f.variants.length === 3 && f.variants.every(v => v.id.startsWith(f.id + '--'))))
  // Legacy base templates differed from the demonstrated count in these two
  // gallery cases. Use the pre-existing count options, not new recipe families.
  assert.equal(acceptedVariants.find(e => e.id === 'evidence-mosaic-05--2')!.recipe.variantId, 'four-metrics')
  assert.equal(acceptedVariants.find(e => e.id === 'case-cards-02--3')!.recipe.elements.filter(e => e.slot?.startsWith('question')).length, 4)
  for (const [id, row] of Object.entries(provenance.qualifiedOptions)) {
    assert.ok(acceptedVariants.some(e => e.id === id)); assert.match(row.sha256, /^[a-f0-9]{64}$/)
  }
})

test('recipe input uses exact source heading and body, never Q2 navigation labels; directions remain separate', async () => {
  const f = await fixture(), outline = structuredClone(f.context.outline)
  outline.slides[0].title = 'Слайд 1'
  const slides = recipeSlides(f.context.structure.material, outline)
  assert.equal(slides[0].heading!.text, 'Тезис 1')
  assert.equal(slides[0].blocks[0].text, 'До 42,5 % — только при условии. 🧭')
  assert.deepEqual(slides[0].blocks[0].fragmentIds, ['f2'])
})

test('prerequisites reject metric mosaics without five metrics, missing art, wrong row counts and body in minimal short', () => {
  const b = brand(); b.resources = [{ id: 'art', name: 'Art', roles: ['illustration'], width: 100, height: 100, uses: ['art', 'panel', 'circle'] }]
  const slide: RecipeSlide = { id: 'slide-1', kind: 'metrics', heading: { fragmentId: 'f1', text: 'Результат' }, directions: [],
    blocks: [{ kind: 'metric', role: 'primary', fragmentIds: ['f2'], text: '42 участника' }] }
  const excludes = (id: string) => recipeExclusions(acceptedVariants.find(e => e.id === id)!, slide, b)
  assert.ok(excludes('evidence-mosaic-05--1').includes('requires-five-supplied-metric-blocks'))
  assert.ok(excludes('advantage-rows-53--1').includes('requires-five-items'))
  assert.ok(excludes('minimal-center-38--1').includes('body-requires-dense-variant'))
  slide.blocks = Array.from({ length: 5 }, (_, i) => ({ kind: 'metric', role: 'primary', fragmentIds: [`f${i + 2}`], text: `${i + 1} участник` }))
  assert.deepEqual(excludes('evidence-mosaic-05--1'), [])
  slide.blocks[0].text = 'Без чисел'
  assert.ok(excludes('evidence-mosaic-05--1').length)
  slide.blocks = slide.blocks.slice(0, 3)
  assert.ok(excludes('benefit-columns-26--1').includes('requires-three-benefits-and-separate-context'))
  slide.blocks.push({ kind: 'text', role: 'support', fragmentIds: ['f99'], text: 'Отдельный предоставленный контекст.' })
  assert.deepEqual(excludes('benefit-columns-26--1'), [])
  b.resources = []
  assert.ok(excludes('evidence-mosaic-05--3').some(e => e.startsWith('missing-art:')))
})

test('only eligible source resources enter the brand context; no invented font or Figma lookup', () => {
  const l = structuredClone(library)
  const base = { id: 'panel', name: 'Panel', bounds: { x: 0, y: 0, width: 200, height: 100 }, visible: true, opacity: 1, rotation: 0, zIndex: 0 }
  l.components = [{ id: 'panel', name: 'Surface', kind: 'atom', source: { slide: 1, rootId: 'panel', elementIds: ['panel'], ancestorIds: [], assetIds: [] },
    scene: { width: 200, height: 100, elements: [{ ...base, kind: 'rectangle' }] }, slots: [], fixedTextIds: [], issues: [], semantics: [{ findingId: 'p', name: 'Surface', role: 'background', basis: 'visual_observation' }] }]
  const b = recipeBrand('style', 'catalog', l, semantic)
  assert.equal(b.resources.length, 1); assert.deepEqual(b.resources[0].uses, ['panel'])
  l.components[0].issues.push({ code: 'unrenderable', severity: 'blocking', message: 'Unsupported' })
  assert.equal(recipeBrand('style', 'catalog', l, semantic).resources.length, 0)
  assert.throws(() => recipeBrand('style', 'catalog', l), /разбор/)
  assert.deepEqual(b.tokens.fonts, library.tokens.fonts)
})

test('reply rejects unknown recipes, missing/duplicate/reordered slides and added text; incompatibility is explicit', async () => {
  const f = await fixture(), part = f.context.parts[0], good = validReply(part)
  const mutations: Array<(r: RecipeReply) => void> = [
    r => { r.selections.pop() }, r => { r.selections.reverse() }, r => { r.selections[1].slideId = r.selections[0].slideId },
    r => { r.selections[0].recipeId = 'split-feature-03' }, r => { r.selections[0].variantId = 'invented--1' }, r => { r.selections[0].variantId = 'evidence-mosaic-05--1' },
    r => { Object.assign(r.selections[0], { text: 'Новое содержание' }) },
  ]
  for (const change of mutations) { const bad = structuredClone(good); change(bad); assert.throws(() => validateRecipeReply(bad, part, f.context.brand)) }
  good.selections[0].variantId = null; good.selections[0].recipeId = null
  assert.equal(validateRecipeReply(good, part, f.context.brand).selections[0].variantId, null)
})

test('saved plan reuses exact choices; changing style/catalog invalidates Q3 but preserves Q2 and history', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(validReply(f.context.parts[0])) })
  const job = await startRecipePlan(f.bucket, f.context, payload(f.context), config); await job.execute!()
  assert.equal(job.state.status, 'ready'); assert.equal(job.state.fitVerified, false)
  const cached = await startRecipePlan(f.bucket, await recipeContext(f.bucket, f.project.id, config), payload(f.context), config)
  assert.equal(cached.execute, null); assert.equal(cached.state.id, job.state.id); assert.equal(calls, 1)
  assert.ok([...f.data.values()].every(v => !v.value.includes(config.apiKey)))
  const style = { ...f.style, id: crypto.randomUUID(), name: 'Other' }; await addBankStyle(f.bucket, style)
  await installSemanticCatalog(f.bucket, style.id, f.library, f.semantic)
  await seedQualifiedCatalogFixture(f.bucket, style.id)
  let project = await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: f.project.text, uploadId: style.id })
  const changed = await recipeContext(f.bucket, project.id, config)
  assert.notEqual(changed.inputId, f.context.inputId); assert.equal(await readRecipePlan(f.bucket, changed), null)
  assert.equal((await readStructure(f.bucket, await structureContext(f.bucket, project.id, config)))!.id, f.structure.id)
  await assert.rejects(() => startRecipePlan(f.bucket, changed, payload(f.context), config), /изменились/)
  project = await updateProject(f.bucket, project.id, { baseRevision: project.revision, name: project.name, text: project.text, uploadId: f.style.id })
  assert.equal((await readRecipePlan(f.bucket, await recipeContext(f.bucket, project.id, config)))!.id, job.state.id)
  await installSemanticCatalog(f.bucket, f.style.id, { ...library, name: 'Catalog revision' }, semantic)
  await seedQualifiedCatalogFixture(f.bucket, f.style.id)
  assert.notEqual((await recipeContext(f.bucket, project.id, config)).inputId, f.context.inputId)
  assert.ok(f.data.has(`${f.context.prefix}/input.json`))
})

test('concurrent plans pay once and an edit during a response cannot publish stale choices', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: f.project.text + '\nНовое условие.' })
    return response(validReply(f.context.parts[0]))
  })
  const attempts = await Promise.allSettled([1, 2].map(() => startRecipePlan(f.bucket, f.context, payload(f.context), config)))
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1)
  const job = (attempts.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof startRecipePlan>>>).value
  await assert.rejects(() => job.execute!(), /обновились/)
  assert.equal(calls, 1); assert.equal(job.state.status, 'failed'); assert.equal(job.state.selections, undefined)
  await assert.rejects(() => recipeContext(f.bucket, f.project.id, config), /структуру/)
})

test('one repair is bounded and completed parts survive a failed request without repeated payment', async t => {
  const f = await fixture(13); let calls = 0, fail = true
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content)
    if (input.slides[0].id === 'slide-13' && fail) return new Response('', { status: 503 })
    return response(validReply({ id: 'mock', slides: input.slides }))
  })
  const first = await startRecipePlan(f.bucket, f.context, payload(f.context), config)
  await assert.rejects(() => first.execute!()); assert.equal(first.state.completedParts, 1); assert.equal(first.state.selections, undefined)
  fail = false
  const next = await startRecipePlan(f.bucket, f.context, payload(f.context), config); await next.execute!()
  assert.equal(next.state.status, 'ready'); assert.equal(calls, 3); assert.equal(next.state.cacheHits, 1); assert.equal(next.state.liveRequests, 1)
  assert.equal(next.state.selections!.length, 13)
})

test('two invalid answers never install a plan; blocked replies are cached without forced selection or paid retry', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ selections: [] }) })
  const bad = await startRecipePlan(f.bucket, f.context, payload(f.context), config)
  await assert.rejects(() => bad.execute!()); assert.equal(calls, 2); assert.equal(bad.state.selections, undefined)
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ selections: f.context.parts[0].slides.map(s => ({ slideId: s.id, recipeId: null, variantId: null, reason: 'Нет совместимого варианта.' })) }) })
  const blocked = await startRecipePlan(f.bucket, f.context, payload(f.context), config); await blocked.execute!()
  assert.equal(blocked.state.status, 'blocked'); assert.equal(calls, 3)
  assert.equal((await startRecipePlan(f.bucket, f.context, payload(f.context), config)).execute, null)
  await archiveProject(f.bucket, f.project.id, f.project.revision)
  await assert.rejects(() => recipeContext(f.bucket, f.project.id, config), /не найден/)
})

test('new generation requires a calibrated catalog, while source definitions remain available', async () => {
  const f = await fixture()
  await f.bucket.delete(`component-calibration/${f.style.id}/${f.context.brand.catalogId}/component-families-1/current.json`)
  await assert.rejects(() => recipeContext(f.bucket, f.project.id, config), /откалибруйте компоненты/)
  await seedQualifiedCatalogFixture(f.bucket, f.style.id)
  assert.equal((await recipeContext(f.bucket, f.project.id, config)).brand.calibrationId, f.context.brand.calibrationId)
})
