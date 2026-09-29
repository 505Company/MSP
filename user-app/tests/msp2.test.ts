import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localStructure, localPlan, sourcePackets, validatePlan, planningTask } from '../lib/msp2/planner'
import { GRID, gridRect, layoutCandidates, validateGrid } from '../lib/msp2/grid'
import { slideSpec } from '../lib/msp2/spec'
import { changeRun, readRun, runKey, saveProject, readProject, planSlide } from '../lib/msp2/storage'
import { memoryBucket } from './helpers/memory-bucket'
import { msp2Library, msp2Run, msp2Text } from './fixtures/msp2'

test('MSP 2 builds exact source references and typed native data without old modes', () => {
  const run = msp2Run()
  assert.equal(run.packets.length, 3)
  const blocks = run.plans['slide-1'].content.blocks
  assert.deepEqual(blocks.map(b => b.kind), ['text', 'metric', 'metric', 'text'])
  assert.equal(blocks[1].fields.value, '76%')
  assert.equal(blocks[3].role, 'footer')
  const chart = run.plans['slide-2'].content.blocks.find(b => b.data)!
  assert.equal(chart.placement, 'left')
  assert.deepEqual(chart.data!.values.series!.map(s => s.values), [[12, 20, 32], [18, 26, 40]])
  const table = run.plans['slide-3'].content.blocks.find(b => b.data)!
  assert.deepEqual(table.data!.values.rows, [['Командировки', '120', '126'], ['Семьи', '90', '94'], ['Пары', '110', '117']])
  assert.ok(String(planningTask(run.packets[0], run.library).task.messages[0].content).includes('Никаких HTML'))
})

test('the model cannot drop, repeat, rewrite or invent a component reference', () => {
  const library = msp2Library(), packet = sourcePackets(msp2Text)[0]
  const raw = { ...localStructure(packet), components: [], arrangement: 'balanced', rationale: 'Тест' }
  assert.doesNotThrow(() => validatePlan(raw, packet, library))
  const missing = structuredClone(raw); missing.blocks.pop()
  assert.throws(() => validatePlan(missing, packet, library))
  const duplicate = structuredClone(raw); duplicate.blocks[1].fields[0].ids.push('f1')
  assert.throws(() => validatePlan(duplicate, packet, library))
  assert.throws(() => validatePlan({ ...raw, html: '<script />' }, packet, library))
  assert.throws(() => validatePlan({ ...raw, components: [{ block: 'b2', component: 'invented' }] }, packet, library))
})

test('spreadsheet JSON preserves empty cells, newlines and every row', () => {
  const rows = Array.from({ length: 40 }, (_, i) => [`Строка ${i}\nподпись`, i % 2 ? '' : '1,2300'])
  const source = JSON.stringify({ tables: [{ title: 'Данные', columns: ['Имя', 'Число'], rows }] })
  const packet = sourcePackets(source)[0], plan = localPlan(packet, msp2Library())
  assert.equal(sourcePackets(source).length, 1)
  assert.deepEqual(plan.content.blocks[1].data!.values.rows, rows)
  assert.throws(() => sourcePackets('{broken'), /JSON/)
  assert.throws(() => sourcePackets('{"tables":[]}'), /таблицу/)
  assert.throws(() => sourcePackets('{"title":"Данные","categories":["A"],"series":[{"name":"n","values":[null]}]}'), /пропусками/)
})

