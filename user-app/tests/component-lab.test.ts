import test from 'node:test'
import assert from 'node:assert/strict'
import { labTemplate, labUnitMetric } from '../component-lab/fixtures'
import { metricParts } from '../lib/component-lab/metric-unit'
import { sourceCandidate, supportedPanel } from '../lib/component-lab/source'
import { contentIssues, constraintsSchema, profileSchema } from '../lib/component-lab/contract'
import { qualityCases, sampleContent } from '../lib/component-lab/cases'

function paragraphCard() {
  const t = labTemplate('text'), [title, body] = t.sourceLayout!.text.map(s => s.element)
  const text = `${title.text}\n${body.text}`, start = title.text.length + 1
  const paragraph = { align: 'LEFT' as const, left: 12, right: 0, indent: 0, before: 0, after: 0 }
  const element = { ...title, text, bounds: { ...title.bounds, height: 200 },
    styleRuns: [...title.styleRuns!, ...body.styleRuns!.map(r => ({ ...r, start: r.start + start, end: r.end + start }))],
    colorRuns: [...title.colorRuns!, ...body.colorRuns!.map(r => ({ ...r, start: r.start + start, end: r.end + start }))],
    paragraphs: [{ ...paragraph, start: 0, end: title.text.length, fontSize: title.fontSize }, { ...paragraph, start, end: text.length, fontSize: body.fontSize, before: 16 }] }
  t.sourceLayout!.text = [{ element, binding: { field: 'item', index: 0, part: 'text' } }]
  t.data = { items: [{ text }] }
  return t
}

test('only the observed metric placeholder is allowed alongside real numeric content', async () => {
  for (const value of ['xxx%', 'ххх%', '???%', '—']) {
    const t = labTemplate('metric'); t.data.value = value; t.data.unit = ''
    const candidate = await sourceCandidate(t, 'a'), p = candidate.profile!
    assert.ok(p, candidate.reason)
    const f = p.fields.find(f => f.role === 'number')!
    assert.equal(f.sourcePlaceholder, value)
    assert.deepEqual(contentIssues(p, candidate.content!), [])
    assert.deepEqual(contentIssues(p, { ...candidate.content, [f.id]: '12,5%' }), [])
    for (const invalid of ['другой текст', '??? единиц', 'xx%' === value ? 'xxxx%' : 'xx%']) assert.ok(contentIssues(p, { ...candidate.content, [f.id]: invalid }).some(i => i.startsWith('number-expected')))
  }
  const numeric = (await sourceCandidate(labTemplate('metric'), 'a')).profile!
  assert.equal(numeric.fields[0].sourcePlaceholder, undefined)
  assert.ok(contentIssues(numeric, { [numeric.fields[0].id]: 'xxx%' }).some(i => i.startsWith('number-expected')))
})

test('a square native panel and two styled paragraphs become a title/body profile without source edits', async () => {
  const t = paragraphCard()
  t.sourceLayout!.graphic = '<svg><path d="M 0 0 L 500 0 C 500 0 500 0 500 0 L 500 420 C 500 420 500 420 500 420 L 0 420 C 0 420 0 420 0 420 L 0 0 C 0 0 0 0 0 0 Z" fill="#265fc1"/></svg>'
  const original = JSON.stringify(t), c = await sourceCandidate(t, 'a')
  assert.ok(c.profile, c.reason)
  assert.deepEqual(c.profile.fields.map(f => f.role), ['title', 'body'])
  assert.deepEqual(Object.values(c.content!), ['Понять гостя', 'Команда помогает найти решение.'])
  assert.equal(JSON.stringify(t), original)
})

test('paragraph splitting rejects lists, unaccounted text, equal hierarchy and mixed formatting inside a paragraph', async () => {
  for (const issue of ['list', 'gap', 'hierarchy', 'mixed', 'link'] as const) {
    const t = paragraphCard(), e = t.sourceLayout!.text[0].element
    if (issue === 'list') e.paragraphs![1].markerLength = 1
    if (issue === 'gap') e.paragraphs![1].start += 3
    if (issue === 'hierarchy') e.styleRuns![0].fontSize = e.styleRuns![1].fontSize
    if (issue === 'mixed') e.styleRuns!.push({ ...e.styleRuns![1], fontStyle: 'Bold' })
    if (issue === 'link') e.linkRuns = [{ start: 0, end: 2, url: 'https://example.com' }]
    assert.equal((await sourceCandidate(t, 'a')).profile, undefined, issue)
  }
})

