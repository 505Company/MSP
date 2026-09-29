import {test,expect} from './workspace-fixture'
import {writeFile,readFile} from 'node:fs/promises'
import JSZip from 'jszip'
import {studioFixture} from '../fixtures/studio'
import {BRAND_ACCENTS_VERSION} from '../../lib/presentations/studio/brand-accents'

test('sparse accent panels have white text and preserve geometry through refresh and export',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  // One short line leaves >70% of this region empty even after adaptive
  // display fitting. A two-line 224px heading is no longer a sparse region.
  const run=studioFixture('fast','# Итог\n\n+23%\nспрос в низкий сезон\n\n75%\nмесяцев показывают рост\n\n−17 п.п.\nснижается разрыв между сезонами\n\nПо данным аналитики, 2026 год.')
  run.library.tokens.colors=['#0077FF','#000000','#FFFFFF','#FF3885','#FFE59C','#C3A3E2','#7CEDF8','#FFBD92'].map(hex=>({hex,occurrences:1}))
  const result=await page.evaluate(async(run)=>{
    const paths={render:'/browser/studio-generation.ts',colors:'/browser/studio-color-zones.ts',options:'/lib/presentations/studio/options.ts',recipes:'/lib/presentations/studio/recipes.ts'}
    const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{restyleStudioReceipt}=await import(paths.colors) as typeof import('../../browser/studio-color-zones'),{draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
    const work=run.slides[0];work.content.blocks.filter(b=>b.kind==='metric').forEach(b=>b.placement='right')
    const {candidatesFor}=await import(paths.recipes) as typeof import('../../lib/presentations/studio/recipes');work.candidates=candidatesFor(work.content)
    const c=work.candidates.find(c=>c.id==='composition/side-facts-bottom')!
    work.candidates=[c];work.plan=draftOptions(work,run.library)[0].plan
    const before=await renderStudioSlide(run.library,work)
    work.content.id='slide-2';before.slideId='slide-2';before.html=before.html.replace('data-studio-slide="slide-1"','data-studio-slide="slide-2"')
    const after=await restyleStudioReceipt(run.library,work,before),again=await restyleStudioReceipt(run.library,work,after)
    const card=document.createElement('div');card.innerHTML=before.html;card.querySelector<HTMLElement>('[data-block]')!.style.backgroundColor='#FFFFFF'
    const opaque=await restyleStudioReceipt(run.library,work,{...before,html:card.innerHTML})
    const fresh=await renderStudioSlide(run.library,work)
    const measure=(html:string)=>{const host=document.createElement('div');host.style.position='relative';host.innerHTML=html;document.body.appendChild(host);const root=host.querySelector<HTMLElement>('[data-studio-slide]')!,a=root.getBoundingClientRect();const result=[...root.querySelectorAll<HTMLElement>('[data-field]')].map(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {text:el.textContent,x:b.x-a.x,y:b.y-a.y,w:b.width,h:b.height,size:s.fontSize,font:s.fontFamily}});host.remove();return result}
    const geometry={before:measure(before.html),after:measure(after.html)}
    run.results={'slide-2':after};run.status='complete'
    ;(window as unknown as {colorRun:typeof run}).colorRun=run
    return {before,after,again,fresh,geometry,opaque}
  },run)
  await writeFile(info.outputPath('accent-receipts.json'),JSON.stringify(result))
  expect(result.before.passed,result.before.issues.join('; ')).toBe(true)
  expect(result.after.brandAccents?.panel?.color).toBe('#FF3885')
  expect(result.after.brandAccents!.panel!.emptyRatio).toBeGreaterThanOrEqual(.7)
  expect(result.after.text.filter(t=>t.blockId===result.after.brandAccents!.panel!.blockId).every(t=>t.color==='#FFFFFF')).toBe(true)
  expect(result.after.colorZone).toBeUndefined()
  expect(result.after.brandAccents!.panel!.minContrast).toBeGreaterThanOrEqual(3)
  expect(result.fresh.brandAccents?.version).toBe(BRAND_ACCENTS_VERSION)
  expect(result.fresh.passed,result.fresh.issues.join('; ')).toBe(true)
  expect(result.after.text.map(({color,...t})=>{void color;return t})).toEqual(result.before.text.map(({color,...t})=>{void color;return t}))
  expect(result.geometry.after).toEqual(result.geometry.before)
  expect(result.again).toEqual(result.after)
  expect(result.opaque.brandAccents!.panel).toBeUndefined()
  expect(result.opaque.text.filter(t=>t.blockId===result.after.brandAccents!.panel!.blockId).every(t=>t.color!=='#FFFFFF')).toBe(true)
  expect(result.after.html.match(/data-studio-accent-panel=/g)).toHaveLength(1)
  await writeFile(info.outputPath('colored-slide.png'),Buffer.from(result.after.preview.split(',')[1],'base64'))
  const downloaded=page.waitForEvent('download')
  await page.evaluate(async()=>{const path='/browser/studio-export.ts';await (await import(path)).downloadStudioDeck((window as unknown as {colorRun:unknown}).colorRun)})
  const download=await downloaded;const zip=await JSZip.loadAsync(await readFile((await download.path())!))
  expect(await zip.file('presentation.html')!.async('string')).toContain(`data-studio-accent-panel="${BRAND_ACCENTS_VERSION}"`)
  expect(JSON.parse(await zip.file('source.json')!.async('string')).results[0].brandAccents).toEqual(result.after.brandAccents)
  expect(await zip.file('previews/1.png')!.async('base64')).toBe(result.after.preview.split(',')[1])
})

