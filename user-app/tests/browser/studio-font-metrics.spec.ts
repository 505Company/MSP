import {test,expect} from '@playwright/test'

test('font ascent reserve does not reject fitting ink, while real overflow still fails',async({page})=>{
 await page.goto('/processing-worker')
 const result=await page.evaluate(async()=>{
  const font=new FontFace('Tall Metrics','url(/fonts/play/Play-Regular.ttf)',{ascentOverride:'110%',descentOverride:'35%'})
  await font.load();document.fonts.add(font)
  const path='/browser/studio-type-fit.ts',{textFitsBox,fitRecipeText}=await import(path) as typeof import('../../browser/studio-type-fit')
  const box=document.createElement('div');Object.assign(box.style,{position:'absolute',width:'900px',height:'100px',top:'300px'})
  const field=document.createElement('div');field.dataset.field='text';field.dataset.typeRole='body';field.textContent='Сегодня поездка начинается с выбора.'
  Object.assign(field.style,{fontFamily:'Tall Metrics',fontSize:'32px',lineHeight:'1.25',whiteSpace:'pre-wrap',overflowWrap:'normal'})
  box.appendChild(field);document.body.appendChild(box)
  const range=document.createRange();range.selectNodeContents(field)
  const fontReserveAbove=range.getBoundingClientRect().top<box.getBoundingClientRect().top-1
  const fits=textFitsBox(box)
  fitRecipeText(box,{id:'body',role:'body',kind:'text',fields:{text:field.textContent},source:field.textContent})
  const size=parseFloat(field.style.fontSize),grownFits=textFitsBox(box)
  box.style.height='16px';const verticalOverflow=!textFitsBox(box)
  box.style.height='100px';box.style.width='80px';field.style.whiteSpace='nowrap';const horizontalOverflow=!textFitsBox(box)
  box.remove();return {fontReserveAbove,fits,size,grownFits,verticalOverflow,horizontalOverflow}
 })
 expect(result.fontReserveAbove).toBe(true)
 expect(result.fits).toBe(true)
 expect(result.size).toBeGreaterThan(32)
 expect(result.grownFits).toBe(true)
 expect(result.verticalOverflow).toBe(true)
 expect(result.horizontalOverflow).toBe(true)
})
