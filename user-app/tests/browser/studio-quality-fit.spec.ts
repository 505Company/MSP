import {test,expect} from '@playwright/test'
import {strictComponentFixture} from '../fixtures/studio-components'
import {studioFixture} from '../fixtures/studio'
import {sourceStyleFixture} from '../fixtures/studio-source-style'

test('option search adapts the best numeric recipe before accepting a weaker unscaled layout',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const result=await page.evaluate(async library=>{
  const render='/browser/studio-generation.ts',recipes='/lib/presentations/studio/recipes.ts'
  const block=(id:string,kind:'text'|'feature'|'metric',role:'title'|'body',fields:Record<string,string>)=>({id,kind,role,fields,source:Object.values(fields).join('\n')})
  const content={id:'numeric',title:'5,8 источника',directions:[],blocks:[block('title','text','title',{text:'5,8 источника'}),block('caption','text','body',{text:'в среднем изучают перед принятием решения'}),block('a','feature','body',{heading:'3 направления',body:'попадают в окончательное сравнение'}),block('b','metric','body',{value:'12 дней',caption:'проходит от первого интереса до бронирования'}),block('c','metric','body',{value:'41%',caption:'возвращаются к ранее просмотренным вариантам несколько раз'})]}
  const candidates=(await import(recipes)).candidatesFor(content)
  const options=await(await import(render)).renderStudioOptions(library,{content,candidates,bindings:{}},undefined,{limit:1})
  return options.map((o:{plan:{candidateId:string};receipt?:{quality?:{score:number};passed:boolean}})=>({recipe:o.plan.candidateId,passed:o.receipt?.passed,score:o.receipt?.quality?.score}))
 },studioFixture().library)
 expect(result).toHaveLength(1);expect(result[0].passed).toBe(true);expect(result[0].recipe).toMatch(/^composition\/number-story/);expect(result[0].score).toBeGreaterThanOrEqual(90)
})

test('a multiline list retains all seven rows at readable size beside a paragraph',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const r=await page.evaluate(async library=>{
  const render='/browser/studio-generation.ts',recipes='/lib/presentations/studio/structured-compositions.ts',options='/lib/presentations/studio/options.ts'
  const block=(id:string,role:'title'|'body'|'footer',text:string)=>({id,role,kind:'text' as const,source:text,fields:{text}})
  const value='Поиск направления\nПланирование\nБронирование\nДорога\nПроживание\nАктивности\nВозвращение'
  const content={id:'list',title:'Пользователь оценивает весь путь целиком',directions:[],blocks:[block('title','title','Пользователь оценивает весь путь целиком'),block('intro','body','На впечатление от путешествия влияет не только отель или транспорт. Даже сильные отдельные элементы могут потеряться, если между ними возникают разрывы.'),block('items','body',value),block('footer','footer','Один неудобный этап может повлиять на оценку всей поездки.')]}
  const candidates=(await import(recipes)).structuredCompositions(content).filter((c:{id:string})=>c.id==='composition/list-rail'),work={content,candidates,bindings:{}}
  const receipt=await(await import(render)).renderStudioSlide(library,{...work,plan:(await import(options)).draftOptions(work,library)[0].plan},undefined,{fontFit:true})
  return {passed:receipt.passed,issues:receipt.issues,rows:receipt.text.filter((t:{blockId:string})=>t.blockId==='items'),value}
 },studioFixture().library)
 expect(r.passed,r.issues.join('; ')).toBe(true);expect(r.rows).toHaveLength(7);expect(r.rows.map((t:{value:string})=>t.value).join('')).toBe(r.value)
 for(const row of r.rows)expect(row.size).toBeGreaterThanOrEqual(40)
})

test('a fact recipe renders separate accented values and divider lines without losing original text',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const library=sourceStyleFixture();delete library.backgrounds
 const r=await page.evaluate(async library=>{
  const paths={render:'/browser/studio-generation.ts',recipe:'/lib/presentations/studio/compositions.ts',options:'/lib/presentations/studio/options.ts'}
  const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{compositionsFor}=await import(paths.recipe) as typeof import('../../lib/presentations/studio/compositions'),{draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
  const block=(id:string,role:'title'|'body',text:string)=>({id,role,kind:'text' as const,source:text,fields:{text}})
  const value='Цена — 82%\nУдобство маршрута — 71%\nКачество проживания — 64%\nОтзывы — 58%\nИнтересные места и события — 46%\nРекомендации друзей — 29%'
  const content={id:'slide-6',title:'Что влияет на выбор направления',directions:[],blocks:[block('b1','title','Что влияет на выбор направления'),block('b2','body',value),block('b3','body','Цена остаётся главным фактором, но сама по себе уже редко определяет финальное решение.')]}
  const candidates=compositionsFor(content).filter(c=>c.id==='composition/fact-grid'),work={content,candidates,bindings:{}}
  const receipt=await renderStudioSlide(library,{...work,plan:draftOptions(work,library)[0].plan})
  const host=document.createElement('div');host.innerHTML=receipt.html;document.body.appendChild(host)
  const values=[...host.querySelectorAll<HTMLElement>('[data-type-role="grid-value"]')],labels=[...host.querySelectorAll<HTMLElement>('[data-type-role="grid-label"]')]
  const result={passed:receipt.passed,issues:receipt.issues,original:receipt.text.filter(t=>t.blockId==='b2').map(t=>t.value).join(''),expected:value,values:values.map(el=>({size:parseFloat(getComputedStyle(el).fontSize),color:getComputedStyle(el).color})),labels:labels.map(el=>({size:parseFloat(getComputedStyle(el).fontSize),color:getComputedStyle(el).color})),rules:values.filter(el=>parseFloat(getComputedStyle(el.parentElement!).borderBottomWidth)>=2).length}
  host.remove();return result
 },library)
 expect(r.passed,r.issues.join('; ')).toBe(true);expect(r.original).toBe(r.expected);expect(r.rules).toBe(6)
 expect(r.values).toHaveLength(6)
 r.values.forEach((v,i)=>{expect(v.size).toBeGreaterThan(r.labels[i].size);expect(v.color).not.toBe(r.labels[i].color);expect(r.labels[i].size).toBeGreaterThanOrEqual(40)})
})

