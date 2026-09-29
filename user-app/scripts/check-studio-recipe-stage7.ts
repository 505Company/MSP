import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {componentBindings} from '../lib/presentations/studio/bindings'
import {STUDIO_VERSION,type StudioRun,type DesignOption,type SlideWork} from '../lib/presentations/studio/contract'
import {validateReceipt} from '../lib/presentations/studio/storage'

const [input,out]=process.argv.slice(2)
if(!input||!out)throw Error('Usage: check-studio-recipe-stage7.ts saved-run.json output-directory')
const bytes=await readFile(input),run=JSON.parse(bytes.toString()) as StudioRun,hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
await mkdir(out,{recursive:true})
const sourceHash=hash(bytes),report:{id:string;candidates:number;elapsedMs:number;options?:{id:string;candidate:string;components:unknown}[];error?:string}[]=[]
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const writes:string[]=[]
try{
  const page=await browser.newPage()
  await page.route('**/api/**',r=>{if(r.request().method()==='GET')return r.continue();writes.push(r.request().url());return r.abort()})
  await page.goto('http://127.0.0.1:5184/processing-worker')
  for(const source of run.slides){
    const work:SlideWork={content:source.content,candidates:candidatesFor(source.content,run.recipeScope??'all'),bindings:Object.fromEntries(source.content.blocks.map(b=>[b.id,componentBindings(b,run.library)]))},start=Date.now()
    let options:DesignOption[]=[]
    try{
      options=await page.evaluate(async({library,work})=>{const p='/browser/studio-generation.ts',{renderStudioOptions}=await import(p) as typeof import('../browser/studio-generation');return renderStudioOptions(library,work,AbortSignal.timeout(120000))},{library:run.library,work})
      for(const [i,option] of options.entries()){
        validateReceipt({...run,version:STUDIO_VERSION,slides:[work]},option.receipt,true)
        await writeFile(`${out}/${work.content.id}-${i+1}.png`,Buffer.from(option.receipt!.preview.split(',')[1],'base64'))
      }
      await writeFile(`${out}/${work.content.id}.json`,JSON.stringify({work,options}))
      report.push({id:work.content.id,candidates:work.candidates.length,elapsedMs:Date.now()-start,options:options.map(o=>({id:o.id,candidate:o.plan.candidateId,components:o.receipt!.components}))})
    }catch(error){report.push({id:work.content.id,candidates:work.candidates.length,elapsedMs:Date.now()-start,error:error instanceof Error?error.message:String(error)})}
    console.log(JSON.stringify(report.at(-1)))
    await writeFile(`${out}/report.json`,JSON.stringify({version:STUDIO_VERSION,input,sourceHash,unchanged:hash(await readFile(input))===sourceHash,blockedWrites:writes,modelRequests:0,slides:report},null,2))
  }
}finally{await browser.close()}
if(writes.length||report.some(r=>r.error)||hash(await readFile(input))!==sourceHash)process.exitCode=1
