import {chromium} from '@playwright/test'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import type {StudioRun} from '../lib/presentations/studio/contract'
import {applicationSnapshot} from './pixel-pilot-store'
import {compactPackets} from '../lib/presentations/studio/compact-content'

// Exercises the public generation path with the file verbatim. No plans,
// normalized blocks, component bindings or recipe choices are supplied here.
const input=process.argv[2]
if(!input)throw Error('Usage: node --import tsx scripts/check-studio-input-live.ts <input.md> [fast|smart]')
const mode=process.argv[3]==='smart'?'smart':'fast'
const compositionMode=process.argv.includes('--components')?'components':'recipes'
const recipeScope=process.argv.includes('--new-recipes')?'new':'all'
if(recipeScope==='new'&&compositionMode==='components')throw Error('New-recipe filter requires fast or balanced mode')
const experimentalRoute=process.argv.includes('--akashml-fp8')?'akashml-fp8':undefined
if(experimentalRoute&&mode!=='smart')throw Error('Explicit test route requires smart mode')
const existing=process.argv.find(a=>a.startsWith('--project='))?.slice('--project='.length)
const resume=process.argv.includes('--resume')
const localOnly=process.argv.includes('--local-only')
const attempt=process.argv.find(a=>a.startsWith('--attempt='))?.slice('--attempt='.length)
if(resume&&(!existing||!attempt))throw Error('Resume requires --project and a separate --attempt output directory')
if(attempt&&!/^[a-z0-9-]+$/.test(attempt))throw Error('Invalid attempt directory')
const text=await readFile(input,'utf8'),base='http://127.0.0.1:5184',id=existing??crypto.randomUUID()
const expectedSlides=compactPackets(text).length
const requestsPerSlide=compositionMode==='components'?3:2 // initial + one repair per failed stage
const out=`outputs/diagnostics/${mode==='smart'?'studio-semantic-pilot':'studio-content-456'}/${id}${attempt?'/'+attempt:''}`
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const protectedFiles=['lib/presentations/studio/compositions.ts','lib/presentations/studio/recipes.ts','lib/presentations/studio/authored/content.ts','lib/presentations/studio/authored/editorial.ts','lib/presentations/studio/authored/structured.ts','lib/presentations/studio/authored/incoming/section-39-514.recipe.ts','lib/presentations/studio/authored/incoming/section-39-798.recipe.ts']
const before=Object.fromEntries(await Promise.all(protectedFiles.map(async path=>[path,hash(await readFile(path,'utf8'))])))
const response=existing?await fetch(base+'/api/projects/'+id):await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,uploadId:'7f88bbe2-84f0-4c73-9c24-3409aca3f5b8',name:`MSP · ${recipeScope==='new'?'Новые рецепты':compositionMode==='components'?'Только компоненты':'исходный контент'} · ${mode==='smart'?'Qwen':'быстрый тест'}`,text,generationMode:mode,compositionMode,recipeScope,...experimentalRoute?{modelRoute:experimentalRoute}:{}})})
if(!response.ok)throw Error(await response.text())
if(existing){const {project}=await response.json() as {project:{text:string;uploadId:string;generationMode:string;compositionMode?:string;recipeScope?:string}};if(project.text!==text||project.uploadId!=='7f88bbe2-84f0-4c73-9c24-3409aca3f5b8'||project.generationMode!==mode||(project.compositionMode??'recipes')!==compositionMode||(project.recipeScope??'all')!==recipeScope)throw Error('Existing project differs from the approved input, design system or mode')}
const prior=existing?(await(await fetch(`${base}/api/projects/${id}/compose`)).json() as {run:StudioRun|null}).run:null
const priorModelRequests=prior?.modelRequests??0
if(resume&&prior?.status!=='blocked')throw Error('Resume requires a blocked product run')
await mkdir(out,{recursive:true});await writeFile(out+'/input.md',text)
console.log(JSON.stringify({url:`${base}/projects/${id}`,out,inputHash:hash(text)}))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}})
  let structures=0,structureFinished=false
  const requestedSlides=new Map<string,number>()
  page.on('requestfinished',request=>{if(request.url().endsWith(`/api/projects/${id}/compose`)&&request.method()==='POST'&&request.postDataJSON()?.action==='structure')structureFinished=true})
  await page.route('**/api/uploads/**',r=>r.request().method()==='GET'?r.continue():r.abort())
  await page.route('**/api/projects/*/compose',r=>{
    if(r.request().method()==='POST'){
      const action=r.request().postDataJSON().action
      if(action==='design')return r.abort()
      if(action==='structure'){
        if(localOnly)return r.abort()
        const slideId=r.request().postDataJSON().slideId??'legacy'
        const count=(requestedSlides.get(slideId)??0)+1
        if(mode!=='smart'||++structures>expectedSlides*requestsPerSlide||count>requestsPerSlide)return r.abort()
        requestedSlides.set(slideId,count)
      }
      if(action==='structure'&&experimentalRoute&&existing)return r.continue({postData:JSON.stringify({...r.request().postDataJSON(),experimentalRoute})})
    }return r.continue()
  })
  const started=Date.now();await page.goto(`${base}/projects/${id}?generate=1`)
  if(resume)await page.getByRole('button',{name:'Продолжить создание',exact:true}).click()
  let run:StudioRun|undefined,last=''
  while(Date.now()-started<900000){
    run=(await(await fetch(`${base}/api/projects/${id}/compose`)).json() as {run:StudioRun}).run
    const state=run?`${run.status}:${Object.keys(run.results).length}`:'starting'
    if(state!==last){console.log(JSON.stringify({elapsedMs:Date.now()-started,state}));last=state}
    const busy=await page.locator('[data-generation-busy=true]').count()
    const retrySettled=!resume||Date.now()-started>3000&&(!busy)&&(structureFinished||await page.locator('.pw-error').count())
    if(run?.status==='complete'||!busy&&retrySettled&&(run?.status==='blocked'||await page.locator('.pw-error').count()))break
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  const elapsedMs=Date.now()-started
  await writeFile(out+'/run.json',JSON.stringify(run));await page.screenshot({path:out+'/project.png',fullPage:true})
  for(const r of Object.values(run?.results??{}))await writeFile(out+`/${r.slideId}.png`,Buffer.from(r.preview.split(',')[1],'base64'))
  const after=Object.fromEntries(await Promise.all(protectedFiles.map(async path=>[path,hash(await readFile(path,'utf8'))])))
  const savedTemplates=JSON.parse(await readFile('outputs/diagnostics/studio-semantic-pilot/templates-before.json','utf8'))
  const model=[]
  if(mode==='smart'&&run){
    const snapshot=applicationSnapshot(),prefix=`presentation-studio/${id}/${run.revision}/semantic`
    for(const modelId of run.modelRunIds){
      const key=snapshot.rows.find(r=>r.key.startsWith(prefix+'/')&&r.key.endsWith(`/runs/${modelId}.json`))?.key
      const modelPrefix=key?.split('/runs/')[0]??prefix
      const metadata=await snapshot.read(`${modelPrefix}/runs/${modelId}.json`),response=await snapshot.read(`${modelPrefix}/responses/${modelId}.json`),inputs=metadata?await snapshot.read(`${modelPrefix}/inputs/${metadata.inputHash}.json`):null
      await writeFile(`${out}/model-${modelId}.json`,JSON.stringify({metadata,response,inputs},null,2));model.push(metadata)
    }
  }
  const report={project:id,url:`${base}/projects/${id}`,elapsedMs,status:run?.status,error:run?.error,mode,modelRequests:run?.modelRequests,priorModelRequests,newModelRequests:(run?.modelRequests??0)-priorModelRequests,model,semantic:run?.semantic,inputHash:hash(text),before,after,productionFilesUnchanged:JSON.stringify(before)===JSON.stringify(after),templatesUnchangedFromBeforeExperiment:Object.entries(savedTemplates).every(([path,digest])=>after[path]===digest),messages:await page.locator('[role=status],.pw-error').allTextContents(),slides:run?.slides.map(s=>({title:s.content.title,blocks:s.content.blocks.map(b=>({kind:b.kind,role:b.role,fields:b.fields})),selected:s.plan?.candidateId,options:s.options?.map(o=>({label:o.label,candidate:o.plan.candidateId,passed:o.receipt?.passed}))})),results:Object.values(run?.results??{}).map(r=>({candidate:r.candidateId,passed:r.passed,issues:r.issues,warnings:r.warnings,components:r.components}))}
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,elapsedMs,modelRequests:report.modelRequests,productionFilesUnchanged:report.productionFilesUnchanged,slides:report.slides?.map(s=>({title:s.title,selected:s.selected})),results:report.results},null,2))
  const results=(run?.slides??[]).flatMap(s=>run?.results[s.content.id]?[run.results[s.content.id]]:[])
  if(results.length){
    const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>MSP · автоматическая проверка пользовательского содержания</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f5f7;color:#172534;font:20px system-ui}h1{margin:0 0 28px;font-size:32px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:30px}figure{margin:0}img{width:100%;display:block;background:white;border:1px solid #d9dfe7}figcaption{font-weight:600;margin-top:12px}</style><h1>MSP · пользовательское содержание · автоматический результат</h1><main>${results.map(r=>`<figure><img src="${r.preview}" alt="Слайд ${r.slideId.replace('slide-','')}"><figcaption>${r.slideId.replace('slide-','')}. ${r.candidateId}</figcaption></figure>`).join('')}</main></html>`
    await writeFile(out+'/overview.html',html);await page.setViewportSize({width:1920,height:900});await page.setContent(html);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>(img as HTMLImageElement).decode())));await page.screenshot({path:out+'/overview.png',fullPage:true})
  }
  const oldTemplatesIntact=Object.entries(savedTemplates).filter(([path])=>path!=='lib/presentations/studio/recipes.ts').every(([path,digest])=>after[path]===digest)
  const onlyNew=recipeScope!=='new'||run?.slides.every(s=>s.candidates.every(c=>c.recipeId.startsWith('39:514/')||c.recipeId.startsWith('39:798/')))
  if(run?.status!=='complete'||report.newModelRequests>(mode==='smart'&&!localOnly?expectedSlides*requestsPerSlide:0)||!report.productionFilesUnchanged||!oldTemplatesIntact||!onlyNew)process.exitCode=1
}finally{await browser.close()}