test('dense tables and charts stay on white with unchanged cells, series and data',async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const run=studioFixture('fast','# Данные сезона')
  run.library.tokens.colors=['#FFFFFF','#000000','#0077FF','#FF3885'].map(hex=>({hex,occurrences:1}))
  const results=await page.evaluate(async(run)=>{
    const paths={render:'/browser/studio-generation.ts',colors:'/browser/studio-color-zones.ts',recipes:'/lib/presentations/studio/recipes.ts',plan:'/lib/presentations/studio/bindings.ts'}
    const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{restyleStudioReceipt}=await import(paths.colors) as typeof import('../../browser/studio-color-zones'),{candidatesFor}=await import(paths.recipes) as typeof import('../../lib/presentations/studio/recipes'),{fastPlan}=await import(paths.plan) as typeof import('../../lib/presentations/studio/bindings')
    const reports=[]
    for(const kind of ['table','chart'] as const){
      const work=structuredClone(run.slides[0]),data=kind==='table'?{columns:['Регион','Рост'],rows:[['Алтай','48%'],['Карелия','37%']]}:{categories:['Алтай','Карелия'],series:[{name:'Рост',values:[48,37]}]}
      const template={id:'data-test',kind,name:'Данные',description:'',tags:[],slide:1,sourceIds:['source'],memberIds:[],width:1000,height:500,data,style:{font:'Play',fontSize:28,color:'#000000',headerFill:'#0077FF',headerColor:'#FFFFFF'},config:{chartType:'bar' as const},graphicHtml:{},dataStatus:'native' as const}
      work.content.blocks.push({id:'b2',kind:'visual',role:'body',source:JSON.stringify(data),fields:{},data:{template,values:data}})
      work.candidates=candidatesFor(work.content);work.plan=fastPlan(work,0)
      const before=await renderStudioSlide(run.library,work)
      work.content.id='slide-2';before.slideId='slide-2';before.html=before.html.replace('data-studio-slide="slide-1"','data-studio-slide="slide-2"')
      const after=await restyleStudioReceipt(run.library,work,before)
      const content=(html:string)=>{const host=document.createElement('div');host.innerHTML=html;return host.querySelector('[data-block="b2"]')!.innerHTML}
      reports.push({passed:before.passed,issues:before.issues,accents:after.brandAccents,before:content(before.html),after:content(after.html),dataBefore:before.dataValues,dataAfter:after.dataValues})
    }
    return reports
  },run)
  for(const r of results){expect(r.passed,r.issues.join('; ')).toBe(true);expect(r.accents).toBeTruthy();expect(r.accents!.panel).toBeUndefined();expect(r.after).toBe(r.before);expect(r.dataAfter).toEqual(r.dataBefore)}
})
