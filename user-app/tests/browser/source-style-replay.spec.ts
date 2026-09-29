import {test,expect} from '@playwright/test'
import fs from 'node:fs/promises'
import type {StudioRun} from '../../lib/presentations/studio/contract'

test('local source style replay',async({page,request},info)=>{
  const fixture=process.env.MSP_STYLE_REPLAY_FIXTURE
  test.skip(!fixture,'Requires an immutable local project/library snapshot')
  test.setTimeout(600000)
  const {run,project}=JSON.parse(await fs.readFile(fixture!,'utf8')) as {run:StudioRun;project:{text:string}}
  await page.route('**/api/uploads/**',async route=>{
    const url=new URL(route.request().url());const response=await request.get('http://127.0.0.1:5184'+url.pathname+url.search)
    await route.fulfill({response})
  })
  await page.goto('/processing-worker')
  const contents=await page.evaluate(async({library,text})=>{const p='/lib/presentations/studio/fast-content.ts';return(await import(p) as typeof import('../../lib/presentations/studio/fast-content')).fastContent(text,library)},{library:run.library,text:project.text})
  const results=[]
  for(const [index,content] of contents.entries()){
    const result=await page.evaluate(async({library,content,variation,chrome})=>{
      const p={r:'/browser/studio-generation.ts',c:'/lib/presentations/studio/recipes.ts',b:'/lib/presentations/studio/bindings.ts',v:'/lib/presentations/studio/visual-design.ts'}
      const {renderStudioOptions}=await import(p.r) as typeof import('../../browser/studio-generation')
      const {candidatesFor}=await import(p.c) as typeof import('../../lib/presentations/studio/recipes')
      const {componentBindings}=await import(p.b) as typeof import('../../lib/presentations/studio/bindings')
      const {libraryCoverCandidates}=await import(p.v) as typeof import('../../lib/presentations/studio/visual-design')
      const work={content,chrome,variation,candidates:[...libraryCoverCandidates(content,library),...candidatesFor(content)],bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))}
      return (await renderStudioOptions(library,work,undefined,{limit:1}))[0].receipt!
    },{library:run.library,content,variation:run.variation,chrome:run.slides[index].chrome})
    results.push(result)
    await fs.writeFile(info.outputPath(`slide-${index+1}.png`),Buffer.from(result.preview.split(',')[1],'base64'))
    await fs.writeFile(info.outputPath('receipts.json'),JSON.stringify(results))
    console.log(index+1,result.candidateId,result.passed,result.text.map(t=>t.size).join(','))
    expect(result.passed,result.issues.join('; ')).toBe(true)
  }
})
