import test from 'node:test'
import assert from 'node:assert/strict'
import { materialParts, prepareMaterial, visibleFragmentText, type MaterialPart } from '../lib/presentations/material'
import { assembleOutline, validateOutlineReply, OUTLINE_VERSION, type OutlineReply } from '../lib/presentations/outline'
import { readStructure, startStructure, structureContext } from '../lib/presentations/structure'
import { createProject, updateProject, addBankStyle } from '../lib/workspace/storage'
import type { BankStyle } from '../lib/workspace/types'
import { memoryBucket } from './helpers/memory-bucket'

function validReply(part: MaterialPart): OutlineReply {
  const groups: typeof part.fragments[] = []
  for (const f of part.fragments) {
    if (!groups.length || part.explicitBoundaries && groups.at(-1)![0].sectionId !== f.sectionId) groups.push([])
    groups.at(-1)!.push(f)
  }
  return { slides: groups.map(fs => ({ kind: 'list', headingFragmentId: null, fragmentIds: fs.map(f => f.id),
    blocks: fs.filter(f => f.kind === 'content').map(f => ({ kind: 'text', role: 'primary', fragmentIds: [f.id] })) })) }
}
function providerResponse(raw: unknown) {
  return new Response(JSON.stringify({ id: 'test-request', model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }), { headers: { 'Content-Type': 'application/json' } })
}
const config = { apiKey: 'test-only-key', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
async function projectFixture(text: string) {
  const store = memoryBucket()
  const style: BankStyle = { id: crypto.randomUUID(), name: 'Тест', fileName: 'test.pptx', sourceId: 'a'.repeat(64), createdAt: new Date().toISOString(), slideCount: 1, componentCount: 10, styleCount: 5, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Проверка структуры', uploadId: style.id, text }, style)
  const context = await structureContext(store.bucket, project.id, config)
  return { ...store, project, context, style }
}

test('material preserves exact UTF-16 source spans, repeated text, punctuation and explicit slide boundaries', async () => {
  const text = '  Вступление\r\n\r\n# Цель\nДо 42,5 % — только при условии. 🧭\nДо 42,5 % — только при условии. 🧭\nСлайд 2 — Итог\nБез новых фактов.'
  const m = await prepareMaterial(text), parts = materialParts(m), outline = assembleOutline(m, parts, parts.map(validReply))
  assert.equal(outline.slides.length, 3)
  for (const f of m.fragments) assert.equal(text.slice(f.start, f.end), f.text)
  assert.notEqual(m.fragments[2].id, m.fragments[3].id)
  assert.deepEqual(outline.slides.flatMap(s => s.fragmentIds), m.fragments.map(f => f.id))
  assert.equal(visibleFragmentText(m.fragments.at(-2)!), 'Итог')
  assert.equal((await prepareMaterial(text)).id, m.id)
  assert.notEqual((await prepareMaterial(text + ' ')).id, m.id)
})

test('standalone slide labels are structural boundaries, not missing printed content', async () => {
  const material = await prepareMaterial('Слайд 1\nПервый тезис\nСлайд 2\nВторой тезис')
  const saved: OutlineReply = { slides: [
    { kind: 'statement', headingFragmentId: null, fragmentIds: ['f1', 'f2'], blocks: [{ kind: 'text', role: 'primary', fragmentIds: ['f2'] }] },
    { kind: 'statement', headingFragmentId: null, fragmentIds: ['f3', 'f4'], blocks: [{ kind: 'text', role: 'primary', fragmentIds: ['f4'] }] },
  ] }
  assert.doesNotThrow(() => validateOutlineReply(saved, materialParts(material)[0]))
  assert.equal(material.explicitBoundaries, true)
  assert.equal(new Set(material.fragments.map(f => f.sectionId)).size, 2)
  for (const f of material.fragments) assert.equal(material.text.slice(f.start, f.end), f.text)
  const outline = assembleOutline(material, materialParts(material), [saved])
  assert.deepEqual(outline.slides.map(s => s.boundaryIds), [['f1'], ['f3']])
  assert.deepEqual(outline.slides.map(s => s.directionIds), [[], []])
  assert.deepEqual(outline.coverage, { fragments: 4, contentFragments: 2, directionFragments: 0, boundaryFragments: 2, complete: true })
  const printed = structuredClone(saved); printed.slides[0].blocks.unshift({ kind: 'text', role: 'support', fragmentIds: ['f1'] })
  assert.throws(() => validateOutlineReply(printed, materialParts(material)[0]))
})

test('slide labels retain code and ordinary phrases; blank explicit slides fail before a model call', async () => {
  const material = await prepareMaterial('Визуально: светлый фон\nСлайд 1:\nПервый тезис\nСлайд 2 из 5\nSlide 2.\nВторой тезис\n```txt\nСлайд 3\n```\nСлайд 3 — Настоящий заголовок\nЗаключение')
  assert.deepEqual(material.fragments.filter(f => f.kind === 'boundary').map(f => f.text), ['Слайд 1:', 'Slide 2.'])
  assert.equal(material.fragments.find(f => f.text === 'Слайд 2 из 5')!.kind, 'content')
  assert.equal(material.fragments.find(f => f.text === 'Слайд 3')!.kind, 'content')
  assert.equal(material.fragments[0].sectionId, 'section-1')
  const parts = materialParts(material), outline = assembleOutline(material, parts, parts.map(validReply))
  assert.equal(outline.slides.length, 3)
  assert.equal(visibleFragmentText(material.fragments.at(-2)!), 'Настоящий заголовок')
  const empty = await prepareMaterial('Слайд 1\nСлайд 2\nТезис')
  assert.throws(() => materialParts(empty), /Пустой слайд/)
})

async function legacyBoundaryFixture() {
  const f = await projectFixture('Слайд 1\nПервый тезис\nСлайд 2\nВторой тезис'), runId = crypto.randomUUID(), stateId = crypto.randomUUID()
  const oldMaterial = { ...f.context.material, parserVersion: undefined, explicitBoundaries: false, fragments: f.context.material.fragments.map(part => ({ ...part, kind: 'content', sectionId: null })) }
  const oldState = { id: stateId, version: 'web-presentation-outline-1', materialId: oldMaterial.id, projectId: f.project.id, sourceRevision: f.project.revision, status: 'failed', completedParts: 0, totalParts: 1, liveRequests: 2, cacheHits: 0, modelRunIds: [runId], error: { code: 'SEMANTIC_VALIDATION' } }
  const raw = validReply(f.context.parts[0]), prefix = `${f.context.legacyPrefix}/parts/part-1`
  const responseKey = `${prefix}/clarifications/${runId}/response.json`
  await f.bucket.put(`presentation-structures/${f.project.id}/materials/${oldMaterial.id}.json`, JSON.stringify(oldMaterial))
  await f.bucket.put(`${f.context.legacyPrefix}/state.json`, JSON.stringify(oldState))
  await f.bucket.put(`${prefix}/runs/${runId}.json`, JSON.stringify({ id: runId, status: 'failed', scope: { materialId: oldMaterial.id, partId: 'part-1' }, clarificationRequests: 1 }))
  await f.bucket.put(responseKey, JSON.stringify({ content: JSON.stringify(raw) }))
  return { ...f, oldState, responseKey, raw }
}

test('corrected parser replays immutable failed Qwen response without another request or source edits', async t => {
  const f = await legacyBoundaryFixture(), original = new Map([...f.data].map(([key, value]) => [key, value.value]))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Replay must not call Qwen') })
  const attempts = await Promise.all([readStructure(f.bucket, f.context), readStructure(f.bucket, f.context)])
  assert.equal(attempts[0]!.id, attempts[1]!.id)
  const ready = attempts[0]!
  assert.equal(ready.version, OUTLINE_VERSION); assert.equal(ready.status, 'ready'); assert.equal(ready.liveRequests, 0)
  assert.equal(ready.outline!.slides.length, 2); assert.equal(ready.outline!.coverage.contentFragments, 2)
  assert.equal(ready.replayedFrom!.runId, f.oldState.id)
  assert.deepEqual(ready.outline!.slides.map(({ kind, headingFragmentId, fragmentIds, blocks }) => ({ kind, headingFragmentId, fragmentIds, blocks })), f.raw.slides)
  for (const [key, value] of original) assert.equal(f.data.get(key)!.value, value, key)
  assert.equal((await startStructure(f.bucket, f.context, f.context.material.id, { ...config, apiKey: '' })).execute, null)
  assert.equal((await readStructure(f.bucket, f.context))!.id, ready.id)
})

test('legacy replay cannot conceal missing content, wrong source or crossed slide boundaries', async () => {
  for (const defect of ['missing', 'merged', 'source']) {
    const f = await legacyBoundaryFixture()
    if (defect === 'missing') f.raw.slides[0].blocks = []
    if (defect === 'merged') {
      f.raw.slides[0].fragmentIds.push(...f.raw.slides[1].fragmentIds)
      f.raw.slides[0].blocks.push(...f.raw.slides[1].blocks); f.raw.slides.pop()
    }
    if (defect === 'source') {
      const key = `presentation-structures/${f.project.id}/materials/${f.context.material.id}.json`, saved = JSON.parse(f.data.get(key)!.value)
      saved.fragments[1].text = 'Different source'; await f.bucket.put(key, JSON.stringify(saved))
    }
    await f.bucket.put(f.responseKey, JSON.stringify({ content: JSON.stringify(f.raw) }))
    assert.equal(await readStructure(f.bucket, f.context), null, defect)
    assert.equal(f.data.has(`${f.context.prefix}/state.json`), false)
  }
})

test('a failed request during parser upgrade cannot prevent recovery from the validated old answer', async t => {
  const f = await legacyBoundaryFixture()
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Recovery must not call Qwen') })
  const interrupted = JSON.stringify({ ...f.oldState, version: OUTLINE_VERSION, id: 'new-failure', error: { code: 'QWEN_UNAVAILABLE' } })
  const runKey = `${f.context.prefix}/runs/new-failure.json`
  await f.bucket.put(runKey, interrupted); await f.bucket.put(`${f.context.prefix}/state.json`, interrupted)
  const result = await readStructure(f.bucket, f.context)
  assert.equal(result!.status, 'ready'); assert.equal(result!.liveRequests, 0)
  assert.equal(result!.replayedFrom!.runId, f.oldState.id)
  assert.equal(f.data.get(runKey)!.value, interrupted)
})

test('only explicit direction syntax is non-printing; code and following ordinary prose remain content', async () => {
  const m = await prepareMaterial('# План\nВизуально: три карточки\nОформление:\nДо 5 дней, включая согласование.\n```txt\n# не граница\nВизуально: это пример кода\n```\n→\nИтог.')
  assert.equal(m.fragments.filter(f => f.kind === 'direction').length, 3)
  assert.equal(m.fragments.find(f => f.text.startsWith('До 5'))?.kind, 'content')
  assert.equal(m.fragments.find(f => f.text.includes('пример кода'))?.kind, 'content')
  assert.equal(new Set(m.fragments.map(f => f.sectionId)).size, 1)
  const p = materialParts(m)[0], good = validReply(p)
  const bad = structuredClone(good); bad.slides[0].blocks.push({ kind: 'text', role: 'support', fragmentIds: [m.fragments[1].id] })
  assert.throws(() => validateOutlineReply(bad, p), /содержание/)
  const leading = await prepareMaterial('Визуально: светлая подача\n# Цель\n42 участника')
  assert.equal(new Set(leading.fragments.map(f => f.sectionId)).size, 1)
  assert.equal(assembleOutline(leading, materialParts(leading), materialParts(leading).map(validReply)).slides.length, 1)
})

test('100k prose is bounded into exact cached parts without splitting surrogate pairs', async () => {
  const text = ('Факт 🧭 и число 42. '.repeat(6000)).slice(0, 100000), m = await prepareMaterial(text), parts = materialParts(m)
  assert.ok(parts.length > 1)
  assert.ok(parts.every(p => p.fragments.length <= 120 && p.fragments.reduce((n, f) => n + f.text.length, 0) <= 24000))
  assert.equal(m.fragments.map(f => f.text).join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''))
  for (const f of m.fragments) { assert.equal(text.slice(f.start, f.end), f.text); assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(f.text)) }
  assert.equal(assembleOutline(m, parts, parts.map(validReply)).coverage.complete, true)
  const explicit = await prepareMaterial('# Один слайд\n' + 'а'.repeat(25000))
  assert.throws(() => materialParts(explicit), /одном заданном слайде/)
  await assert.rejects(() => prepareMaterial('а'.repeat(100001)))
})

