import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeText} from '../lib/presentations/studio/material'
import {compactPackets} from '../lib/presentations/studio/compact-content'
import {semanticSource,validateSemanticContent} from '../lib/presentations/studio/semantic-content'

const plain='Путешествия становятся привычкой\nЛюди чаще выбирают самостоятельные маршруты.\n76%\nпланируют поездки сами\n\nМеняются ожидания\nПутешественникам нужны понятные рекомендации.\n\nСледующий шаг\nОбъединить транспорт и впечатления.'

test('named slide boundaries take precedence over bold numbered steps within a slide',()=>{
  for(const start of ['### Слайд 1 — процесс','# Процесс']){
    const text=start+'\n\nОписание\n\n**01. Первый этап**\n\nПояснение\n\n**02. Второй этап**\n\nДетали\n---\n### Слайд 2 — итог\n\nЗаключение'
    assert.equal(normalizeText(text).length,2)
    const packets=compactPackets(text);assert.equal(packets.length,2)
    assert.ok(packets[0].atoms.some(a=>a.text==='Первый этап'))
    assert.ok(packets[0].atoms.some(a=>a.text==='Второй этап'))
  }
  assert.equal(compactPackets('Обложка\n\n**01. Внутренний пункт**\nТекст\n---\nФинал\nИтог').length,2)
})

test('plain text blank paragraphs define the same three slides in fast and Qwen parsing',()=>{
  const quick=normalizeText(plain),packets=compactPackets(plain),lines=semanticSource(plain)
  assert.equal(quick.length,3);assert.equal(packets.length,3)
  assert.deepEqual(quick.map(s=>s.title),['Путешествия становятся привычкой','Меняются ожидания','Следующий шаг'])
  assert.deepEqual(packets.map(p=>p.atoms[0].text),quick.map(s=>s.title))
  assert.deepEqual([...new Set(lines.map(l=>l.section))],[0,1,2])
  assert.deepEqual(packets.flatMap(p=>p.atoms.map(a=>a.text)),plain.split('\n').filter(Boolean))
  assert.equal(quick[0].blocks.find(b=>b.kind==='metric')?.fields.caption,'планируют поездки сами')
})

test('explicit slide headings keep paragraphs and lists inside their slides',()=>{
  const inputs=[
    '# Один\n\nАбзац первый.\n\nАбзац второй.\n\n# Два\n\nАбзац третьего блока.',
    'Слайд 1\nЗаголовок\n\nАбзац первый.\n\nАбзац второй.\n\nСлайд 2\nИтог\n\nОписание.',
    '1. **Первый**\n\nТекст.\n\n- Один\n- Два\n\n2. **Второй**\n\nИтог.',
    '**1. Первый**\n\nТекст.\n\n**2. Второй**\n\nИтог.',
    'Первый\n\nТекст.\n\n---\n\nВторой\n\nЕщё текст.',
  ]
  for(const input of inputs){assert.equal(normalizeText(input).length,2,input);assert.equal(compactPackets(input).length,2,input);assert.equal(new Set(semanticSource(input).map(l=>l.section)).size,2,input)}
  assert.equal(compactPackets('# Один\n\n1. Пункт\n\n2. Пункт\n\n## Подзаголовок\n\nОписание.').length,1)
})

test('clipboard line endings, whitespace paragraphs and repeated blank lines preserve text',()=>{
  for(const source of ['Первый\nОписание\n\nВторой\nИтог','Первый\r\nОписание\r\n \t\r\n\r\nВторой\r\nИтог','Первый\rОписание\r\rВторой\rИтог','Первый\u2028Описание\u2029Второй\u2028Итог']){
    const text='\n  \n'+source+'\n\n',quick=normalizeText(text),packets=compactPackets(text)
    assert.deepEqual(quick.map(s=>s.title),['Первый','Второй'])
    assert.deepEqual(packets.map(p=>p.atoms.map(a=>a.text)),[['Первый','Описание'],['Второй','Итог']])
  }
})

test('table header rules stay inside a paragraph slide and native cells are preserved',()=>{
  const text='Динамика\n| Год | Спрос |\n| --- | --- |\n| 2024 | 76 |\n| 2026 | 91 |\n\nВывод\nСпрос вырос.'
  const packets=compactPackets(text)
  assert.equal(packets.length,2);assert.equal(packets[0].tables.length,1)
  assert.deepEqual(packets[0].tables[0].rows,[['2024','76'],['2026','91']]);assert.equal(packets[1].tables.length,0)
})

test('blank input and more than 100 plain slides are rejected consistently',()=>{
  const many=Array.from({length:101},(_,i)=>`Содержание ${i}\nТекст`).join('\n\n')
  for(const parse of [normalizeText,compactPackets,semanticSource]){assert.throws(()=>parse(' \n '));assert.throws(()=>parse(many),/100 слайдов/)}
})

test('a dense paragraph slide is not silently paginated by the fast interpreter',()=>{
  const text='Один заданный слайд\n'+Array.from({length:18},(_,i)=>`${i+10}%\nпояснение показателя ${i}`).join('\n')
  assert.equal(normalizeText(text).length,1);assert.equal(compactPackets(text).length,1)
  assert.equal(normalizeText(text)[0].blocks.filter(b=>b.kind==='metric').length,18)
})

test('semantic interpretation cannot split a single assigned paragraph into extra slides',()=>{
  const source='Заголовок\nОписание',lines=semanticSource(source)
  const reply={slides:lines.map(l=>({blocks:[{kind:'text',role:'title',emphasis:'normal',placement:'auto',fields:[{name:'text',refs:[{line:l.id,quote:l.text}]}]}]})),directions:[]}
  assert.throws(()=>validateSemanticContent(reply,source),/Смысловой разбор/)
})
