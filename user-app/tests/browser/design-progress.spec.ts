import { test, expect } from './workspace-fixture'
import { controlPptx } from '../fixtures/control-pptx'

const file = async () => ({ name:'Проверка этапов.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await controlPptx() })

test('deletion during the original import releases the upload form and does not reopen the deleted style',async({page,context})=>{
  await context.route('**/api/capabilities/qwen',r=>r.fulfill({json:{configured:true}}))
  let writes=0
  await context.route('**/api/uploads/*/semantic-scan',r=>{
    if(r.request().method()==='POST')writes++
    return r.fulfill({json:{run:{id:'busy-scan',status:'running',parts:[{status:'complete'},{status:'running'}]}}})
  })
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  const added=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/style-bank'&&r.request().method()==='POST')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({...await file(),name:'Проверка отмены импорта.pptx'})
  const id=(await(await added).json()).style.id
  await expect(page.getByRole('region',{name:'Сборка дизайн-системы'})).toContainText('Шаг 2 из 5')
  await expect(page.getByRole('button',{name:'Добавить дизайн-систему',exact:true})).toBeDisabled()
  const bank=await context.newPage();await bank.goto('/styles')
  await bank.getByRole('button',{name:'Удалить дизайн-систему Проверка отмены импорта',exact:true}).click()
  await bank.getByRole('alertdialog').getByRole('button',{name:'Удалить из банка',exact:true}).click()
  await expect(page.getByRole('button',{name:'Добавить дизайн-систему',exact:true})).toBeEnabled()
  await expect(page.getByRole('region',{name:'Сборка дизайн-системы'})).toHaveCount(0)
  await expect(page).toHaveURL(/\/styles$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(true)
  expect(writes).toBe(0)
  expect(await page.evaluate(id=>localStorage.getItem(`msp:cancelled-upload:${id}`),id)).toBe('1')
  await bank.close()
})

for(const phase of ['request','backoff'] as const)test(`deleting during ${phase} cancels the owner and a queued tab, and cannot restart after reload`,async({page,context,request},info)=>{
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles(await file())
  await expect(page.getByRole('link',{name:'Компоненты',exact:true})).toBeVisible()
  const id=new URL(page.url()).pathname.split('/').at(-1)!
  let attempts=0,release!:()=>void
  const gate=new Promise<void>(r=>{release=r})
  await context.route('**/api/capabilities/qwen',r=>r.fulfill({json:{configured:true}}))
  await context.route(`**/api/uploads/${id}/semantic-scan`,r=>r.fulfill({json:{run:{id:'scan',status:'complete',parts:[]}}}))
  await context.route(`**/api/uploads/${id}/calibration*`,async r=>{
    if(r.request().method()==='POST'){
      attempts++
      if(phase==='request')await gate
      return r.fulfill({status:503,json:{error:'Временный сбой'}}).catch(()=>undefined)
    }
    return r.fulfill({json:{components:[],checked:0,total:0,previews:[],calibrated:null,job:{id:'comparison',phase:'merge'},completedParts:0,totalParts:1}})
  })
  await page.reload()
  await expect.poll(()=>attempts).toBe(1)
  const ownerProgress=page.getByRole('region',{name:'Сборка дизайн-системы'})
  if(phase==='backoff')await expect(ownerProgress).toContainText('Повторим автоматически')
  const queued=await context.newPage();await queued.goto(`/styles/${id}`)
  await expect(queued.getByRole('region',{name:'Сборка дизайн-системы'})).toBeVisible()
  const bank=await context.newPage();await bank.goto('/styles')
  await bank.getByRole('button',{name:'Удалить дизайн-систему Проверка этапов',exact:true}).click()
  await bank.getByRole('alertdialog').getByRole('button',{name:'Удалить из банка',exact:true}).click()
  for(const tab of [page,queued,bank]){
    await expect(tab.getByRole('region',{name:'Сборка дизайн-системы'})).toHaveCount(0)
    expect(await tab.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(true)
  }
  release()
  expect((await(await request.get(`/api/uploads/${id}`)).json()).upload.status).toBe('cancelled')
  // Real server guards, independent of this browser's mocked model transport.
  for(const endpoint of ['semantic-scan','retry','editable-system','calibration','reconstruction','semantic-pilot','visual','editable-system/qualification']){
    const blocked=await request.post(`/api/uploads/${id}/${endpoint}`,{data:{}})
    expect(blocked.status(),endpoint).toBe(410)
  }
  expect((await request.post('/api/style-bank',{data:{uploadId:id}})).status()).toBe(410)
  await bank.screenshot({path:info.outputPath('bank-after-deletion.png')})
  await page.reload();await queued.reload()
  await expect(ownerProgress).toHaveCount(0)
  // Wait past the first retry deadline. Neither the cancelled owner nor the
  // waiter may take the Web Lock and issue the next comparison.
  if(phase==='backoff')await page.waitForTimeout(16000)
  expect(attempts).toBe(1)
  expect(await page.evaluate(id=>Object.keys(localStorage).some(k=>k.startsWith(`msp:auto-recovery:${id}:`)),id)).toBe(false)
  await queued.close();await bank.close()
})

test('server progress stays at the top, refreshes on return and does not present extraction as completion', async ({page},info) => {
  const id='a1234567-1234-4234-8234-123456789abc'
  let completed=2,status='processing'
  const writes:string[]=[]
  page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())})
  await page.route('**/api/uploads',r=>r.fulfill({json:{uploads:[{id,fileName:'Большая презентация.pptx',status,qwenStatus:status==='processing'?'processing':'analyzed',stage:'Анализируем оформление',progress:100,createdAt:new Date().toISOString()}]}}))
  await page.route(`**/api/uploads/${id}/semantic-scan`,r=>r.fulfill({json:{run:{id:'run',status:status==='processing'?'running':'complete',startedAt:new Date().toISOString(),parts:Array.from({length:6},(_,i)=>({status:i<completed?'complete':'waiting'}))}}}))
  await page.goto('/styles')
  const progress=page.getByRole('region',{name:'Сборка дизайн-системы'})
  await expect(progress).toContainText('2 из 6')
  await expect(progress).toContainText('Шаг 2 из 5')
  await expect(progress.locator('li')).toHaveCount(5)
  await expect(progress.getByText('Дизайн-система готова',{exact:true})).toHaveCount(0)
  await page.screenshot({path:info.outputPath('timeline-desktop.png')})
  await page.evaluate(()=>{document.querySelector<HTMLElement>('.ws-page')!.style.minHeight='2400px';window.scrollTo(0,1000)})
  expect(await page.evaluate(()=>window.scrollY)).toBeGreaterThan(500)
  expect((await progress.boundingBox())!.y).toBe(68)
  await page.evaluate(()=>window.scrollTo(0,0))
  for(const width of [720,390,320]){
    await page.setViewportSize({width,height:900})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await expect(progress).toContainText('Графика')
    const labels=await progress.locator('.ds-step-compact').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect()).map(r=>({left:r.left,right:r.right,width:r.width})))
    if(width<=480)for(let i=1;i<labels.length;i++)expect(labels[i].left-labels[i-1].right).toBeGreaterThan(3)
  }
  await page.screenshot({path:info.outputPath('timeline-mobile.png')})
  // Visibility is simulated deterministically; no reliance on a browser's
  // particular background timer budget or real model requests.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  completed=4
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
  await expect(progress).toContainText('4 из 6')
  status='ready_for_review';completed=6
  await page.evaluate(()=>window.dispatchEvent(new Event('style-bank:uploads-changed')))
  await expect(progress).toContainText('Откройте дизайн-систему, чтобы продолжить проверку компонентов.')
  await expect(progress.getByText('Дизайн-система готова',{exact:true})).toHaveCount(0)
  expect(writes).toEqual([])
})

