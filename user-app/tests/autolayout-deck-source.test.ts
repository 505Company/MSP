import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseAutolayoutDeckSource, serialQueue, validateAutolayoutDeckReview } from '../scripts/autolayout-deck-source'

test('tourism deck keeps every source line, value and arrow with explicit direction provenance', async () => {
  const raw = await readFile('tests/fixtures/autolayout-tourism-10.md', 'utf8')
  const deck = parseAutolayoutDeckSource(raw)
  assert.equal(deck.length, 10)
  assert.equal(deck.flatMap(s => s.sequence).length, raw.split('\n').filter(l => l.trim() && l.trim() !== '---').length)
  assert.deepEqual(deck[2].content.slice(-4).map(f => f.text), ['−21%', 'времени решения типового обращения после внедрения базы знаний', '+14%', 'к оценке сервиса, если проблему решили при первом обращении'])
  assert.equal(deck[9].content.filter(f => f.text === '↓').length, 3)
  assert.equal(deck[5].content.filter(f => f.text === '→').length, 1)
  assert.equal(deck[0].content.at(-1)!.text, 'По данным внутренней аналитики сервиса, 2026 год.')
  assert.ok(deck[1].content.some(f => f.text === 'САМЫЙ АКТИВНЫЙ СЕГМЕНТ'))
  assert.ok(deck[6].content.some(f => f.text.startsWith('37% — возвращаются')))
  assert.ok(deck[5].content.some(f => f.text.startsWith('68% пользователей')))
  for (const s of deck) for (const row of s.sequence) assert.equal(raw.split('\n')[row.line - 1], row.raw)
  const unknown = parseAutolayoutDeckSource('1. **Заголовок**\nОбычная важная проза:')[0]
  assert.equal(unknown.directions.length, 0)
  assert.equal(unknown.content.length, 2)
})
test('concurrent reservations never lose increments, including after a rejected mutation', async () => {
  const serial = serialQueue(); let used = 0
  await Promise.all(Array.from({ length: 12 }, (_, i) => serial(async () => {
    const before = used
    await new Promise(resolve => setTimeout(resolve, 1))
    if (i === 5) throw Error('intentional rejection')
    used = before + 1
  }).catch(() => undefined)))
  assert.equal(used, 11)
})
test('autolayout review uses the actual two-field schema and rejects contradictory verdicts', () => {
  assert.deepEqual(validateAutolayoutDeckReview({ verdict: 'pass', issues: [] }), { verdict: 'pass', issues: [] })
  assert.equal(validateAutolayoutDeckReview({ verdict: 'revise', issues: ['Visible overlap'] }).verdict, 'revise')
  assert.throws(() => validateAutolayoutDeckReview({ verdict: 'pass', issues: ['Visible overlap'] }))
  assert.throws(() => validateAutolayoutDeckReview({ verdict: 'revise', issues: [] }))
})
