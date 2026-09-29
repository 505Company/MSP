import { test, expect } from './workspace-fixture'
import type { CatalogComponent } from '../../lib/design-system/catalog-types'
import { controlPptx } from '../fixtures/control-pptx'
import { flatten } from '../../lib/design-system/compiler'
import type { SavedLibrary, ComponentDefinition, RenderReport } from '../../lib/design-system/types'

test('fresh PPTX → automatic atoms and molecules → local preview → immutable source',async({page,request},testInfo)=>{
  const capabilities=await request.get('/api/capabilities/qwen')
  expect((await capabilities.json()).configured,'Browser acceptance must not use a paid model').toBe(false)
  await page.goto('/styles')
  // The portable app requires its normal local sign-in cookie.
  if(page.url().includes('signin-with-chatgpt'))await page.getByRole('button').filter({hasText:/войти|sign in|continue/i}).first().click()
  await expect(page.getByRole('heading',{name:'Банк стилей',exact:true})).toBeVisible()
  await page.waitForLoadState('networkidle')
  // A tab opened before this update may still contain the legacy base64 reader.
  await page.evaluate(()=>Object.assign(window,{MspPptxReader:{preparePresentation(){throw new Error('Stale reader was reused')}}}))
  const bytes=await controlPptx()
  await Promise.all([
    page.waitForRequest(r=>r.url().endsWith('/api/uploads/binary')&&r.method()==='POST',{timeout:25000}),
    page.locator('input[type=file][accept*=".pptx"]').setInputFiles({name:'Контроль MSP — группы и кадрирование.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:bytes})
  ])
  await expect(page.getByRole('link',{name:'Компоненты'})).toBeVisible({timeout:90000})
  await expect(page.locator('.cw-list button').first()).toBeVisible()
  const uploadId=new URL(page.url()).pathname.split('/').at(-1)!
  expect(uploadId).toMatch(/^[a-f0-9-]{36}$/)
  const libraryResponse=await request.post(`/api/uploads/${uploadId}/components`)
  expect(libraryResponse.ok()).toBe(true)
  const saved=await libraryResponse.json() as SavedLibrary
  const card=saved.library.components.find(c=>c.name==='Карточка решения')!
  expect(card,'The native PPTX group should become a component').toBeTruthy()
  expect(card.slots.map(s=>s.label)).toEqual(['Заголовок','Описание','Номер'])
  expect(card.fixedTextIds).toHaveLength(0)
  expect(card.scene.width).toBeCloseTo(640,1);expect(card.scene.height).toBeCloseTo(230,1)
  expect(saved.library.excluded).toEqual([])
  expect(saved.library.tokens.colors.some(c=>c.hex==='#DCEAE5')).toBe(true)
  expect(saved.library.components.some(c=>c.name==='Подпись мастера')).toBe(true)
  const photo=saved.library.components.find(c=>c.name==='Карточка с фото')!
  expect(photo.source.assetIds).toHaveLength(1)
  expect(photo.scene.width).toBeCloseTo(320,1);expect(photo.scene.height).toBeCloseTo(150,1)
  const raster=flatten(photo.scene.elements).find(e=>e.kind==='raster')!
  expect(raster).toBeTruthy()
  expect(flatten(photo.scene.elements).some(e=>e.sourceRef?.shapeId==='21')).toBe(true)
  const assetResponse=await request.get(`/api/uploads/${uploadId}/assets/${photo.source.assetIds[0]}`)
  expect(assetResponse.ok()).toBe(true)
  expect((await assetResponse.body()).byteLength).toBeGreaterThan(50)
  await page.locator('.cw-list button').filter({hasText:'Карточка решения'}).click()
  await expect(page.locator('.cw-ok')).toContainText('Исходный вид воспроизведён')
  await expect(page.getByRole('button',{name:/Принять после проверки|Сохранить кандидата|Отклонить/})).toHaveCount(0)
  await page.locator('.cw-detail').screenshot({path:testInfo.outputPath('component-original.png')})
  const initial=await (await request.get(`/api/uploads/${uploadId}/catalog/${card.id}`)).json() as CatalogComponent
  await expect(page.locator('.cw-detail textarea,.cw-text-test')).toHaveCount(0)
  const unchanged=await (await request.get(`/api/uploads/${uploadId}/catalog/${card.id}`)).json() as CatalogComponent
  expect(unchanged).toEqual(initial)
  expect('revision' in unchanged).toBe(false)
  for(const endpoint of [`/api/uploads/${uploadId}/catalog/${card.id}`,`/api/uploads/${uploadId}/components`]){
    const response=await request.patch(endpoint,{data:{status:'accepted',values:{}}})
    expect(response.status()).toBe(405)
  }
  await page.getByRole('button',{name:'Закрыть компонент'}).click()
  await page.locator('.cw-list button').filter({hasText:'Карточка с фото'}).click()
  await expect(page.locator('.cw-preview img')).toBeVisible()
  await page.locator('.cw-detail').screenshot({path:testInfo.outputPath('photo-component.png')})
  const pixels=await page.locator('.cw-preview img').evaluate((image:HTMLImageElement)=>{
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0)
    return [40,110].map(x=>[...ctx.getImageData(Math.round(x*canvas.width/320),Math.round(40*canvas.height/150),1,1).data].slice(0,3))
  })
  expect(pixels).toEqual([[255,200,87],[35,128,210]])
  const missingFont=structuredClone(card)
  for(const e of flatten(missingFont.scene.elements))if(e.kind==='text'){e.fontFamily='MSP missing font 82910';e.styleRuns?.forEach(r=>r.fontFamily=e.fontFamily)}
  const fontReport=await page.evaluate(async(component:ComponentDefinition)=>{
    const reader=(window as unknown as {MspPptxReader:{renderComponent(c:ComponentDefinition,v:Record<string,string>,assets:[]):Promise<RenderReport>}}).MspPptxReader
    return reader.renderComponent(component,{},[])
  },missingFont)
  expect(fontReport.fits).toBe(false);expect(fontReport.issues.some(i=>i.code==='font-unavailable')).toBe(true)
  const nowrap=structuredClone(card)
  for(const e of flatten(nowrap.scene.elements))if(e.kind==='text')e.textBox={align:'LEFT',vertical:'TOP',wrap:false}
  const nowrapReport=await page.evaluate(async({component,slot})=>{
    const reader=(window as unknown as {MspPptxReader:{renderComponent(c:ComponentDefinition,v:Record<string,string>,assets:[]):Promise<RenderReport>}}).MspPptxReader
    return reader.renderComponent(component,{[slot]:'Длинная строка без переносов '.repeat(20)},[])
  },{component:nowrap,slot:card.slots[0].id})
  expect(nowrapReport.issues.some(i=>i.code==='text-overflow')).toBe(true)
  expect(nowrapReport.dataUrl).toBe('')
  await page.getByRole('button',{name:'Закрыть компонент'}).click()
  await page.locator('.cw-list button').filter({hasText:'Карточка решения'}).click()
  await expect(page.locator('.cw-preview img')).toBeVisible()
  await page.reload()
  await page.locator('.cw-list button').filter({hasText:'Карточка решения'}).click()
  await expect(page.locator('.cw-preview img')).toBeVisible()
  await testInfo.attach('automatic-component',{body:JSON.stringify(unchanged,null,2),contentType:'application/json'})
})
