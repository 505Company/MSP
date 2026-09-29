import {test,expect} from '@playwright/test'
import {build} from 'esbuild'
import {nativeLayoutFixture,sourceText} from '../fixtures/native-layout'
import {compileEditableProposal} from '../../lib/design-system/editable-source'
import type {EditableCatalog,EditableTemplate} from '../../lib/design-system/editable-contract'
import {EDITABLE_COMPILER_VERSION,EDITABLE_VERSION} from '../../lib/design-system/editable-contract'
type Probe=typeof import('../../lib/design-system/editable-qualification')&typeof import('../../lib/design-system/editable-render')&typeof import('../../lib/design-system/editable-hydrate')
const catalog=(templates:EditableTemplate[]):EditableCatalog=>({id:'a'.repeat(64),catalogId:'b'.repeat(64),sourceRevision:'test',version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,createdAt:'',families:templates.map(t=>({id:t.id,name:t.name,description:t.description,tags:t.tags,kind:t.kind,variants:[t],sourceIds:t.sourceIds,slides:[1]})),coverage:[],excluded:[],modelRunIds:[],liveRequests:0})
let bundle:string
test.beforeAll(async()=>{bundle=(await build({stdin:{contents:"export {qualifyEditableCatalog} from './lib/design-system/editable-qualification';export {renderEditableHtml} from './lib/design-system/editable-render';export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Probe',write:false})).outputFiles[0].text})

test('source card fields remain visible and changing text fits the actual glyph bounds',async({page})=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements[0].properties.bounds={x:0,y:0,width:300,height:320}
 snapshot.elements.push(sourceText('number','09',15,100,250,80,70),sourceText('body','Описание показателя',15,210,265,90,20))
 const t=compileEditableProposal({...proposal,kind:'feature',style:{font:'Arial'},data:{title:'09',text:'Текст',value:'Описание показателя'},sourceIds:snapshot.elements.map(e=>e.id)},1,snapshot,'fixture',[])
 await page.goto('/');await page.setContent('<main id="preview" style="width:600px"></main>');await page.addScriptTag({content:bundle})
 const report=await page.evaluate(async t=>{
  const api=(window as unknown as {Probe:Probe}).Probe,host=document.getElementById('preview')!
  host.innerHTML=api.renderEditableHtml(t,{...t.data,text:'Совсем другой заголовок',value:'Подробное пояснение нового показателя с изменёнными данными.'});await api.hydrateEditableHtml(host)
  return {lost:host.textContent,overflow:host.querySelectorAll('[data-native-overflow="true"]').length,shapes:host.querySelectorAll('[data-source-object]').length}
 },t)
 expect(report.lost).toContain('Совсем другой заголовок');expect(report.lost).toContain('Подробное пояснение');expect(report.overflow).toBe(0);expect(report.shapes).toBeGreaterThan(0)
})

test('numeric glyph recovery rejects an opaque illustration and blocks its parent composition',async({page})=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements[0].properties.bounds={x:0,y:0,width:300,height:180}
 snapshot.elements[1]=sourceText('caption','Подпись',10,120,280,45,20)
 snapshot.elements.push({id:'digits',slide:1,name:'Source image',kind:'raster',properties:{bounds:{x:50,y:20,width:170,height:70},assetId:'digits',reason:'source-image',visible:true,opacity:1,rotation:0,zIndex:3}})
 const t=compileEditableProposal({...proposal,kind:'metric',style:{font:'Arial',color:'#0077FF'},data:{value:'80',unit:'%'},sourceIds:snapshot.elements.map(e=>e.id)},1,snapshot,'fixture',[])
 expect(t.sourceLayout?.text.some(s=>s.recoveredAsset)).toBe(true)
 await page.goto('/');await page.setContent('<main></main>');await page.addScriptTag({content:bundle})
 const images=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=340;c.height=140;const ctx=c.getContext('2d')!;ctx.fillStyle='#765EFF';ctx.font='bold 120px Arial';ctx.fillText('80%',12,118);const glyph=c.toDataURL();ctx.fillRect(0,0,c.width,c.height);return {glyph,opaque:c.toDataURL()}
 })
 let current=images.glyph
 await page.route('**/assets/digits',route=>route.fulfill({contentType:'image/png',body:Buffer.from(current.split(',')[1],'base64')}))
 const run=(c:EditableCatalog)=>page.evaluate(c=>(window as unknown as {Probe:Probe}).Probe.qualifyEditableCatalog(c),c)
 expect((await run(catalog([t]))).checks[0].passed).toBe(true)
 current=images.opaque
 const bad=structuredClone(t);bad.id='opaque';bad.sourceLayout!.text.find(s=>s.recoveredAsset)!.recoveredAsset+='?opaque=1'
 await page.route('**/assets/digits?opaque=1',route=>route.fulfill({contentType:'image/png',body:Buffer.from(images.opaque.split(',')[1],'base64')}))
 const composition={...bad,id:'group',kind:'composition' as const,sourceLayout:undefined,data:{},children:[t,bad],config:{columns:2}}
 const report=await run(catalog([t,bad,composition]))
 expect(report.checks.find(c=>c.id==='opaque')?.passed).toBe(false)
 expect(report.checks.find(c=>c.id==='group')?.passed).toBe(false)
 expect(report.checks.find(c=>c.id==='group')?.issues.join(' ')).toContain('вложенных')
 const outer={...composition,id:'outer',children:[composition]}
 const nested=await run(catalog([outer]))
 expect(nested.checks.map(c=>c.id)).toEqual(['outer'])
 expect(nested.checks[0].passed).toBe(false)
 expect(nested.checks[0].issues.join(' ')).toContain('вложенных')
})
