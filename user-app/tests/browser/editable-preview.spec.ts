import {test,expect} from './workspace-fixture'
import {nativePptx} from '../fixtures/native-pptx'
import {nativeLayoutFixture,sourceText} from '../fixtures/native-layout'
import {compileEditableProposal} from '../../lib/design-system/editable-source'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION,type EditableCatalog} from '../../lib/design-system/editable-contract'
import {HTML_QUALIFICATION_VERSION} from '../../lib/design-system/editable-qualification'

const templates=(['metric','radial'] as const).map(kind=>{
 const {snapshot,proposal}=nativeLayoutFixture(kind)
 if(kind==='radial'){
  const title='Заголовок + четыре преимущества';proposal.data.title=title
  snapshot.elements=snapshot.elements.map(e=>e.id==='title'?sourceText('title',title,290,150,220,200,36,'Play',{type:'solid',color:{r:0,g:.467,b:1,a:1}}):e)
 }
 return compileEditableProposal({...proposal,id:kind,name:kind==='metric'?'Показатель':'Радиальная схема'},1,snapshot,'fixture',[])
})
const catalog:EditableCatalog={version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,id:'a'.repeat(64),catalogId:'a'.repeat(64),sourceRevision:'fixture',createdAt:'',coverage:[],excluded:[],modelRunIds:[],liveRequests:0,
 families:templates.map(t=>({id:t.id,name:t.name,description:t.description,tags:t.tags,kind:t.kind,variants:[t],sourceIds:t.sourceIds,slides:[1]})),
 qualification:{version:HTML_QUALIFICATION_VERSION,catalogId:'a'.repeat(64),checks:templates.map(t=>({id:t.id,passed:true,source:true,changed:true,issues:[]}))}}

test('catalog thumbnails retain native typography after search, opening details and refresh',async({page,request},info)=>{
 expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
 const currentCatalog=structuredClone(catalog)
 await page.route('**/api/uploads/*/editable-system',route=>route.fulfill({json:{revision:'fixture',total:1,completed:1,jobs:[],catalog:currentCatalog,native:[],error:null,running:false}}))
 await page.goto('/styles');await page.waitForLoadState('networkidle')
 await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({name:'Проверка превью.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from(await nativePptx())})
 const metric=page.getByRole('link',{name:'Открыть конструкцию «Показатель»',exact:true})
 const radial=page.getByRole('link',{name:'Открыть конструкцию «Радиальная схема»',exact:true})
 await expect(metric).toBeVisible({timeout:60000})
 const checkMetric=async()=>{
  await expect(metric.locator('[data-native-overflow]')).toHaveCount(2,{timeout:5000})
  await expect(metric.locator('[data-source-text="value"] text').first()).toHaveAttribute('fill','#0077ff')
  const sizes=await metric.locator('[data-source-text="value"] text').evaluateAll(nodes=>nodes.map(n=>(n as SVGElement).style.font))
  expect(sizes.some(f=>f.includes('319px'))).toBe(true);expect(sizes.some(f=>f.includes('184px'))).toBe(true)
 }
 await checkMetric()
 const original=await metric.locator('[data-source-text="value"]').innerHTML()
 await page.getByRole('searchbox',{name:'Поиск конструкции'}).fill('Показатель')
 await expect(radial).toHaveCount(0);await checkMetric()
 await metric.click()
 await expect(page.locator('#preview').locator('[data-native-overflow]')).toHaveCount(2)
 expect(await page.locator('#preview').locator('[data-source-text="value"]').innerHTML()).toBe(original)
 await page.getByRole('link',{name:'← К компонентам',exact:true}).click();await checkMetric()
 await page.getByRole('searchbox',{name:'Поиск конструкции'}).fill('')
 await expect(radial.locator('[data-native-overflow]')).toHaveCount(5)
 await expect(radial.locator('[data-source-text="title"] text').first()).toHaveAttribute('fill','#0077ff')
 expect(await radial.locator('[data-source-text="title"] text').evaluateAll(nodes=>new Set(nodes.map(n=>n.getAttribute('y'))).size)).toBeGreaterThan(1)
 const radialTitle=await radial.locator('[data-source-text="title"]').innerHTML()
 await radial.click()
 await expect(page.locator('#preview [data-source-text=title]')).toBeVisible()
 expect(await page.locator('#preview').locator('[data-source-text="title"]').innerHTML()).toBe(radialTitle)
 await page.getByRole('link',{name:'← К компонентам',exact:true}).click()
 const refresh=()=>Promise.all([page.waitForResponse('**/api/uploads/*/editable-system'),page.evaluate(()=>window.dispatchEvent(new Event('design-system:ready')))])
 await refresh()
 await expect(radial.locator('[data-native-overflow]')).toHaveCount(5);await checkMetric()
 await metric.screenshot({path:info.outputPath('metric-card.png')})
 // A cold, delayed font load must not expose draft text or publish stale data.
 let releaseFonts!:()=>void
 const fontsReady=new Promise<void>(resolve=>{releaseFonts=resolve})
 await page.route('**/fonts/play/*.ttf',async route=>{await fontsReady;await route.continue()})
 try{
  await page.reload()
  await expect(metric.locator('[aria-busy="true"]')).toBeVisible()
  await expect(metric.locator('[data-native-text]')).toHaveCount(0)
  currentCatalog.families.find(f=>f.kind==='metric')!.variants[0].data.value='73'
  await refresh()
  await page.getByRole('searchbox',{name:'Поиск конструкции'}).fill('Показатель')
 }finally{releaseFonts()}
 await checkMetric();await expect(metric.locator('[data-source-text="value"]')).toHaveText('73%')
 await page.setViewportSize({width:390,height:900})
 await checkMetric()
 const fits=await metric.locator('.ed-thumbnail').evaluate(frame=>{
  const bounds=frame.getBoundingClientRect(),content=frame.querySelector('section')!.getBoundingClientRect()
  return content.left>=bounds.left&&content.right<=bounds.right&&content.top>=bounds.top&&content.bottom<=bounds.bottom
 })
 expect(fits).toBe(true)
})
