import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { controlPptx } from '../fixtures/control-pptx'

test.use({trace:'off'})
test('PPTX above 128 MiB survives generic byte iteration and preserves the complete source',async({page,request},testInfo)=>{
  test.setTimeout(180000)
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const zip=await JSZip.loadAsync(await controlPptx())
  // Inert package data makes a genuinely large PPTX without inventing a huge image.
  zip.file('customXml/transport-fixture.bin',Buffer.alloc(129*1024*1024,41),{compression:'STORE'})
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'})
  const sourceHash=createHash('sha256').update(bytes).digest('hex')
  const path=testInfo.outputPath('large-control.pptx');await writeFile(path,bytes)
  await page.addInitScript(() => {
    // Preserve semantics but disable TypedArray.from's engine shortcut. The old
    // hasher expanded >128 MiB into a giant number array and crashed the tab.
    const original = Uint8Array.prototype[Symbol.iterator]
    Uint8Array.prototype[Symbol.iterator] = function* () { yield* original.call(this); return undefined }
  })
  const lengths:Array<Promise<number>>=[]
  page.on('request',r=>{if(r.url().includes('/api/uploads/binary')&&['PUT','POST'].includes(r.method()))lengths.push(r.allHeaders().then(h=>Number(h['content-length']??0)))})
  await page.goto('/styles')
  if(page.url().includes('signin-with-chatgpt'))await page.getByRole('button').filter({hasText:/войти|sign in|continue/i}).first().click()
  await expect(page.getByRole('heading',{name:'Банк стилей',exact:true})).toBeVisible();await page.waitForLoadState('networkidle')
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(path)
  await expect(page.locator('.pw-error').or(page.getByRole('link',{name:'Компоненты'})).first()).toBeVisible({timeout:150000})
  expect(await page.locator('.pw-error').allTextContents()).toEqual([])
  await expect(page.locator('.cw-list button').first()).toBeVisible()
  const sizes=await Promise.all(lengths)
  expect(sizes.length).toBeGreaterThan(14)
  expect(Math.max(...sizes)).toBeLessThanOrEqual(8*1024*1024)
  expect(sizes.reduce((a,b)=>a+b,0)).toBeGreaterThan(100*1024*1024)
  const id=new URL(page.url()).pathname.split('/').at(-1)!
  const source=await request.get(`/api/uploads/${id}/source`)
  expect(source.ok()).toBe(true)
  expect(createHash('sha256').update(await source.body()).digest('hex')).toBe(sourceHash)
  const result=await (await request.get(`/api/uploads/${id}/design-system`)).json()
  expect(result.upload.profileObjectKey).toBeNull()
  expect(result.draft.parserVersion).toBe('source-snapshot/1')
  expect(result.visual.snapshot.sourceId).toBe(sourceHash)
  expect((await (await request.get('/api/style-bank')).json()).styles.some((u:{id:string})=>u.id===id)).toBe(true)
  await page.reload();await expect(page.locator('.cw-list button').first()).toBeVisible()
  await testInfo.attach('transfer-metrics',{body:JSON.stringify({sourceBytes:bytes.length,sourceHash,requests:sizes.length,largestRequest:Math.max(...sizes),uploadId:id}),contentType:'application/json'})
})
