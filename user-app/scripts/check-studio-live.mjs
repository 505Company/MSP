import {chromium} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
const [uploadId,mode='fast',resume]=process.argv.slice(2)
const replay=process.env.STUDIO_REPLAY==='1'
if(!uploadId||!['fast','smart'].includes(mode))throw Error('Usage: check-studio-live.mjs UPLOAD fast|smart')
if(replay&&!resume)throw Error('Rendering replay requires an existing test project')
const id=resume||crypto.randomUUID(),base='http://127.0.0.1:5184',output=`outputs/diagnostics/studio-live/${uploadId}-${mode}/${id}/${Date.now()}`
await mkdir(output,{recursive:true})
const all=await readFile('outputs/diagnostics/autolayout-tourism-10/source.md','utf8')
const text=all.split(/(?=^\d+\. \*\*)/m).filter(t=>/^\d+\. \*\*/.test(t)).slice(0,3).join('\n')
const response=resume?await fetch(base+`/api/projects/${id}`):await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,uploadId,name:`Проверка рецептов · ${mode}`,text,generationMode:mode})})
if(!response.ok)throw Error(await response.text())
await writeFile(output+'/project.json',JSON.stringify(await response.json(),null,2))
console.log(JSON.stringify({project:id,mode,textLength:text.length}))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  // This is generation, not permission to resume unrelated imports.
  await page.route('**/api/uploads/**',r=>r.request().method()==='GET'?r.continue():r.abort())
  await page.goto(base+`/projects/${id}${resume?'':'?generate=1'}`)
  const start=Date.now();let last='',run
  if(replay)await page.evaluate(async id=>{
    const url=`/api/projects/${id}/compose`,{run}=await(await fetch(url)).json(),path='/browser/studio-generation.ts'
    const {renderStudioSlide}=await import(path)
    for(const slide of run.slides){
      const receipt=await renderStudioSlide(run.library,slide)
      const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'render',revision:run.revision,receipt})})
      if(!result.ok)throw Error(await result.text())
    }
  },id)
  else if(resume&&(await(await fetch(base+`/api/projects/${id}/compose`)).json()).run?.status!=='complete')await page.getByRole('button',{name:'Продолжить создание'}).click()
  while(Date.now()-start<300000){
    const r=await fetch(base+`/api/projects/${id}/compose`),data=await r.json();run=data.run
    const status=run?`${run.status}:${Object.keys(run.results).length}`:JSON.stringify(await page.locator('[role=status],.pw-error').allTextContents())
    if(last!==status){console.log(JSON.stringify({elapsed:Date.now()-start,status,configured:data.configured,prepared:run&&Object.keys(run.library.prepared).length,native:run?.library.editable.length}));last=status}
    if(run?.status==='complete'||await page.locator('.pw-error').count())break
    await new Promise(resolve=>setTimeout(resolve,2000))
  }
  await page.screenshot({path:output+'/project.png',fullPage:true})
  if(run)for(const [i,s] of run.slides.entries()){const r=run.results[s.content.id];if(r)await writeFile(output+`/slide-${i+1}.png`,Buffer.from(r.preview.split(',')[1],'base64'))}
  const summary={project:id,url:base+`/projects/${id}`,mode,replay,status:run?.status,elapsedMs:Date.now()-start,errors,messages:await page.locator('[role=status],.pw-error').allTextContents(),modelRequests:run?.modelRequests,components:run&&Object.keys(run.library.prepared).length,native:run?.library.editable.length,results:run&&Object.values(run.results).map(({preview,html,...r})=>{void preview;void html;return r})}
  await writeFile(output+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({status:summary.status,messages:summary.messages,errors}))
  if(run?.status!=='complete')process.exitCode=1
}finally{await browser.close()}
