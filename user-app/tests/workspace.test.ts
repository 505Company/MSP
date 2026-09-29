import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { addBankStyle, archiveProject, createProject, getProject, listBank, listProjects, removeBankStyle, updateProject } from '../lib/workspace/storage'
import type { BankStyle } from '../lib/workspace/types'
import { LibraryConflict } from '../lib/design-system/storage'
import { loadSlide, saveSlide } from '../lib/slides/storage'
import { blankSlide } from '../lib/slides/document'
const style: BankStyle = { id: crypto.randomUUID(), name: 'VK Education', fileName: 'VK.pptx', sourceId: 'a'.repeat(64), createdAt: new Date().toISOString(), slideCount: 55, componentCount: 716, styleCount: 153, previewId: 's01', colors: ['#0077FF'], fonts: ['Play'] }
test('bank lists only explicitly added sources; hiding a style preserves source and project dependencies', async () => {
  const { bucket, data } = memoryBucket()
  await bucket.put('visual/unlisted-test/manifest.json', '{}')
  assert.deepEqual(await listBank(bucket), [])
  await addBankStyle(bucket, style); await addBankStyle(bucket, { ...style, name: 'Should not overwrite' })
  const retainedKeys = [`visual/${style.id}/manifest.json`, `catalogs/${style.id}/current.json`, `uploads/${style.id}/source.pptx`]
  for (const key of retainedKeys) await bucket.put(key, 'original source and definitions')
  assert.deepEqual(await listBank(bucket), [style])
  const input = { id: crypto.randomUUID(), uploadId: style.id, name: 'Программа', text: '# Первый слайд\nТекст без сокращений.' }
  const project = await createProject(bucket, input, style)
  assert.deepEqual(await createProject(bucket, input, style), project)
  await assert.rejects(() => createProject(bucket, { ...input, text: 'Другой текст' }, style), LibraryConflict)
  await removeBankStyle(bucket, style.id)
  assert.deepEqual(await listBank(bucket), [])
  assert.equal((await getProject(bucket, project.id))?.text, input.text)
  assert.ok(data.has('visual/unlisted-test/manifest.json'))
  for (const key of retainedKeys) assert.equal(await (await bucket.get(key))?.text(), 'original source and definitions')
  const updated = await updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: 'Новые данные с прежним оформлением.', uploadId: style.id })
  assert.equal(updated.uploadId, style.id)
  await removeBankStyle(bucket, style.id)
  assert.deepEqual(await getProject(bucket, project.id), updated)
})
test('project content is complete, revision-protected and independently archivable', async () => {
  const { bucket } = memoryBucket()
  const p = await createProject(bucket, { id: crypto.randomUUID(), uploadId: style.id, name: 'Проект', text: 'a'.repeat(100000) }, style)
  assert.equal(p.text.length, 100000)
  const results = await Promise.allSettled(['One', 'Two'].map(name => updateProject(bucket, p.id, { baseRevision: p.revision, name, text: p.text })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof LibraryConflict))
  await assert.rejects(() => updateProject(bucket, p.id, { baseRevision: p.revision, name: 'Invalid', text: 'bad\0text' }))
  const current = (await getProject(bucket, p.id))!
  await assert.rejects(() => archiveProject(bucket, p.id, p.revision), LibraryConflict)
  await archiveProject(bucket, p.id, current.revision)
  assert.deepEqual(await listProjects(bucket), [])
  assert.equal((await getProject(bucket, p.id))?.text, p.text)
})
test('two presentations using one design system keep independent slides and the legacy test slide', async () => {
  const { bucket } = memoryBucket(), a = crypto.randomUUID(), b = crypto.randomUUID()
  const old = await saveSlide(bucket, style.id, { baseRevision: null, document: { ...blankSlide(), name: 'Old source test' } })
  const first = await saveSlide(bucket, style.id, { baseRevision: null, document: { ...blankSlide(), name: 'First project' } }, a)
  const second = await saveSlide(bucket, style.id, { baseRevision: null, document: { ...blankSlide(), name: 'Second project' } }, b)
  assert.deepEqual(await loadSlide(bucket, style.id), old)
  assert.deepEqual(await loadSlide(bucket, a, 'project'), first)
  assert.deepEqual(await loadSlide(bucket, b, 'project'), second)
  await assert.rejects(() => saveSlide(bucket, style.id, { baseRevision: first.id, document: first.document }, b), LibraryConflict)
})
test('changing the project style is revision-protected and preserves its saved slide', async () => {
  const { bucket } = memoryBucket()
  const other = { ...style, id: crypto.randomUUID(), name: 'Другой стиль' }
  await addBankStyle(bucket, style); await addBankStyle(bucket, other)
  const project = await createProject(bucket, { id: crypto.randomUUID(), uploadId: style.id, name: 'Проект', text: 'Полное содержание.' }, style)
  const slide = await saveSlide(bucket, style.id, { baseRevision: null, document: blankSlide() }, project.id)
  const changed = await updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: project.text, uploadId: other.id })
  assert.equal(changed.uploadId, other.id)
  assert.equal(changed.styleName, other.name)
  assert.deepEqual(await loadSlide(bucket, project.id, 'project'), slide)
  await assert.rejects(() => updateProject(bucket, project.id, { baseRevision: project.revision, name: project.name, text: 'Запоздалый текст', uploadId: style.id }), LibraryConflict)
  await assert.rejects(() => updateProject(bucket, project.id, { baseRevision: changed.revision, name: project.name, text: project.text, uploadId: crypto.randomUUID() }), LibraryConflict)
  await removeBankStyle(bucket, other.id)
  const retained = await updateProject(bucket, project.id, { baseRevision: changed.revision, name: project.name, text: 'Новый текст', uploadId: other.id })
  assert.equal(retained.uploadId, other.id)
  assert.equal(retained.text, 'Новый текст')
})
