import {chromium} from '@playwright/test'
import {existsSync,readdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {protectWorkerFromRefresh} from './worker-hmr.mjs'

const origin=new URL(process.env.MSP_WORKER_ORIGIN||'http://127.0.0.1:5184').origin
const token=process.env.MSP_WORKER_TOKEN
if(!token)throw Error('MSP_WORKER_TOKEN is required')
const workerId=randomUUID()
let stopping=false,browser,browserLoading
const activeContexts=new Set()
const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const bundledChrome=chromium.executablePath()
function installedHeadlessShell(){
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||join(homedir(),process.platform==='darwin'?'Library/Caches':'.cache','ms-playwright')
 try{
  for(const entry of readdirSync(cache).filter(x=>/^chromium_headless_shell-\d+$/.test(x)).sort((a,b)=>Number(b.split('-').at(-1))-Number(a.split('-').at(-1)))){
   for(const folder of readdirSync(join(cache,entry))){
    const path=join(cache,entry,folder,process.platform==='win32'?'chrome-headless-shell.exe':'chrome-headless-shell')
    if(existsSync(path))return path
   }
  }
 }catch{ /* An explicit path or the supported platform browser can still work. */ }
}
const executablePath=process.env.MSP_BROWSER_PATH||(existsSync(bundledChrome)?undefined:installedHeadlessShell()||(existsSync(macChrome)?macChrome:undefined))
async function renderer(){
 if(!browser?.isConnected()){
  browserLoading??=chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']}).finally(()=>{browserLoading=undefined})
  browser=await browserLoading
 }
 return browser
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const request=async body=>{
 const r=await fetch(origin+'/api/processing/worker',{method:'POST',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({workerId,...body}),signal:AbortSignal.timeout(15000)})
 const data=await r.json()
 if(!r.ok)throw Object.assign(Error(data.error||'Worker request failed'),{status:r.status})
 return data
}
async function processJob(job){
 // One renderer page, created only for an actual job and released afterwards.
 const context=await(await renderer()).newContext({viewport:job.kind==='presentation'?{width:1920,height:1080}:{width:1440,height:1000}})
 activeContexts.add(context)
 await protectWorkerFromRefresh(context,origin)
 const page=await context.newPage()
 if(job.kind==='presentation')await page.exposeFunction('__mspCaptureLayout',async id=>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid capture identity')
  const png=await page.locator(`[data-layout-capture="${id}"]`).screenshot({type:'png',animations:'disabled',timeout:30000})
  return 'data:image/png;base64,'+png.toString('base64')
 })
 let progress=job.progress,lost=false,updating=false
 await page.exposeFunction('__mspWorkerProgress',value=>{progress=value})
 const update=async extra=>request({action:'update',...(job.kind?{kind:job.kind}:{}),id:job.id,token:job.leaseToken,update:{progress,...extra}})
 let lastHeartbeat=Date.now()
 const timer=setInterval(async()=>{
  if(updating||lost)return
  updating=true
  try{await update({});lastHeartbeat=Date.now()}
  catch(error){
   if([409,410].includes(error.status)||Date.now()-lastHeartbeat>25000){lost=true;await context.close().catch(()=>{})}
  }finally{updating=false}
 },5000)
 try{
  await page.goto(origin+'/processing-worker',{waitUntil:'domcontentloaded',timeout:60000})
  await page.waitForFunction(kind=>kind==='studio'?!!window.__mspRunStudio:kind==='components'?!!window.__mspRunComponents:kind==='recipes'?!!window.__mspRunRecipes:kind==='presentation'?!!window.__mspRunLayout:!!window.__mspRunBackground,job.kind,{timeout:60000})
  const result=await page.evaluate(job=>job.kind==='studio'?window.__mspRunStudio(job.projectId,job.id,job.leaseToken):job.kind==='components'?window.__mspRunComponents(job.id,job.jobId,job.leaseToken):job.kind==='recipes'?window.__mspRunRecipes(job.id,job.jobId,job.leaseToken):job.kind==='presentation'?window.__mspRunLayout(job.id,job.inputId,job.retry):window.__mspRunBackground(job.id),job)
  clearInterval(timer)
  // Serialize the final state after any in-flight heartbeat.
  while(updating)await sleep(20)
  if(lost)return
  if(result.ok){await update({complete:true});console.log('[processing-worker] completed '+job.id)}
  else if(!result.cancelled){await update({error:result.error,...(result.errorCode?{errorCode:result.errorCode}:{}),retryable:result.retryable});console.log('[processing-worker] checkpoint saved '+job.id)}
 }catch(error){
  clearInterval(timer)
  if(!lost&&!stopping){
   while(updating)await sleep(20)
   await update({error:'Фоновый обработчик прервался. Продолжим с сохранённого этапа.',retryable:true}).catch(()=>{})
   console.error('[processing-worker] renderer interrupted '+job.id+' ('+(error.name||'Error')+')')
  }
 }finally{clearInterval(timer);await context.close().catch(()=>{});activeContexts.delete(context)}
}
async function stop(){stopping=true;await Promise.allSettled([...activeContexts].map(context=>context.close()));await browser?.close().catch(()=>{})}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
process.on('disconnect',()=>void stop())
async function lane(kinds){
 while(!stopping){
  try{
   const {job}=await request({action:'claim',kinds})
   if(job){
    console.log('[processing-worker] claimed '+job.id)
    try{await processJob(job)}
    catch{await request({action:'update',...(job.kind?{kind:job.kind}:{}),id:job.id,token:job.leaseToken,update:{error:'Не удалось запустить фоновую проверку. Готовые этапы сохранены.',retryable:true}}).catch(()=>{})}
   }
   else await sleep(3000)
  }catch{if(!stopping)await sleep(5000)}
 }
}
try{
 // Each generation has an isolated renderer. Import and legacy jobs retain
 // one lane; two more lanes keep independent MSP modes moving concurrently.
 await Promise.all([lane(process.env.MSP_STUDIO_ONLY==='1'?['studio']:['presentation','recipes','components','studio']),lane(['studio']),lane(['studio'])])
}finally{await stop();if(process.connected)process.disconnect()}