test('model cannot omit, duplicate, reorder, invent text, hide a body fragment or cross explicit boundaries', async () => {
  const m = await prepareMaterial('# Цель\n42 участника\nОговорка: до конца года.\n# Результат\n3 команды'), p = materialParts(m)[0]
  const good = validReply(p)
  const mutations: Array<(r: OutlineReply) => void> = [
    r => { r.slides[0].fragmentIds.pop() },
    r => { r.slides[0].fragmentIds.push('f1') },
    r => { r.slides[0].fragmentIds[1] = 'f999' },
    r => { r.slides.reverse() },
    r => { r.slides[0].blocks.pop() },
    r => { r.slides[0].headingFragmentId = 'f2' },
    r => { r.slides[0].fragmentIds.push(...r.slides[1].fragmentIds); r.slides[0].blocks.push(...r.slides[1].blocks); r.slides.pop() },
    r => { Object.assign(r.slides[0], { title: 'Выдуманный факт' }) },
  ]
  for (const change of mutations) { const bad = structuredClone(good); change(bad); assert.throws(() => validateOutlineReply(bad, p)) }
  assert.deepEqual(validateOutlineReply(good, p), good)
  const headed = structuredClone(good); headed.slides[0].headingFragmentId = 'f1'; headed.slides[0].blocks.shift()
  assert.equal(assembleOutline(m, [p], [headed]).slides[0].title, 'Цель')
})

