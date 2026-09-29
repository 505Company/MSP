import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compactPackets,compactContentTask,validateCompact,bindCompactData,type CompactReply} from '../lib/presentations/studio/compact-content'
import {structureStudioRun} from '../lib/presentations/studio/semantic-task'
import {refreshStudioStatus} from '../lib/presentations/studio/compact-task'
import {readStudioRun,studioKey} from '../lib/presentations/studio/storage'
import {studioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {SemanticValidationError} from '../lib/design-system/semantic-contract'
import {strictComponentFixture} from './fixtures/studio-components'

const source=`### Слайд 1 — текст и таблица
**Изменения спроса**
Вступительный текст.
| ФакторДоляИзменение | | |
| --- | --- | --- |
| Время | 78% | −3 п.п. |
| Удобство | 71% | +6 п.п. |
**67%** пользователей сравнивают направления
---
### Слайд 2 — график
**Равномерность спроса**
Слева — линейный график «Индекс спроса»:
| Месяц20242026 | | |
| --- | --- | --- |
| Январь | 58 | 72 |
| Февраль | 49 | 65 |`
const block=(kind:CompactReply['blocks'][number]['kind'],role:'title'|'body',fields:Record<string,string[]>,data='',chart:'none'|'line'='none'):CompactReply['blocks'][number]=>({kind,role,priority:'normal',placement:'auto',fields:Object.entries(fields).map(([name,ids])=>({name:name as 'text',ids})),data,chart})
test('provider grammar requires a separate title while retaining immutable legacy responses',()=>{
 const packet=compactPackets('# Заголовок\nТекст слайда.')[0],spec=compactContentTask(packet)
 const schema=spec.task.schema as {required:string[];properties:Record<string,{items?:{anyOf:{properties:{role:{const?:string}}}[]}}>}
 assert.deepEqual(schema.required,['title','blocks','footer'])
 assert.ok(schema.properties.blocks.items!.anyOf.every(b=>b.properties.role.const==='body'))
 const title=block('text','title',{text:['f1']}),body=block('text','body',{text:['f2']})
 assert.deepEqual(spec.validate({title,blocks:[body],footer:[]}),validateCompact({blocks:[title,body]},packet))
 assert.throws(()=>spec.validate({title:{...title,role:'body'},blocks:[body],footer:[]}),SemanticValidationError)
})
test('pasted tabular rows stay native and inline metrics have distinct lossless source spans',()=>{
  const text='Слайд 1\nДинамика спроса\nСлева — линейный график «Спрос»:\nМесяц\t2024\t2026\nЯнварь\t58\t72\nФевраль\t49\t65\n67% пользователей сравнивают направления\n42 млн посещений сервиса в месяц\n18 минут в среднем на решение проблемы.'
  const [packet]=compactPackets(text)
  assert.equal(packet.tables.length,1)
  assert.deepEqual(packet.tables[0].columns,['Месяц','2024','2026'])
  assert.deepEqual(packet.tables[0].rows,[['Январь','58','72'],['Февраль','49','65']])
  assert.equal(packet.tables[0].requestedChart,'line')
  assert.deepEqual(packet.atoms.map(a=>a.text),['Динамика спроса','67%','пользователей сравнивают направления','42 млн','посещений сервиса в месяц','18 минут','в среднем на решение проблемы.'])
  const lines=text.split('\n')
  for(const atom of packet.atoms)assert.equal(lines[atom.line].slice(atom.start,atom.end),atom.text)
  assert.throws(()=>compactPackets('Данные\nИмя\tЗначение\nА\t1\tЛишнее'),/строки разной длины/)
  assert.equal(compactPackets('Один заголовок\nОбычная\tодиночная строка')[0].tables.length,0)
})
test('compact packets preserve table cells and losslessly restore concatenated pasted headers',()=>{
  const [a,b]=compactPackets(source)
  assert.equal(compactPackets(source).length,2)
  assert.deepEqual(a.tables[0].columns,['Фактор','Доля','Изменение'])
  assert.deepEqual(a.tables[0].rows,[['Время','78%','−3 п.п.'],['Удобство','71%','+6 п.п.']])
  assert.deepEqual(b.tables[0].columns,['Месяц','2024','2026'])
  assert.equal(b.tables[0].title,'Индекс спроса')
  assert.equal(b.tables[0].requestedChart,'line')
  assert.deepEqual(a.atoms.map(f=>f.text),['Изменения спроса','Вступительный текст.','67%','пользователей сравнивают направления'])
  const payload=JSON.parse(compactContentTask(a).task.messages[1].content as string)
  assert.equal('rawText' in payload,false)
  assert.equal(payload.fragments.length,4)
})
test('ID-only references reject missing, duplicate and invented content and preserve native values',()=>{
  const [a,b]=compactPackets(source)
  const reply:CompactReply={blocks:[block('text','title',{text:['f1']}),block('text','body',{text:['f2']}),block('metric','body',{value:['f3'],caption:['f4']}),block('table','body',{},'t1')]}
  const result=validateCompact(reply,a)
  assert.deepEqual(result.materials.b4.data.rows,a.tables[0].rows)
  const missing=structuredClone(reply);missing.blocks.splice(1,1);assert.throws(()=>validateCompact(missing,a),(e:unknown)=>e instanceof SemanticValidationError&&e.issues[0].startsWith('missing-fragments'))
  const duplicate=structuredClone(reply);duplicate.blocks[1].fields[0].ids.push('f1');assert.throws(()=>validateCompact(duplicate,a),(e:unknown)=>e instanceof SemanticValidationError&&e.issues[0].startsWith('unknown-or-duplicate'))
  const invented=structuredClone(reply);invented.blocks[1].fields[0].ids=['выдуманный текст'];assert.throws(()=>validateCompact(invented,a),(e:unknown)=>e instanceof SemanticValidationError&&e.issues[0].startsWith('unknown-or-duplicate'))
  const chart=validateCompact({blocks:[block('text','title',{text:['f1']}),block('chart','body',{},'t1','line')]},b)
  assert.throws(()=>validateCompact({blocks:[block('text','title',{text:['f1']}),block('table','body',{},'t1')]},b),/Смысловой разбор/)
  assert.deepEqual(chart.materials.b2.data.series,[{name:'2024',values:[58,49]},{name:'2026',values:[72,65]}])
  const library=studioFixture().library
  assert.throws(()=>bindCompactData(chart,library),/проверенного оформления/)
})
test('render failure waits for unfinished neighbors before settling the whole run',()=>{
  const run=studioFixture(),packets=compactPackets('# Один\nТекст\n---\n# Два\nТекст')
  run.semantic={source:'fixture',status:'complete',units:packets.map(packet=>({id:packet.id,packet,status:'complete',attempts:1}))}
  run.slides=packets.map((p,i)=>({...run.slides[0],content:{...run.slides[0].content,id:p.id},...(i===0?{error:'Переполнение'}:{})}))
  refreshStudioStatus(run);assert.equal(run.status,'preparing')
  run.slides[1].error='Переполнение';refreshStudioStatus(run);assert.equal(run.status,'blocked')
})
test('a failed slide does not discard a successful one; resume calls only the failed slide',async()=>{
  const raw='# Первый\nТекст первого.\n---\n# Второй\nТекст второго.',packets=compactPackets(raw)
  const run=studioFixture('smart'),{bucket}=memoryBucket()
  run.semantic={source:raw,status:'pending',units:packets.map(packet=>({id:packet.id,packet,status:'pending',attempts:0}))};run.slides=[]
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Тест',text:raw,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  const old=globalThis.fetch;let calls=0,fail=true
  globalThis.fetch=async(_url,init)=>{calls++;const request=JSON.parse(String(init?.body)),p=JSON.parse(request.messages[1].content)
    if(p.fragments[0].text==='Второй'&&fail)return new Response('Unavailable',{status:503})
    return Response.json({id:'compact-test',choices:[{finish_reason:'stop',message:{content:JSON.stringify({blocks:[block('text','title',{text:['f1']}),block('text','body',{text:['f2']})]})}}]})
  }
  const config={apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},signal=new AbortController().signal
  try{
    await Promise.all(packets.map(p=>structureStudioRun(bucket,run,config,signal,p.id)))
    const partial=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.equal(partial.slides.length,1);assert.equal(partial.semantic?.units?.[1].status,'failed');assert.equal(calls,2)
    fail=false
    await structureStudioRun(bucket,partial,config,signal,'slide-1');assert.equal(calls,2)
    await structureStudioRun(bucket,partial,config,signal,'slide-2')
    const done=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.equal(done.slides.length,2);assert.equal(done.semantic?.status,'complete');assert.equal(done.modelRequests,3);assert.equal(calls,3)
    assert.deepEqual(done.semantic!.units!.map(u=>u.attempts),[1,2])
  }finally{globalThis.fetch=old}
})

test('component retries receive the precise fragment validation issue',async()=>{
  const {run,packet,reply}=strictComponentFixture(),{bucket}=memoryBucket(),raw=packet.atoms.map(a=>a.text).join('\n')
  run.semantic={source:raw,status:'pending',strategy:'components',units:[{id:packet.id,packet,status:'pending',attempts:0}]};run.slides=[]
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Тест',text:raw,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart',compositionMode:'components'}
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  reply.blocks[1].fields[0].ids=['f1']
  const old=globalThis.fetch;let failure:unknown
  globalThis.fetch=async(_url,init)=>{const request=JSON.parse(String(init?.body));failure=JSON.parse(request.messages[1].content).previousFailure;return Response.json({id:'invalid-ref-test',choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}]})}
  const config={apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},signal=new AbortController().signal
  try{
    await structureStudioRun(bucket,run,config,signal,packet.id)
    const saved=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.match(saved.semantic!.units![0].error!,/unknown-or-duplicate-fragment:f1/)
    await structureStudioRun(bucket,saved,config,signal,packet.id)
    assert.match(String(failure),/unknown-or-duplicate-fragment:f1/)
  }finally{globalThis.fetch=old}
})