test('measured search changes layout with physical height and rejects impossible geometry', () => {
  const plan = msp2Run().plans['slide-1']
  const measured = Object.fromEntries(plan.content.blocks.map(b => [b.id, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 3, b.role === 'title' ? 90 : b.role === 'footer' ? 30 : i >= 3 ? 220 : 440]))]))
  const layouts = layoutCandidates(plan, measured)
  assert.ok(layouts.length > 1)
  layouts.forEach(grid => validateGrid(grid, plan.content))
  const huge = structuredClone(measured); Object.keys(huge.b2).forEach(w => huge.b2[Number(w)] = 2000)
  assert.deepEqual(layoutCandidates(plan, huge), [])
  const bad = structuredClone(layouts[0]); bad[0].h = Infinity
  assert.throws(() => validateGrid(bad, plan.content))
  assert.throws(() => validateGrid([...layouts[0], layouts[0][0]], plan.content))
  const last = gridRect({ i: 'all', x: 0, y: 0, w: GRID.columns, h: GRID.rows })
  assert.deepEqual(last, { x: 48, y: 48, width: 1824, height: 984 })
})

test('compiled Spec is a finite single tree of source IDs with no actions or live expressions', () => {
  const plan = msp2Run().plans['slide-1'], spec = slideSpec(plan)
  assert.equal(spec.root, 'slide')
  assert.deepEqual(spec.elements.slide.children, plan.content.blocks.map(b => b.id))
  for (const b of plan.content.blocks) {
    assert.deepEqual(spec.elements[b.id].props, { id: b.id })
    assert.deepEqual(spec.elements[b.id].children, [])
  }
  assert.equal(Object.keys(spec.elements).length, plan.content.blocks.length + 1)
})

test('MSP 2 stores independent revisions, resolves concurrent updates and never calls a model in local mode', async () => {
  const { bucket, data } = memoryBucket(), run = msp2Run(), id = run.projectId
  await bucket.put(`workspace/style-bank/${run.library.uploadId}.json`, JSON.stringify({ id: run.library.uploadId, name: run.library.name }))
  await bucket.put(`workspace/projects/${id}.json`, 'old-engine')
  const input = { id, uploadId: run.library.uploadId, name: 'MSP 2', text: msp2Text, mode: 'local' }
  const first = await saveProject(bucket, input)
  assert.deepEqual(await saveProject(bucket, input), first)
  await bucket.put(runKey(id, first.revision), JSON.stringify({ ...run, revision: first.revision }))
  const second = await saveProject(bucket, { ...input, text: msp2Text + '\nИсточник: тест' }, first.revision)
  assert.notEqual(first.revision, second.revision)
  await assert.rejects(() => saveProject(bucket, input, first.revision), /другой вкладке/)
  assert.equal((await readRun(bucket, id, first.revision))!.packets.length, 3)
  await Promise.all([changeRun(bucket, id, first.revision, r => { r.errors['slide-1'] = 'one' }), changeRun(bucket, id, first.revision, r => { r.errors['slide-2'] = 'two' })])
  assert.equal(Object.keys((await readRun(bucket, id, first.revision))!.errors).length, 2)
  const result = await planSlide(bucket, id, first.revision, 'slide-1', { apiKey: '' } as never, new AbortController().signal)
  assert.deepEqual(result.modelRuns, {})
  assert.equal((await readProject(bucket, id))!.revision, second.revision)
  assert.equal(data.get(`workspace/projects/${id}.json`)!.value, 'old-engine')
})

test('background tokens come from observed slide fills, including dark presentations', async () => {
  const { designTokens } = await import('../lib/msp2/theme'), { backgroundFixture } = await import('./fixtures/backgrounds'), { buildBackgroundCatalog } = await import('../lib/design-system/backgrounds')
  const library = msp2Library(), f = backgroundFixture()
  library.backgrounds = buildBackgroundCatalog(f.snapshot, f.library, 'fixture')
  const theme = designTokens(library)
  assert.equal(theme.background, '#0033cc'); assert.equal(theme.ink, '#FFFFFF')
  const packet = sourcePackets('# Заголовок\nПервый фрагмент\nВторой фрагмент')[0], raw = { ...localStructure(packet), components: [], arrangement: 'balanced', rationale: 'Тест' }
  raw.blocks[1].fields[0].ids.reverse()
  assert.throws(() => validatePlan(raw, packet, library), /порядок/)
})