test('file import stays in one tab and survives client navigation before storage finishes',async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/uploads/binary/*/complete',async route=>{await gate;await route.continue()})
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles(await file())
  const progress=page.getByRole('region',{name:'Сборка дизайн-системы'})
  await expect(progress).toContainText('Шаг 1 из 5')
  await expect(progress).toContainText('100%')
  const projects=page.getByRole('link',{name:'Проекты',exact:true})
  expect(await projects.getAttribute('target')).not.toBe('_blank')
  expect(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(false)
  await page.evaluate(()=>{(window as unknown as {navigationMarker:string}).navigationMarker='same-document'})
  await projects.click()
  await expect(page).toHaveURL(/\/projects$/)
  expect(context.pages()).toHaveLength(1)
  expect(await page.evaluate(()=>(window as unknown as {navigationMarker?:string}).navigationMarker)).toBe('same-document')
  await expect(progress).toContainText('Шаг 1 из 5')
  release()
  await expect(page.getByRole('link',{name:'Компоненты',exact:true})).toBeVisible()
  await expect(progress).toContainText('Файл сохранён. Для продолжения нужно подключить анализ оформления.')
  await expect(progress.getByText('Дизайн-система готова',{exact:true})).toHaveCount(0)
  expect(errors).toEqual([])
})

test('background worker progress shows activity and recovery in one tab without owning processing',async({page,context},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const id='b1234567-1234-4234-8234-123456789abc'
 let job={id,label:'Проверка фоновой сборки',revision:'test',status:'blocked',createdAt:Date.now()-10000,updatedAt:Date.now(),attempts:1,
  progress:{step:'components',scope:'compare',detail:'Сравниваем компоненты',completed:2,total:6},error:'Ответ модели не прошёл проверку объектов и связей.'}
 const posts:string[]=[]
 page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname)})
 await page.route('**/api/uploads',r=>r.fulfill({json:{uploads:[]}}))
 await page.route('**/api/processing',r=>r.fulfill({json:{configured:true,available:true,jobs:[job]}}))
 await page.route(`**/api/uploads/${id}/processing`,async r=>{
  expect(r.request().postDataJSON()).toEqual({restart:true})
  job={...job,status:'queued',updatedAt:Date.now()}
  await r.fulfill({status:202,json:{configured:true,available:true,job}})
 })
 await page.goto('/styles')
 const progress=page.getByRole('region',{name:'Сборка дизайн-системы'})
 await expect(progress.getByRole('alert')).toContainText('Ответ модели не прошёл проверку')
 await progress.getByRole('button',{name:'Повторить с сохранённого этапа'}).click()
 await expect(progress).toContainText('Задание в очереди')
 job={...job,status:'running',updatedAt:Date.now(),progress:{...job.progress,completed:3}}
 await page.evaluate(()=>window.dispatchEvent(new Event('processing-jobs:changed')))
 await expect(progress).toContainText('3 из 6')
 await expect(progress.locator('[aria-current=step] .ds-progress-spinner')).toBeVisible()
 await expect(progress).toContainText('Можно свернуть или закрыть вкладку')
 expect(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(true)
 await page.getByRole('link',{name:'Проекты',exact:true}).click()
 await expect(page).toHaveURL(/\/projects$/)
 expect(context.pages()).toHaveLength(1)
 await expect(progress).toContainText('3 из 6')
 await page.screenshot({path:info.outputPath('background-progress.png')})
 job={...job,status:'complete',updatedAt:Date.now()}
 await page.evaluate(()=>window.dispatchEvent(new Event('processing-jobs:changed')))
 await expect(progress).toContainText('Дизайн-система готова')
 await progress.getByRole('button',{name:'Скрыть завершённый статус'}).click()
 await page.evaluate(()=>window.dispatchEvent(new Event('processing-jobs:changed')))
 await expect(progress).toHaveCount(0)
 expect(posts).toEqual([`/api/uploads/${id}/processing`])
 expect(errors).toEqual([])
})