test('structure runs persist exact model inputs; changing style reuses Q2, changing text preserves old results', async t => {
  const f = await projectFixture('# Цель\n42 участника\n# Итог\n3 команды'); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content)
    return providerResponse(validReply({ id: 'part-1', ...input }))
  })
  const job = await startStructure(f.bucket, f.context, f.context.material.id, config); await job.execute!()
  assert.equal(job.state.status, 'ready'); assert.equal(calls, 1)
  const keysBefore = [...f.data.keys()]
  const otherStyle = { ...f.style, id: crypto.randomUUID(), name: 'Другой стиль' }; await addBankStyle(f.bucket, otherStyle)
  const updated = await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: f.project.text, uploadId: otherStyle.id })
  const same = await structureContext(f.bucket, updated.id, config)
  const reused = await startStructure(f.bucket, same, same.material.id, config)
  assert.equal(reused.execute, null); assert.equal(reused.state.id, job.state.id); assert.equal(calls, 1)
  const revised = await updateProject(f.bucket, updated.id, { baseRevision: updated.revision, name: updated.name, text: updated.text + '\nНовое условие.' })
  const fresh = await structureContext(f.bucket, revised.id, config)
  assert.equal(await readStructure(f.bucket, fresh), null)
  await assert.rejects(() => startStructure(f.bucket, fresh, same.material.id, config), /изменилось/)
  assert.ok(keysBefore.every(key => f.data.has(key)))
  assert.ok([...f.data.values()].every(v => !v.value.includes(config.apiKey)))
})

