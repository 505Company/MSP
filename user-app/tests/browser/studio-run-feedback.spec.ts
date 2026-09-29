import {test,expect} from './workspace-fixture'
import {studioFixture} from '../fixtures/studio'
import {compactPackets} from '../../lib/presentations/studio/compact-content'

test('opening an outdated partial run preserves slide numbers and asks for regeneration without writes',async({page},info)=>{
  const run=studioFixture('smart'),source='# Первый\nТекст.\n---\n# Второй\nИмя\tЗначение\nА\t42\n---\n# Третий\nТекст.'
  const packets=compactPackets(source),sample=run.slides[0],preview='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='
  run.status='blocked'
  run.semantic={source,status:'pending',units:packets.map((packet,i)=>({id:packet.id,packet:{...packet,tables:[]},status:i===1?'failed':'complete',attempts:2,...i===1?{error:'[{"validation":"regex","code":"invalid_string"}]'}:{}}))}
  run.slides=[0,2].map(i=>({...sample,content:{...sample.content,id:packets[i].id,title:packets[i].atoms[0].text}}))
  run.results=Object.fromEntries(run.slides.map(s=>[s.content.id,{slideId:s.content.id,candidateId:'fixture',blockIds:s.content.blocks.map(b=>b.id),components:[],text:[],passed:true,preview,html:'',issues:[],warnings:[],elapsedMs:1}]))
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Сохранённый результат',text:source,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart',compositionMode:'components'}
  let writes=0
  await page.route('**/api/**',r=>{
    if(r.request().method()!=='GET'){writes++;return r.abort()}
    const path=new URL(r.request().url()).pathname
    if(path.endsWith('/compose'))return r.fulfill({json:{run,configured:true}})
    if(path===`/api/projects/${project.id}`)return r.fulfill({json:{project}})
    if(path==='/api/style-bank')return r.fulfill({json:{styles:[]}})
    return r.fallback()
  })
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('status').filter({hasText:'Обновлён разбор границ слайдов'})).toBeVisible()
  await expect(page.locator('.ws-slide-card')).toHaveCount(3)
  await expect(page.locator('.ws-slide-number')).toHaveText(['01','02','03'])
  await expect(page.locator('.ws-slide-placeholder')).toHaveText('Модель вернула неверные ссылки на блоки. Слайд не собран.')
  await expect(page.getByRole('button',{name:'Продолжить создание'})).toHaveCount(0)
  await expect(page.getByText('Технические подробности ошибок')).toBeVisible()
  await expect(page.locator('.ws-generation-details').first()).not.toHaveAttribute('open')
  await page.getByRole('button',{name:'Открыть слайд 3: Третий',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Слайд 3. Третий')
  await page.getByRole('button',{name:'Закрыть просмотр слайда'}).click()
  await page.reload();await expect(page.locator('.ws-slide-card')).toHaveCount(3)
  await page.screenshot({path:info.outputPath('failed-slide-position.png'),fullPage:true})
  expect(writes).toBe(0)
})
