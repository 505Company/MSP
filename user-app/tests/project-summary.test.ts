import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { readProjectPresentation, readProjectPreview, summarizeProject } from '../lib/workspace/project-summary'
import { createProject, updateProject, archiveProject } from '../lib/workspace/storage'
import type { BankStyle } from '../lib/workspace/types'
import { libraryFixture } from './fixtures/recipe-library'

test('project cards read the current saved deck without mutating model results or regenerating', async () => {
  const { bucket, data } = memoryBucket()
  const style: BankStyle = { id: crypto.randomUUID(), name: 'Стиль', sourceId: 'a'.repeat(64), fileName: 'style.pptx', createdAt: '', slideCount: 1, componentCount: 0, styleCount: 1, previewId: null, colors: [], fonts: [] }
  const project = await createProject(bucket, { id: crypto.randomUUID(), name: 'Проект', text: 'Исходное содержание', uploadId: style.id }, style)
  const ref = { inputId: 'b'.repeat(64), slideId: 'slide-1', round: 0, render: 'layout-dom-3' }
  await bucket.put(`presentation-jobs/${project.id}.json`, JSON.stringify({ id: project.id, ...ref, renderVersion: ref.render, sourceRevision: project.revision, status: 'complete', progress: { total: 4, completed: 4 } }))
  await bucket.put(`presentation-layouts/${project.id}/${ref.inputId}/slide-1/round-0/render-${ref.render}.json`, JSON.stringify({ fit: { passed: true }, preview: 'data:image/png;base64,aW1hZ2U=' }))
  // A later unsuccessful round must not replace the last measured preview.
  await bucket.put(`presentation-layouts/${project.id}/${ref.inputId}/slide-1/round-1/render-${ref.render}.json`, JSON.stringify({ fit: { passed: false }, preview: '' }))
  const before = [...data.entries()]
  const summary = await summarizeProject(bucket, project)
  assert.equal(summary.slideCount, 4); assert.equal(summary.readyCount, 4); assert.equal(summary.status, 'ready')
  assert.ok(summary.previewUrl?.includes('round=0')); assert.equal('text' in summary, false)
  assert.equal(await readProjectPreview(bucket, project.id, ref), 'data:image/png;base64,aW1hZ2U=')
  assert.equal((await readProjectPresentation(bucket, project.id))?.slides.length, 1)
  assert.equal(await readProjectPreview(bucket, project.id, { ...ref, slideId: '../secret' }), null)
  assert.equal(await readProjectPreview(bucket, project.id, { ...ref, inputId: 'c'.repeat(64) }), null)
  assert.deepEqual([...data.entries()], before)
  const updated = await updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: 'Новое содержание' })
  assert.equal((await summarizeProject(bucket, updated)).status, 'changed')
  assert.equal((await summarizeProject(bucket, updated)).previewUrl, null)
  assert.equal(await readProjectPreview(bucket, project.id, ref), null)
  assert.equal(await readProjectPresentation(bucket, project.id), null)
  await archiveProject(bucket, project.id, updated.revision)
  assert.equal(await readProjectPreview(bucket, project.id, ref), null)
})

test('saved mixed decks include template previews, preserve slide order and never change the generation ledger', async () => {
  const { bucket, project, data } = await libraryFixture(), inputId = 'b'.repeat(64), png = 'data:image/png;base64,aW1hZ2U='
  const prefix = `presentation-layouts/${project.id}/${inputId}`
  await bucket.put(`presentation-jobs/${project.id}.json`, JSON.stringify({ id: project.id, inputId, sourceRevision: project.revision, renderVersion: 'layout-dom-3', status: 'complete',
    progress: { total: 3, completed: 3 }, slides: [{ id: 'slide-2', title: 'Карточки' }, { id: 'slide-1', title: 'Титульный' }, { id: 'slide-3', title: 'Показатели' }] }))
  await bucket.put(`${prefix}/slide-1/round-0/render-layout-dom-3.json`, JSON.stringify({ fit: { passed: true }, preview: png }))
  for (const id of ['slide-2', 'slide-3']) {
    await bucket.put(`${prefix}/${id}/round-0/render-template-render-1.json`, JSON.stringify({ planHash: 'synthetic', report: { passed: true, preview: png } }))
    await bucket.put(`${prefix}/${id}/round-1/render-template-render-1.json`, JSON.stringify({ report: { passed: false, preview: png } }))
  }
  await bucket.put(`${prefix}/foreign/round-0/render-unrelated-1.json`, JSON.stringify({ fit: { passed: true }, preview: png }))
  const before = structuredClone([...data]), saved = await readProjectPresentation(bucket, project.id)
  assert.deepEqual(saved?.slides.map(s => s.title), ['Карточки', 'Титульный', 'Показатели'])
  assert.ok(saved?.slides[0].image.includes('render=template-render-1'))
  assert.equal((await summarizeProject(bucket, project)).previewUrl, saved?.slides[0].image)
  const ref = { inputId, slideId: 'slide-2', round: 0, render: 'template-render-1' }
  assert.equal(await readProjectPreview(bucket, project.id, ref), png)
  assert.equal(await readProjectPreview(bucket, project.id, { ...ref, round: 1 }), null)
  assert.equal(await readProjectPreview(bucket, project.id, { ...ref, render: 'unrelated-1' }), null)
  assert.equal(await readProjectPreview(bucket, project.id, { ...ref, inputId: 'f'.repeat(64) }), null)
  assert.deepEqual([...data], before)
  await updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: 'Изменённый материал' })
  assert.equal(await readProjectPreview(bucket, project.id, ref), null)
  assert.equal(await readProjectPresentation(bucket, project.id), null)
})
