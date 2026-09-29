import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {applicationSnapshot} from './pixel-pilot-store'
import {studioSlides} from '../lib/presentations/studio/context'
import {fastContent} from '../lib/presentations/studio/fast-content'
import {componentFlexTask} from '../lib/presentations/studio/component-flex'
import type {StudioRun,SlideWork} from '../lib/presentations/studio/contract'
const root='outputs/diagnostics/studio-design-system-usage',out=root+'/after';await mkdir(out,{recursive:true})
const load=async(file:string)=>JSON.parse(await readFile(root+'/'+file,'utf8'))
const balanced=await load('9b5a393d-aca4-407d-8585-f50d6cf81016-13f468ff-c16c-4392-905d-235bdb8b2f1f-before.json') as StudioRun
const creative=await load('241766d0-1b67-47f3-96ca-7b0d166de816-d38bc9c2-3ee6-401d-8c9e-7ce6a5b245ea-before.json') as StudioRun
const project=await load('9b5a393d-aca4-407d-8585-f50d6cf81016-project-before.json'),snap=await applicationSnapshot()
const cases:{mode:string;work:SlideWork;run:StudioRun}[]=[]
for(const [mode,content]of [['fast',fastContent(project.text,balanced.library)],['balanced',balanced.slides.map(w=>w.content)]] as const){
 for(const work of await studioSlides(snap.bucket,balanced.projectId,balanced.library,content,'all'))cases.push({mode,work,run:balanced})
}
for(const work of creative.slides)cases.push({mode:'creative',work,run:creative})
const reply=await load('failed-creative-response-7dc0196b-f7a3-4af3-b4ef-f33e7280885e.json')
try{const work=componentFlexTask(creative.semantic!.units!.find(u=>u.id==='slide-5')!.packet,creative.library).validate(JSON.parse(reply.content)).work;cases.push({mode:'creative',work,run:creative})}catch(e){console.log('creative/slide-5 validation:',String(e))}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const summary:unknown[]=[]
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5184/processing-worker');
 for(const {mode,work,run}of cases){const key=mode+'-'+work.content.id;if(process.argv[2]&&!key.includes(process.argv[2]))continue
  console.log('START',key,new Date().toISOString());const start=Date.now()
  try{const options=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts',m=await import(path) as typeof import('../browser/studio-generation');return m.renderStudioOptions(library,work,undefined,{limit:1})},{library:run.library,work})
    const r=options[0].receipt!;await writeFile(`${out}/${key}.json`,JSON.stringify({work,options}));await writeFile(`${out}/${key}.png`,Buffer.from(r.preview.split(',')[1],'base64'));await writeFile(`${out}/${key}.html`,r.html)
    const result={key,passed:r.passed,candidate:r.candidateId,background:work.candidates.find(c=>c.id===r.candidateId)?.backgroundId,issues:r.issues,seconds:(Date.now()-start)/1000};summary.push(result);console.log(JSON.stringify(result))
  }catch(e){const result={key,passed:false,error:String(e),seconds:(Date.now()-start)/1000};summary.push(result);console.log(JSON.stringify(result))}
  await writeFile(`${out}/summary${process.argv[2]?'-'+process.argv[2]:''}.json`,JSON.stringify(summary,null,2))
 }
}finally{await browser.close()}
