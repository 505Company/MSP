import { test } from 'node:test'
import assert from 'node:assert/strict'
import { studioFixture } from './fixtures/studio'
import { compactPackets } from '../lib/presentations/studio/compact-content'
import { fallbackSource, fallbackItems, fallbackPage, validateFallbackCoverage,hasLegacyContent } from '../lib/presentations/studio/fallback-content'

test('a rejected semantic response falls back to the frozen source without another model', () => {
  const run = studioFixture('smart'), text = 'Слайд 1\nПутешествие начинается с выбора\nНи один факт не потеряется.\nРегион\tРост\nКарелия\t37%'
  run.slides = []; run.semantic = { status: 'pending', source: text, strategy: 'components', units: compactPackets(text).map(packet => ({ id: packet.id, packet, status: 'failed', attempts: 2, error: 'missing-fragments' })) }
  const source = fallbackSource(run, 'slide-1')
  assert.equal(source.title, 'Путешествие начинается с выбора')
  assert.ok(source.blocks.some(b => b.source.includes('Ни один факт')))
  assert.deepEqual(source.blocks.find(b => b.data)?.data?.values.rows, [['Карелия', '37%']])
  assert.equal(run.semantic.units?.[0].status, 'failed')
})

test('continuations cover each literal field once and reject gaps, duplicates and extra items', () => {
  const source = studioFixture('fast', '# Заголовок\n\nДлинный текст без потерь.').slides[0].content, items = fallbackItems(source)
  const pieces = items.flatMap(item => [{ item: item.id, start: 0, end: 2, render: 'text' as const }, { item: item.id, start: 2, end: item.text.length, render: 'text' as const }])
  const pages = [{ pieces: pieces.slice(0, 1) }, { pieces: pieces.slice(1) }]
  validateFallbackCoverage(items, pages)
  assert.equal(fallbackPage(source, items, pages[1].pieces, 1).id, 'slide-1-page-2')
  assert.throws(() => validateFallbackCoverage(items, [{ pieces: pieces.slice(1) }]))
  assert.throws(() => validateFallbackCoverage(items, [{ pieces: [...pieces, pieces[0]] }]))
  assert.throws(() => validateFallbackCoverage(items, [{ pieces: [...pieces, { ...pieces[0], item: 'invented' }] }]))
})

test('legacy ready previews recover a wrapped title and native table from their frozen source',()=>{
  const run=studioFixture('fast','Слайд 1\nВнутренний туризм становится привычкой,\nа не разовой альтернативой\nПутешественники выбирают самостоятельные маршруты.\nРОССИЯ / ТУРИЗМ / 2026\n\nСлайд 2\nАудитория путешественников растет\nЗа последние годы самостоятельное планирование стало основным сценарием.\nСегмент\tДоля аудитории\tПоездок в год\nКомандировочные\t31%\t7,2×\nПары\t24%\t4,1×\n67% пользователей рассматривают несколько направлений одновременно\n42 млн посещений сервиса в месяц')
  const original=JSON.stringify(run)
  assert.ok(run.slides.every(s=>hasLegacyContent(run,s)))
  const first=fallbackSource(run,'slide-1'),second=fallbackSource(run,'slide-2')
  assert.equal(first.blocks[0].fields.text,'Внутренний туризм становится привычкой,\nа не разовой альтернативой')
  assert.deepEqual(second.blocks.find(b=>b.data)?.data?.values.rows,[['Командировочные','31%','7,2×'],['Пары','24%','4,1×']])
  assert.deepEqual(second.blocks.filter(b=>b.kind==='metric').map(b=>b.fields.value),['67%','42 млн'])
  assert.equal(JSON.stringify(run),original)
})
