import {test,expect,openTestProject} from './workspace-fixture'
import {readFile} from 'node:fs/promises'
import JSZip from 'jszip'
import {nativePptx} from '../fixtures/native-pptx'

test('uploaded data automatically becomes a styled table; tables open their source in the component editor',async({page,request})=>{
 const requests:string[]=[];page.on('request',r=>{if(r.method()==='POST')requests.push(r.url())})
 await page.goto('/styles');await page.waitForLoadState('networkidle');await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({name:'Data style.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from(await nativePptx())})
 await expect(page.getByRole('link',{name:'Создать презентацию',exact:true})).toBeVisible({timeout:60000})
 const style=new URL(page.url()).pathname.split('/').at(-1)!
 await page.goto(`/styles/${style}?section=components`)
 await page.getByRole('link',{name:'Открыть конструкцию «Таблица»',exact:true}).click()
 await expect(page.locator('#status')).toHaveText('Образец компонента')
 await expect(page.locator('#save')).not.toBeVisible()
 await expect(page.getByRole('button',{name:'Добавить строку',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Скачать HTML',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Скачать PPTX',exact:true})).toHaveCount(0)
 await page.getByRole('link',{name:'← К компонентам',exact:true}).click()
 await page.getByRole('link',{name:'Создать презентацию',exact:true}).click()
 await expect(page.locator(`#presentation-style input[value="${style}"]`)).toBeChecked()
 await page.getByLabel('Файл содержания').setInputFiles({name:'Регионы.csv',mimeType:'text/csv',buffer:Buffer.from('Регион,Доля\nМосква,73%\nКазань,27%')})
 await expect(page.locator('#presentation-content')).toHaveValue(/Москва/)
 await page.getByRole('button',{name:'Сгенерировать слайды',exact:true}).click()
 await expect(page.getByRole('region',{name:'Генерация презентации'})).toContainText('Готово: 1 слайдов.',{timeout:30000})
 await expect(page.locator('.ws-slide-canvas img')).toHaveCount(1)
 const id=new URL(page.url()).pathname.split('/').at(-1)!
 const run=(await (await request.get(`/api/projects/${id}/compose`)).json()).run
 expect(run.mode).toBe('fast');expect(run.modelRequests).toBe(0)
 const html=Object.values(run.results).map(result=>(result as {html:string}).html).join('')
 for(const value of ['Москва','73%','Казань','27%'])expect(html).toContain(value)
 const downloaded=page.waitForEvent('download')
 await page.getByRole('button',{name:'Скачать HTML и исходники',exact:true}).click()
 const zip=await JSZip.loadAsync(await readFile((await (await downloaded).path())!))
 expect(await zip.file('presentation.html')!.async('string')).toContain('Москва')
 expect(await zip.file('data/1-table.json')!.async('string')).toContain('73%')
 const posts=requests.length
 await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(1)
 expect(requests.length).toBe(posts)
 // Projects saved before generationMode existed retain their inline table path.
 await openTestProject(page,request,style,false)
 await page.getByLabel('Файл содержания').setInputFiles({name:'Архив.csv',mimeType:'text/csv',buffer:Buffer.from('Регион,Доля\nМосква,73%\nКазань,27%')})
 await expect(page.getByRole('region',{name:'Презентация из данных'})).toContainText('Данные оформлены в стиле шаблона',{timeout:20000})
 const slide=page.locator('[data-component-kind="table"]')
 for(const value of ['Москва','73%','Казань'])await expect(slide).toContainText(value)
 expect(requests.some(url=>/\/(structure|recipes|deck)$/.test(url))).toBe(false)
 await page.reload();await expect(slide).toContainText('73%',{timeout:20000})
})
