import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceDesignTask, remainingStageSeconds, observeDesignUpload, reportDesignProgress, settleDesignProgress,
  designProgressSnapshot, dismissDesignProgress, moveDesignProgress, resetDesignProgressTiming, observeBackgroundJob, type DesignTask } from '../lib/uploads/design-progress'
import type {PublicProcessingJob} from '../lib/uploads/processing-jobs'
import type { UploadJob } from '../lib/uploads/domain'
import type { ScanRun } from '../lib/design-system/semantic-scan'

const initial: DesignTask = { id: 'sample', label: 'Шаблон', owned: true, saved: true, step: 'components', scope: 'check',
  detail: 'Проверяем', status: 'running', startedAt: 0, updatedAt: 0, completed: 0, total: 20, samples: [{ at: 0, completed: 0 }] }

test('failed and isolated scan packets advance processed progress without being presented as ready',()=>{
  const id=crypto.randomUUID(),upload={id,fileName:'Deck',status:'processing',qwenStatus:'processing',stage:'Анализ',createdAt:new Date().toISOString()} as UploadJob
  const scan={id:'scan',status:'running',startedAt:upload.createdAt,parts:[
    {status:'complete'},{status:'partial'},{status:'skipped'},
    {status:'failed',error:'Модель не завершила анализ вовремя.'},{status:'running'},{status:'waiting'},
  ]} as ScanRun
  observeDesignUpload(upload,scan)
  const task=designProgressSnapshot().find(t=>t.id===id)!
  assert.equal(task.completed,4);assert.equal(task.total,6)
  assert.match(task.detail,/Готово: 2/);assert.match(task.detail,/пропусками: 2/);assert.match(task.detail,/повтор: 1/)
  assert.match(task.detail,/Модель не завершила анализ вовремя/)
  assert.equal(task.status,'running')
  settleDesignProgress(id,'error','test complete');dismissDesignProgress(id)
})

test('background retry retains the actual outage reason',()=>{
  const id=crypto.randomUUID()
  observeBackgroundJob({id,label:'Deck',revision:'v1',createdAt:1,updatedAt:5,attempts:1,status:'retrying',retryAt:100,
    error:'Сервис модели не отвечает.',progress:{step:'analysis',detail:'Анализ',completed:2,total:13}},true)
  assert.match(designProgressSnapshot().find(t=>t.id===id)!.detail,/Сервис модели не отвечает/)
  observeDesignUpload({id,status:'cancelled'} as UploadJob,null)
})
test('background progress can be dismissed until the job changes and polling never takes browser ownership',()=>{
 const job:PublicProcessingJob={id:crypto.randomUUID(),label:'Deck',revision:'v1',createdAt:1,updatedAt:5,attempts:0,status:'complete',progress:{step:'graphics',detail:'Готово'}}
 observeBackgroundJob(job,true)
 assert.equal(designProgressSnapshot().find(t=>t.id===job.id)?.owned,false)
 dismissDesignProgress(job.id)
 observeBackgroundJob(job,true)
 assert.equal(designProgressSnapshot().some(t=>t.id===job.id),false)
 observeBackgroundJob({...job,status:'queued',updatedAt:6},false)
 assert.equal(designProgressSnapshot().find(t=>t.id===job.id)?.status,'waiting')
 observeDesignUpload({id:job.id,status:'cancelled'} as UploadJob,null)
})
test('deletion removes owned progress and late updates cannot resurrect it or affect another file',()=>{
  const id=crypto.randomUUID(),other=crypto.randomUUID()
  reportDesignProgress(id,{step:'analysis',detail:'Анализ'},{owned:true})
  reportDesignProgress(other,{step:'source',detail:'Чтение'},{owned:true})
  observeDesignUpload({id,status:'cancelled'} as UploadJob,null)
  reportDesignProgress(id,{step:'graphics',detail:'Поздний ответ'},{owned:true})
  observeDesignUpload({id,status:'processing',createdAt:new Date().toISOString()} as UploadJob,{status:'running',parts:[]} as unknown as ScanRun)
  assert.equal(designProgressSnapshot().some(t=>t.id===id),false)
  assert.equal(designProgressSnapshot().some(t=>t.id===other),true)
  observeDesignUpload({id:other,status:'cancelled'} as UploadJob,null)
})
test('ETA needs measured throughput, expires on a stall and resets between unrelated work', () => {
  assert.equal(remainingStageSeconds(initial, 0), null)
  const one = advanceDesignTask(initial, { step:'components', scope:'check', detail:'Проверяем', completed:1,total:20 }, 5000)
  const two = advanceDesignTask(one, { step:'components', scope:'check', detail:'Проверяем', completed:2,total:20 }, 10000)
  assert.equal(remainingStageSeconds(two,10000), 90)
  const unchanged = advanceDesignTask(two, { step:'components', scope:'check', detail:'Проверяем', completed:2,total:20 }, 20000)
  assert.equal(unchanged.samples.length, 3)
  assert.equal(remainingStageSeconds(unchanged,35000), null)
  const next = advanceDesignTask(two, { step:'components', scope:'model', detail:'Сравниваем', completed:2,total:20 }, 11000)
  assert.equal(remainingStageSeconds(next,11000), null)
  const retry = advanceDesignTask(two, { step:'components', scope:'check', detail:'Проверяем', completed:0,total:20 }, 12000)
  assert.equal(remainingStageSeconds(retry,12000), null)
  assert.equal(remainingStageSeconds({...two,status:'error'},12000),null)
})