test('concurrent starts issue one paid request; stale material never becomes the current result', async t => {
  const f = await projectFixture('Заголовок\nОговорка и 42 участника.'); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerResponse(validReply(f.context.parts[0])) })
  const attempts = await Promise.allSettled([1, 2].map(() => startStructure(f.bucket, f.context, f.context.material.id, config)))
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1)
  const started = attempts.find(r => r.status === 'fulfilled')! as PromiseFulfilledResult<Awaited<ReturnType<typeof startStructure>>>
  const revised = await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: 'Новая версия.' })
  await assert.rejects(() => started.value.execute!(), /изменилось/); assert.equal(calls, 0)
  assert.equal(await readStructure(f.bucket, await structureContext(f.bucket, revised.id, config)), null)
})

test('a failed part resumes from exact cached successes, with no repeated payment for completed parts', async t => {
  const f = await projectFixture(('Исходный факт и оговорка. '.repeat(1200)).slice(0, 28000)); let calls = 0, fail = true
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content); calls++
    if (input.part === 2 && fail) return new Response('', { status: 503 })
    return providerResponse(validReply({ id: `part-${input.part}`, ...input }))
  })
  const first = await startStructure(f.bucket, f.context, f.context.material.id, config)
  await assert.rejects(() => first.execute!()); assert.equal(calls, 2); assert.equal(first.state.completedParts, 1)
  fail = false
  const second = await startStructure(f.bucket, f.context, f.context.material.id, config); await second.execute!()
  assert.equal(second.state.status, 'ready'); assert.equal(calls, 3); assert.equal(second.state.cacheHits, 1); assert.equal(second.state.liveRequests, 1)
  assert.equal(second.state.outline!.coverage.fragments, f.context.material.fragments.length)
})

test('one clarification rejects incomplete model coverage again and cannot install a partial outline', async t => {
  const f = await projectFixture('Заголовок\nПервый факт\nВторой факт'); let calls = 0
  const bad = validReply(f.context.parts[0]); bad.slides[0].fragmentIds.pop(); bad.slides[0].blocks.pop()
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerResponse(bad) })
  const job = await startStructure(f.bucket, f.context, f.context.material.id, config)
  await assert.rejects(() => job.execute!()); assert.equal(calls, 2)
  assert.equal(job.state.status, 'failed'); assert.equal(job.state.outline, undefined)
  assert.ok([...f.data.keys()].some(k => k.includes('/clarifications/') && k.endsWith('/response.json')))
})
