import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { studioFixture } from '../fixtures/studio'
import { memoryBucket } from '../helpers/memory-bucket'
import { compactPackets } from '../../lib/presentations/studio/compact-content'
import { commitStudioFallback,hydrateFallbackSources } from '../../lib/presentations/studio/fallback-storage'
import { studioKey, readStudioRun } from '../../lib/presentations/studio/storage'
import { generationPreview, generationSummary } from '../../lib/presentations/studio/generations'
import type { PresentationProject } from '../../lib/workspace/types'
import type { EditableTemplate } from '../../lib/design-system/editable-contract'
import { FALLBACK_VERSION } from '../../lib/presentations/studio/fallback-content'

test('legacy ready slides recover the entire frozen brief, table and metrics, including earlier simple fallback previews',async({page},info)=>{
  const text='Слайд 1\nВнутренний туризм становится привычкой,\nа не разовой альтернативой\nПутешественники выбирают самостоятельные маршруты и открывают новые регионы.\nРОССИЯ / ТУРИЗМ / 2026\n\nСлайд 2\nАудитория путешественников растет\nЗа последние годы самостоятельное планирование стало основным сценарием.\nСегмент\tДоля аудитории\tПоездок в год\nКомандировочные\t31%\t7,2×\nПары\t24%\t4,1×\n67% пользователей рассматривают несколько направлений одновременно\n42 млн посещений сервиса в месяц'
  let run=studioFixture('fast',text);run.status='complete'
  for(const s of run.slides)run.results[s.content.id]={slideId:s.content.id,candidateId:s.candidates[0].id,passed:true,preview:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=',html:'<main>Old saved preview</main>',blockIds:s.content.blocks.map(b=>b.id),issues:[],warnings:[],components:[],text:[],elapsedMs:1}
  const original=JSON.stringify(run),{bucket}=memoryBucket(),key=studioKey(run.projectId,run.revision)
  await bucket.put(key.replace('/run.json','/before-readable-fallback.json'),original)
  // Reopen an earlier underspecified fallback, not just a failed fresh job.
  const cover=run.slides[0];cover.content={...cover.content,blocks:cover.content.blocks.slice(0,1)}
  cover.fallback={sourceSlideId:cover.content.id,sourceTitle:cover.content.title,page:1,version:2,source:structuredClone(cover.content)}
  const project:PresentationProject={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Туризм',text:'Текущая форма уже изменена; не использовать её для истории.',uploadId:run.library.uploadId,styleName:run.library.name,generationMode:'fast',compositionMode:'recipes',createdAt:run.createdAt,updatedAt:run.createdAt}
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(key,JSON.stringify(run))
  const actions:string[]=[]
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.route('**/api/style-bank',r=>r.fulfill({json:{styles:[]}}))
  await page.route('**/api/projects/**',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(req.method()==='POST'){
      const body=req.postDataJSON();actions.push(body.action)
      if(body.action!=='fallback')return route.fulfill({status:409,json:{error:'No model calls'}})
      try{run=await commitStudioFallback(bucket,run.projectId,run.revision,body.slideId,body.receipt);return route.fulfill({json:{run}})}catch(e){return route.fulfill({status:409,json:{error:String(e)}})}
    }
    if(url.pathname.endsWith('/generations'))return route.fulfill({json:{generations:[generationSummary(run)]}})
    if(url.pathname.endsWith('/compose')){const view=await hydrateFallbackSources(bucket,structuredClone(run));return route.fulfill({json:{run:url.searchParams.get('preview')==='1'?generationPreview(view):view,configured:false}})}
    return route.fulfill({json:{project}})
  })
  await page.goto(`/projects/${project.id}`)
  await expect.poll(()=>run.slides.every(s=>s.fallback?.version===FALLBACK_VERSION),{timeout:90000}).toBe(true)
  expect(actions).toEqual(['fallback','fallback']);expect(run.slides).toHaveLength(2)
  expect(run.slides[0].content.blocks[0].fields.text).toBe('Внутренний туризм становится привычкой,\nа не разовой альтернативой')
  expect(run.slides[0].content.blocks.some(b=>b.source.includes('открывают новые регионы'))).toBe(true)
  expect(run.slides[1].content.blocks.find(b=>b.data)?.data?.values.rows).toEqual([['Командировочные','31%','7,2×'],['Пары','24%','4,1×']])
  expect(run.slides[1].content.blocks.filter(b=>b.kind==='metric').map(b=>b.fields.value)).toEqual(['67%','42 млн'])
  expect(run.results['slide-2'].html).toContain('data-studio-chrome="title"');expect(run.results['slide-2'].html).toContain('data-studio-chrome="page"')
  for(const [i,r]of Object.values(run.results).entries()){expect(r.passed).toBe(true);expect(r.candidateId).not.toBe('fallback/readable');await writeFile(info.outputPath(`restored-${i+1}.png`),Buffer.from(r.preview.split(',')[1],'base64'))}
  expect(await(await bucket.get(key.replace('/run.json','/before-readable-fallback.json')))!.text()).toBe(original)
  await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(2);await expect(page.locator('[data-generation-busy=true]')).toHaveCount(0);expect(actions).toHaveLength(2)
})

test('failed slides become readable continuations, keep native data, survive reload and never call the model', async ({ page }, info) => {
  test.setTimeout(180000)
  const { bucket } = memoryBucket(), text = '# Путешествие начинается с выбора\n\n' + 'Понятные маршруты сохраняют время путешественника. '.repeat(120)
  let run = studioFixture('smart', text); run.status = 'blocked'; run.slides[0].error = 'Доступные композиции не вместили слайд.'
  run.semantic = { source: text, status: 'pending', strategy: 'components', units: compactPackets(text).map(packet => ({ id: packet.id, packet, status: 'failed', attempts: 2, error: 'missing-fragments' })) }
  const table: EditableTemplate = { id: 'source-table', kind: 'table', name: 'Факты', description: '', tags: [], sourceIds: [], memberIds: [], slide: 1, width: 1700, height: 700, style: { font: 'Play', fontSize: 28 }, config: {}, graphicHtml: {}, dataStatus: 'native', data: { columns: ['Регион', 'Рост'], rows: Array.from({ length: 20 }, (_, i) => [`Регион ${i + 1}`, `${i + 1}%`]) } }
  const chart: EditableTemplate = { ...table, id: 'source-chart', kind: 'chart', name: 'Динамика', config: { chartType: 'line', legend: true }, data: { categories: ['Январь', 'Февраль', 'Март'], series: [{ name: 'Спрос', values: [23, 48, 37] }] } }
  for (const [i, template] of [table, chart].entries()) run.slides[0].content.blocks.push({ id: `data-${i}`, kind: 'visual', role: 'body', fields: {}, source: JSON.stringify(template.data), data: { template, values: template.data } })
  const original = JSON.stringify(run), project: PresentationProject = { schemaVersion: 1, id: run.projectId, revision: run.revision, name: 'Резервная вёрстка', text, uploadId: run.library.uploadId, styleName: run.library.name, generationMode: 'smart', compositionMode: 'components', createdAt: run.createdAt, updatedAt: run.createdAt }
  await bucket.put(`workspace/projects/${project.id}.json`, JSON.stringify(project)); await bucket.put(studioKey(run.projectId, run.revision), original)
  const actions: string[] = []
  await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
  await page.route('**/api/fonts/google?*', r => r.fulfill({ status: 404, json: { files: [] } }))
  await page.route('**/api/style-bank', r => r.fulfill({ json: { styles: [] } }))
  await page.route('**/api/projects/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); actions.push(body.action)
      if (body.action !== 'fallback') return route.fulfill({ status: 409, json: { error: 'Model must not run' } })
      try { run = await commitStudioFallback(bucket, project.id, project.revision, body.slideId, body.receipt); return route.fulfill({ json: { run } }) }
      catch (error) { return route.fulfill({ status: 409, json: { error: String(error) } }) }
    }
    if (url.pathname.endsWith('/generations')) return route.fulfill({ json: { generations: [generationSummary(run)] } })
    if (url.pathname.endsWith('/compose')) return route.fulfill({ json: { run: url.searchParams.get('preview') === '1' ? generationPreview(run) : run, configured: false } })
    return route.fulfill({ json: { project } })
  })
  await page.goto(`/projects/${project.id}`)
  await expect.poll(() => run.status, { timeout: 90000 }).toBe('complete')
  expect(run.slides.length).toBeGreaterThan(3)
  expect(actions).toEqual(['fallback'])
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(run.slides.length)
  await expect(page.locator('.ws-slide-placeholder')).toHaveCount(0)
  await expect(page.getByText(/Варианты оформления|Исходники презентации|Выбрать для экспорта/)).toHaveCount(0)
  const snapshots = Object.values(run.results)
  expect(snapshots.every(r => r.passed && r.text.every(t => t.size >= 28 && t.x >= 48 && t.y + t.height <= 1032))).toBe(true)
  const tableRows = run.slides.flatMap(s => s.content.blocks.flatMap(b => b.data?.template.kind === 'table' ? b.data.values.rows ?? [] : []))
  expect(tableRows).toEqual(table.data.rows)
  expect(run.slides.flatMap(s => s.content.blocks).find(b => b.data?.template.kind === 'chart')?.data?.values).toEqual(chart.data)
  expect(run.semantic?.units?.[0].fallback).toBe(true); expect(run.modelRequests).toBe(0)
  expect(await (await bucket.get(studioKey(project.id, project.revision).replace('/run.json', '/before-readable-fallback.json')))!.text()).toBe(original)
  for (const [i, receipt] of snapshots.entries()) await writeFile(info.outputPath(`fallback-${i + 1}.png`), Buffer.from(receipt.preview.split(',')[1], 'base64'))
  const unchanged = JSON.stringify(run)
  const again = await commitStudioFallback(bucket, project.id, project.revision, 'slide-1', { basis: 'stale', fontCSS: '', pages: [{ pieces: [{ item: 'x', start: 0, end: 1, render: 'text' }], receipt: snapshots[0] }] })
  expect(JSON.stringify(again)).toBe(unchanged)
  await page.reload(); await expect(page.locator('.ws-slide-canvas img')).toHaveCount(run.slides.length)
  expect(actions).toEqual(['fallback']); expect((await readStudioRun(bucket, project.id, project.revision))!.status).toBe('complete')
  await page.screenshot({ path: info.outputPath('fallback-gallery.png'), fullPage: true })
})