test('server 100% never marks the browser pipeline complete and stale polling cannot replace local progress', () => {
  const upload = { id:'progress-server',fileName:'Пример.pptx',status:'processing',stage:'Анализ',qwenStatus:'processing',
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),progress:97 } as UploadJob
  const scan = { id:'scan',status:'running',startedAt:upload.createdAt,parts:[{status:'complete'},{status:'running'},{status:'waiting'}] } as ScanRun
  observeDesignUpload(upload,scan)
  assert.equal(designProgressSnapshot().find(t=>t.id===upload.id)?.completed,1)
  observeDesignUpload({...upload,status:'ready_for_review',progress:100,qwenStatus:'analyzed'},{...scan,status:'complete'})
  assert.equal(designProgressSnapshot().find(t=>t.id===upload.id)?.status,'waiting')
  reportDesignProgress(upload.id,{step:'editable',detail:'Проверка данных',completed:3,total:10},{owned:true})
  observeDesignUpload(upload,scan)
  assert.equal(designProgressSnapshot().find(t=>t.id===upload.id)?.step,'editable')
  settleDesignProgress(upload.id,'complete','Готово')
  observeDesignUpload(upload,scan)
  assert.equal(designProgressSnapshot().find(t=>t.id===upload.id)?.status,'complete')
  dismissDesignProgress(upload.id)
})

test('import identity retains elapsed time; background gaps invalidate the estimate, errors preserve the current step', () => {
  reportDesignProgress('file:test',{step:'source',detail:'Чтение'},{label:'Большой файл.pptx',owned:true})
  const startedAt=designProgressSnapshot().find(t=>t.id==='file:test')!.startedAt
  moveDesignProgress('file:test','stored-test')
  reportDesignProgress('stored-test',{step:'graphics',scope:'parts',detail:'Проверяем графику',completed:3,total:12},{owned:true})
  resetDesignProgressTiming()
  const task=designProgressSnapshot().find(t=>t.id==='stored-test')!
  assert.equal(task.startedAt,startedAt)
  assert.equal(task.label,'Большой файл.pptx')
  assert.equal(task.saved,true)
  assert.equal(remainingStageSeconds(task),null)
  settleDesignProgress(task.id,'error','Сбой сети')
  const failed=designProgressSnapshot().find(t=>t.id===task.id)!
  assert.equal(failed.step,'graphics')
  assert.equal(failed.owned,false)
  dismissDesignProgress(task.id)
})