test('resuming a saved job keeps its original paragraph boundaries and all fragment IDs',async()=>{
  const raw='Первый\nОписание первого.\n\nВторой\nОписание второго.'
  assert.equal(compactPackets(raw).length,2)
  // Before paragraph support this input was one packet. A saved run must keep
  // that packet; only an explicit new generation applies the new boundaries.
  const oldPacket=compactPackets('# '+raw)[0],run=studioFixture('smart'),{bucket}=memoryBucket()
  run.semantic={source:raw,status:'pending',strategy:'recipes',units:[{id:oldPacket.id,packet:oldPacket,status:'pending',attempts:0}]};run.slides=[]
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Сохранённый ввод',text:raw,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  const fetch=globalThis.fetch;let calls=0
  globalThis.fetch=async(_url,init)=>{
    calls++;const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[1].content)
    assert.deepEqual(payload.fragments.map((f:{text:string})=>f.text),['Первый','Описание первого.','Второй','Описание второго.'])
    return Response.json({id:'frozen-packet',choices:[{finish_reason:'stop',message:{content:JSON.stringify({blocks:[block('text','title',{text:['f1']}),block('text','body',{text:['f2','f3','f4']})]})}}]})
  }
  try{
    await structureStudioRun(bucket,run,{apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},new AbortController().signal,oldPacket.id)
    const saved=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.equal(calls,1);assert.equal(saved.slides.length,1)
    assert.equal(saved.slides[0].content.blocks[1].fields.text,'Описание первого.\nВторой\nОписание второго.')
    assert.deepEqual(saved.semantic?.units?.[0].packet,oldPacket)
  }finally{globalThis.fetch=fetch}
})
