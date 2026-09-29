import {test,expect} from '@playwright/test'
import {editableHtmlDocument} from '../../lib/design-system/editable-html'
import type {EditableTemplate} from '../../lib/design-system/editable-contract'
const t:EditableTemplate={id:'chart',name:'Доля',description:'Доля и остаток',kind:'chart',tags:['Данные'],slide:1,width:800,height:400,style:{font:'Arial'},config:{chartType:'donut'},data:{categories:['Доля','Остаток'],series:[{name:'Доля',values:[20,80]}],value:'20',unit:'%'},sourceIds:['s01-chart'],memberIds:[],dataStatus:'readable',graphicHtml:{}}
test('downloaded HTML redraws data offline, including nested compositions',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message))
 const template:EditableTemplate={...t,id:'composition',kind:'composition',config:{layout:'grid',columns:2},data:{},children:[t,{...t,id:'chart2'}]}
 await page.setContent(editableHtmlDocument(template,{children:[t.data,t.data]}))
 const before=await page.locator('#preview path[data-value]').first().getAttribute('d')
 await page.getByText('Изменить данные',{exact:true}).click()
 const data={children:[{...t.data,series:[{name:'Доля',values:[73,27]}]},t.data]}
 await page.locator('#data').fill(JSON.stringify(data));await page.getByRole('button',{name:'Применить',exact:true}).click()
 expect(await page.locator('#preview path[data-value]').first().getAttribute('d')).not.toBe(before)
 await expect(page.locator('#preview')).toContainText('73%');expect(failures).toEqual([])
 await expect(page.locator('#error')).toHaveText('')
})