test('native SVG titles shrink before a whole word breaks across lines',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const result=await page.evaluate(async library=>{
  const paths={render:'/browser/studio-generation.ts',fit:'/browser/studio-type-fit.ts'}
  const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{nativeWordsFit}=await import(paths.fit) as typeof import('../../browser/studio-type-fit')
  const value='Один пользователь — несколько сценариев',content={id:'slide-4',title:value,directions:[],blocks:[{id:'b1',kind:'text' as const,role:'title' as const,source:value,fields:{text:value}}]}
  const candidate={id:'narrow-title',recipeId:'narrow-title',label:'Narrow title',score:1,slots:[{region:'title',blocks:['b1'],direction:'column' as const,columns:1,gap:0,rect:{x:48,y:48,w:444,h:480}}]}
  const receipt=await renderStudioSlide(library,{content,candidates:[candidate],bindings:{b1:[{id:'native-title',kind:'editable',fields:{title:'text'}}]},plan:{candidateId:candidate.id,components:{b1:'native-title'},primary:[],rationale:''},strictComponents:true})
  const root=document.createElement('div');root.innerHTML=receipt.html;document.body.appendChild(root)
  const whole=nativeWordsFit(root);root.remove()
  const probe=document.createElement('div');probe.innerHTML='<svg data-native-source="{}"><text x="0" y="40">сло</text><text x="0" y="90">во</text></svg>';document.body.appendChild(probe);const detectsBroken=!nativeWordsFit(probe);probe.querySelector('svg')!.setAttribute('data-native-source',JSON.stringify({text:'сло\nво'}));const allowsExplicitBreak=nativeWordsFit(probe);probe.remove()
  return {passed:receipt.passed,issues:receipt.issues,whole,detectsBroken,allowsExplicitBreak,size:receipt.text[0]?.size,value:receipt.text[0]?.value}
 },strictComponentFixture().library)
 expect(result.passed,result.issues.join('; ')).toBe(true);expect(result.whole).toBe(true);expect(result.detectsBroken).toBe(true);expect(result.allowsExplicitBreak).toBe(true);expect(result.size).toBeLessThan(88);expect(result.size).toBeGreaterThanOrEqual(40);expect(result.value).toBe('Один пользователь — несколько сценариев')
})

test('short metric and its unit stay on one line with a readable explanation',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const r=await page.evaluate(async library=>{
  const paths={render:'/browser/studio-generation.ts',recipe:'/lib/presentations/studio/compositions.ts',options:'/lib/presentations/studio/options.ts'}
  const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{compositionsFor}=await import(paths.recipe) as typeof import('../../lib/presentations/studio/compositions'),{draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
  const block=(id:string,role:'title'|'body',text:string)=>({id,role,kind:'text' as const,source:text,fields:{text}})
  const content={id:'slide-8',title:'Время выбора',directions:[],blocks:[block('b1','title','Время выбора'),{id:'b2',role:'body' as const,kind:'metric' as const,source:'4 минуты\nСтолько времени пользователь готов потратить на первичный выбор.',fields:{value:'4 минуты',caption:'Столько времени пользователь готов потратить на первичный выбор.'}},block('b3','body','Первые экраны должны отвечать на основные вопросы быстро.')]}
  const candidates=compositionsFor(content).filter(c=>c.id==='composition/metric-focus'),work={content,candidates,bindings:{}}
  return renderStudioSlide(library,{...work,plan:draftOptions(work,library)[0].plan})
 },studioFixture().library)
 expect(r.passed,r.issues.join('; ')).toBe(true)
 const value=r.text.find(t=>t.field==='value')!,caption=r.text.find(t=>t.field==='caption')!
 expect(value.value).toBe('4 минуты');expect(value.height).toBeLessThan(value.size*1.6);expect(caption.size).toBeGreaterThanOrEqual(40)
})