test('source adapter assigns independent semantic roles without mutating source or accepting ambiguous labels', async () => {
  for (const family of ['metric', 'text', 'numbered'] as const) {
    const t = labTemplate(family), before = JSON.stringify(t), candidate = await sourceCandidate(t, 'a'.repeat(64))
    assert.ok(candidate.profile); assert.equal(JSON.stringify(t), before); assert.equal(candidate.profile.fingerprint.length, 64)
    assert.equal(candidate.profile.fields.length, family === 'numbered' ? 3 : 2)
    assert.deepEqual(contentIssues(candidate.profile, candidate.content!), [])
    const changed = structuredClone(t); changed.sourceLayout!.text[0].element.fontSize += 1
    assert.notEqual((await sourceCandidate(changed, 'a'.repeat(64))).profile?.fingerprint, candidate.profile.fingerprint)
  }
  const t = labTemplate('text'); t.sourceLayout!.text.forEach((s, i) => { s.binding = { field: 'item', index: i } })
  assert.match((await sourceCandidate(t, 'a')).reason!, /неоднозначно/)
})
test('unsupported artwork, rotation and mixed typography remain outside the lab adapter', async () => {
  assert.equal(supportedPanel('<svg><script>alert(1)</script><rect/></svg>'), false)
  assert.equal(supportedPanel('<svg><image href="https://example.com/x"/></svg>'), false)
  assert.equal(supportedPanel('<svg><rect onload="alert(1)"/></svg>'), false)
  assert.equal(supportedPanel('<svg><path d="M0 0L10 20Z"/></svg>'), false)
  for (const type of ['rotation', 'mixed', 'raster'] as const) {
    const t = labTemplate(), e = t.sourceLayout!.text[0].element
    if (type === 'rotation') e.rotation = 30
    if (type === 'mixed') e.styleRuns!.push({ ...e.styleRuns![0], fontSize: 12 })
    if (type === 'raster') t.sourceLayout!.graphic = '<svg><image href="data:image/png;base64,eA=="/></svg>'
    assert.equal((await sourceCandidate(t, 'a')).profile, undefined)
  }
})
test('content and box contracts preserve obligations and numeric semantics', async () => {
  const candidate = await sourceCandidate(labTemplate(), 'a'), p = candidate.profile!, content = candidate.content!
  assert.ok(contentIssues(p, { ...content, [p.fields[0].id]: 'Слова вместо числа' }).some(i => i.startsWith('number-expected')))
  assert.ok(contentIssues(p, {}).some(i => i.startsWith('required-field')))
  assert.ok(contentIssues(p, { ...content, unexpected: 'лишнее' }).includes('unknown-field:unexpected'))
  const optional = structuredClone(p); optional.fields[1].required = false
  assert.deepEqual(contentIssues(optional, { [p.fields[0].id]: '7%' }), [])
  assert.equal(constraintsSchema.safeParse({ width: NaN, maxHeight: 400 }).success, false)
  assert.equal(constraintsSchema.safeParse({ width: 600, maxHeight: 400, allowedStates: [] }).success, false)
  assert.equal(profileSchema.safeParse({ ...p, fields: [p.fields[0], p.fields[0]] }).success, false)
})
test('metric units retain their source scale and semantic boundary across different values without mutating source', async () => {
  const t = labUnitMetric(), original = JSON.stringify(t), c = await sourceCandidate(t, 'a')
  assert.ok(c.profile, c.reason); assert.equal(c.profile.fields[0].unitScale, .6)
  assert.equal(JSON.stringify(t), original)
  for (const text of ['73%', '3,7 млн', '128 450,75 тыс.', '−12,5 %', '1\u202f234 шт.', '999', '12  ']) {
    assert.deepEqual(contentIssues(c.profile, { ...c.content, [c.profile.fields[0].id]: text }), [])
    assert.equal(metricParts(text)?.join(''), text)
  }
  assert.ok(contentIssues(c.profile, { ...c.content, [c.profile.fields[0].id]: '73% за 2026' }).includes(`number-unit-expected:${c.profile.fields[0].id}`))
  for (const issue of ['overlap', 'font', 'small', 'shift'] as const) {
    const bad = labUnitMetric(), e = bad.sourceLayout!.text[0].element
    if (issue === 'overlap') e.styleRuns![1].start = 1
    if (issue === 'font') e.styleRuns![1].fontFamily = 'Another Font'
    if (issue === 'small') e.styleRuns![1].fontSize = 12
    if (issue === 'shift') e.styleRuns![1].baselineShift = 10
    assert.equal((await sourceCandidate(bad, 'a')).profile, undefined, issue)
  }
})
test('quality suite crosses shapes and content independently and includes explicit positive and negative expectations', async () => {
  const p = (await sourceCandidate(labTemplate('numbered'), 'a')).profile!, cases = qualityCases(p)
  assert.equal(cases.length, 35); assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  assert.ok(cases.some(c => c.id === 'portrait-long'))
  assert.ok(cases.some(c => c.id === 'banner-title'))
  assert.equal(cases.find(c => c.id === 'required')?.expect, 'incompatible')
  assert.equal(cases.find(c => c.id === 'overflow')?.expect, 'needs-space')
  assert.equal(cases.filter(c => c.expect === 'fits').length, 6)
  assert.deepEqual(contentIssues(p, sampleContent(p, 'long')), [])
})

test('ratio metrics retain both numbers and their observed unit styling',async()=>{
 const c=await sourceCandidate(labUnitMetric(),'ratio')
 for(const value of ['9 из 12 месяцев','3 / 4 участников','2 of 5 teams']){
   assert.equal(metricParts(value)?.join(''),value)
   assert.deepEqual(contentIssues(c.profile!,{...c.content,[c.profile!.fields[0].id]:value}),[])
 }
 assert.equal(metricParts('73% за 2026'),undefined)
})
