import test from 'node:test'
import assert from 'node:assert/strict'
import { withAutomaticRecovery, processingFailure, RECOVERY_DELAYS } from '../lib/uploads/automatic-recovery'
import { UploadCancelledError } from '../lib/uploads/cancellation'

type Journal=Parameters<typeof withAutomaticRecovery>[0]['journal']
function journal():Journal {let record:ReturnType<Journal['read']>=null;return {read:()=>record,write:value=>{record=value}}}
test('scan status polling preserves provider access errors while temporary outages remain retryable',()=>{
  for(const code of ['QWEN_HTTP_401','QWEN_HTTP_402','QWEN_HTTP_403','QWEN_HTTP_404','QWEN_INVALID_SETTINGS']) {
    const error=processingFailure(409,'Provider setup error',code)
    assert.ok('retryable' in error);assert.equal(error.retryable,false)
  }
  const temporary=processingFailure(409,'Provider unavailable','SEMANTIC_SERVICE_UNAVAILABLE')
  assert.ok('retryable' in temporary);assert.equal(temporary.retryable,true)
})
test('explicit deletion never retries and clears an already scheduled recovery',async()=>{
  const saved=journal();let runs=0,waits=0
  const controller=new AbortController()
  await assert.rejects(withAutomaticRecovery({journal:saved,signal:controller.signal,onWait:()=>{},run:async()=>{runs++;throw Error('Сбой')},wait:async()=>{waits++;controller.abort(new UploadCancelledError());throw controller.signal.reason}}),/удалена/)
  assert.equal(runs,1);assert.equal(waits,1);assert.equal(saved.read(),null)
  await assert.rejects(withAutomaticRecovery({journal:saved,onWait:()=>{throw Error('Must not retry')},run:async()=>{throw processingFailure(410,'Cancelled')},wait:async()=>{}}),/удалена/)
  assert.equal(saved.read(),null)
})
test('temporary failures resume automatically with backoff and a successful continuation clears the budget',async()=>{
  const saved=journal(),waits:number[]=[],runs:boolean[]=[];let time=0
  await withAutomaticRecovery({journal:saved,now:()=>time,onWait:()=>{},wait:async ms=>{waits.push(ms);time+=ms},run:async recover=>{runs.push(recover);if(runs.length<3)throw Error('Временный сбой')}})
  assert.deepEqual(runs,[false,true,true]);assert.deepEqual(waits,[15000,45000]);assert.equal(saved.read(),null)
})
test('persistent failures are bounded across reloads; authentication or missing sources do not retry',async()=>{
  const saved=journal();let runs=0,time=0
  const options={journal:saved,now:()=>time,onWait:()=>{},wait:async(ms:number)=>{time+=ms},run:async()=>{runs++;throw Error('Постоянная ошибка')}}
  await assert.rejects(withAutomaticRecovery(options),/Автоматическое продолжение/)
  assert.equal(runs,RECOVERY_DELAYS.length+1);assert.equal(saved.read()?.exhausted,true)
  await assert.rejects(withAutomaticRecovery(options),/Автоматическое продолжение/)
  assert.equal(runs,4)
  let attempts=0
  await assert.rejects(withAutomaticRecovery({...options,journal:journal(),run:async()=>{attempts++;throw processingFailure(401,'Нужно настроить подключение')}}),/настроить/)
  assert.equal(attempts,1)
})
test('returning during backoff preserves the reserved attempt and its remaining wait',async()=>{
  const saved=journal();let time=0
  await assert.rejects(withAutomaticRecovery({journal:saved,now:()=>time,onWait:()=>{},run:async()=>{throw Error('Сбой')},wait:async()=>{throw Error('Вкладка закрыта')}}),/Вкладка/)
  assert.equal(saved.read()?.attempts,1);assert.equal(saved.read()?.waiting,true)
  time=5000
  const waits:number[]=[]
  await withAutomaticRecovery({journal:saved,now:()=>time,onWait:()=>{},wait:async ms=>{waits.push(ms);time+=ms},run:async recover=>{assert.equal(recover,true)}})
  assert.deepEqual(waits,[10000]);assert.equal(saved.read(),null)
})