test('automatic checks recover without a button and finish only after graphic verification',async({page},info)=>{
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles(await file())
  await expect(page.getByRole('link',{name:'Компоненты',exact:true})).toBeVisible()
  const id=new URL(page.url()).pathname.split('/').at(-1)!
  let attempts=0,calibrated=false,graphics=false,qualified=false
  let releaseHtml!:()=>void,releaseGraphics!:()=>void
  const htmlGate=new Promise<void>(resolve=>{releaseHtml=resolve}),graphicsGate=new Promise<void>(resolve=>{releaseGraphics=resolve})
  await page.route('**/api/capabilities/qwen',r=>r.fulfill({json:{configured:true}}))
  await page.route(`**/api/uploads/${id}/semantic-scan`,r=>r.fulfill({json:{run:{id:'scan-complete',status:'complete',parts:[]}}}))
  await page.route(`**/api/uploads/${id}/calibration*`,async r=>{
    if(r.request().method()==='POST'){
      attempts++
      if(attempts===1)return r.fulfill({status:503,json:{error:'Проверка сети: временный сбой'}})
      calibrated=true;return r.fulfill({contentType:'application/x-ndjson',body:'{"complete":true}\n'})
    }
    return r.fulfill({json:{components:[],checked:2,total:2,previews:[],calibrated:calibrated?{}:null,job:calibrated?null:{id:'comparison',phase:'merge'},completedParts:0,totalParts:1}})
  })
  await page.route(`**/api/uploads/${id}/editable-system`,r=>r.fulfill({json:{completed:1,total:1,running:false,native:[],catalog:{id:'a'.repeat(64),families:[],qualification:qualified?{checks:[]}:null}}}))
  await page.route(`**/api/uploads/${id}/editable-system/qualification`,async r=>{await htmlGate;qualified=true;await r.fulfill({json:{ok:true}})})
  await page.route(`**/api/uploads/${id}/editable-system/refinements`,r=>r.fulfill({json:{configured:true,background:false,catalogId:'a'.repeat(64),ready:true,coverage:[],jobs:[],pending:null,canUndo:false,applied:[],stale:false}}))
  await page.route(`**/api/uploads/${id}/reconstruction`,async r=>{
    if(r.request().method()==='POST'){await graphicsGate;graphics=true;return r.fulfill({contentType:'application/x-ndjson',body:'{"complete":true}\n'})}
    return r.fulfill({json:{revision:'test',completed:graphics?1:0,total:1,pending:graphics?[]:[{id:'native-diagram'}],results:[],catalog:{}}})
  })
  await page.reload()
  const progress=page.getByRole('region',{name:'Сборка дизайн-системы'})
  await expect(page.locator('.ws-heading .ws-eyebrow')).toHaveCount(0)
  await expect(page.getByText('Редактируемые конструкции',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Сборка продолжается автоматически',{exact:true})).toHaveCount(0)
  const search=page.getByRole('searchbox',{name:'Поиск конструкции'})
  await expect(search).toBeVisible()
  const searchBox=(await search.locator('..').boundingBox())!,panel=(await page.locator('.ds-panel').boundingBox())!
  expect(Math.abs(searchBox.x-panel.x)).toBeLessThan(2)
  await expect(progress).toContainText('Проверка сети: временный сбой')
  await expect(progress.locator('[aria-current=step]')).toContainText('Компоненты')
  await expect(progress).toContainText('Повторим автоматически')
  await expect(page.getByRole('button',{name:/Продолжить (анализ|сборку)/})).toHaveCount(0)
  await expect(progress).toContainText('Шаг 4 из 5',{timeout:30000})
  await expect(progress.getByText('Дизайн-система готова',{exact:true})).toHaveCount(0)
  releaseHtml()
  await expect(progress).toContainText('Шаг 5 из 5')
  await expect(progress).toContainText('0 из 1')
  await page.screenshot({path:info.outputPath('timeline-final-step.png')})
  releaseGraphics()
  await expect(progress).toContainText('Дизайн-система готова')
  await expect(progress.locator('[data-state=done]')).toHaveCount(5)
  expect(attempts).toBe(2)
  expect(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(true)
  await expect(page.locator('.ws-analysis').filter({hasText:'Анализируем оформление'})).toHaveCount(0)
  await progress.getByRole('button',{name:'Скрыть завершённый статус'}).click()
  await expect(progress).toHaveCount(0)
})

test('an interrupted server scan resumes automatically once even with two open tabs',async({page,context})=>{
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles(await file())
  await expect(page.getByRole('link',{name:'Компоненты',exact:true})).toBeVisible()
  const id=new URL(page.url()).pathname.split('/').at(-1)!
  let resumes=0,complete=false
  await context.route('**/api/capabilities/qwen',r=>r.fulfill({json:{configured:true}}))
  await context.route(`**/api/uploads/${id}/semantic-scan`,r=>{
    if(r.request().method()==='POST'){resumes++;complete=true;return r.fulfill({status:202,contentType:'application/x-ndjson',body:'{"run":{"status":"running"}}\n{"complete":true}\n'})}
    return r.fulfill({json:{run:{id:'interrupted',status:complete?'complete':'failed',error:'Анализ прерван. Готовые части сохранены.',parts:[]}}})
  })
  await context.route(`**/api/uploads/${id}/calibration*`,r=>r.fulfill({json:{components:[],checked:0,total:0,previews:[],calibrated:{},job:null}}))
  await context.route(`**/api/uploads/${id}/editable-system`,r=>r.fulfill({json:{completed:0,total:0,native:[],catalog:{id:'a'.repeat(64),families:[],qualification:{checks:[]}}}}))
  await context.route(`**/api/uploads/${id}/editable-system/refinements`,r=>r.fulfill({json:{configured:true,background:false,catalogId:'a'.repeat(64),ready:true,coverage:[],jobs:[],pending:null,canUndo:false,applied:[],stale:false}}))
  await context.route(`**/api/uploads/${id}/reconstruction`,r=>r.fulfill({json:{completed:0,total:0,pending:[],results:[],catalog:{}}}))
  await page.reload()
  await expect(page.getByRole('region',{name:'Сборка дизайн-системы'})).toContainText('Повторим автоматически')
  const other=await context.newPage()
  await other.goto(`/styles/${id}`)
  await expect(page.getByRole('region',{name:'Сборка дизайн-системы'})).toContainText('Дизайн-система готова',{timeout:35000})
  await expect(other.getByRole('region',{name:'Сборка дизайн-системы'})).toContainText('Дизайн-система готова',{timeout:35000})
  expect(resumes).toBe(1)
  await expect(page.locator('.ws-analysis')).toHaveCount(0)
  await other.close()
})
