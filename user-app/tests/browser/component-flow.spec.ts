import { test,expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { flowFixture } from '../fixtures/component-flow'
import { adaptiveComponentFixture } from '../fixtures/adaptive-layout'
import { validateAdaptiveFit, validateAdaptivePlan } from '../../lib/presentations/adaptive-layout'
import { COMPONENT_FLOW_VERSION,proposeComponentFlow } from '../../lib/design-system/component-adaptation'
import { flowIssues } from '../../lib/design-system/component-flow-layout'

test('number and caption flow qualifies real glyphs at width limits and rejects overflow',async({page},info)=>{
 const template=flowFixture(),before=JSON.stringify(template)
 await page.goto('/processing-worker')
 const result=await page.evaluate(async t=>{const path='/browser/component-flow.ts',fonts='/browser/fonts.ts';const {qualifyComponentFlows,renderComponentFlow,flowPixelEvidence}=await import(path) as typeof import('../../browser/component-flow');await (await import(fonts)).ensureSceneFonts(t.sourceLayout!.text.map(s=>s.element))
   const catalog={id:'c'.repeat(64),families:[{variants:[t]}],qualification:{checks:[{id:t.id,passed:true}]}} as unknown as import('../../lib/design-system/editable-contract').EditableCatalog
   const report=await qualifyComponentFlows(catalog)
   const host=document.createElement('div');document.body.appendChild(host);const data={value:'73%',text:'Длинная подпись, которая переносится и увеличивает высоту карточки, сохраняя каждое слово.'}
   const m=await renderComponentFlow(host,t,data,360,0),png=await flowPixelEvidence(host,m);host.remove();return {report,m,data,png}
 },template)
 await writeFile(info.outputPath('flow.png'),Buffer.from(result.png.preview.split(',')[1],'base64'));await writeFile(info.outputPath('flow.json'),JSON.stringify(result,null,2))
 expect(result.report.version).toBe(COMPONENT_FLOW_VERSION)
 expect(result.report.checks[0].cases.filter(c=>c.passed!==c.expected)).toEqual([])
 expect(result.report.checks[0].passed).toBe(true)
 expect(result.m.height).toBeGreaterThan(template.height)
 expect(flowIssues(result.m,template,result.data,proposeComponentFlow(template)!)).toEqual([])
 expect(result.png.pixels.every(n=>n>3)).toBe(true)
 expect(JSON.stringify(template)).toBe(before)
 const bad=structuredClone(result.m);bad.fields[1].text='Сокращено'
 expect(flowIssues(bad,template,result.data,proposeComponentFlow(template)!)).toContain('flow-text:test-caption')
})

test('qualified flow cards integrate with the shared grid and leave legacy snapshots on their renderer',async({page},info)=>{
 const {input,plan}=adaptiveComponentFixture(),t=flowFixture();input.components=[t];input.componentFlows={[t.id]:proposeComponentFlow(t)!};plan.version='adaptive-blocks-5'
 input.content.find(f=>f.id==='label1')!.text='Подробная подпись показателя, которая переносится на несколько строк и увеличивает высоту карточки'
 plan.blocks.forEach(b=>b.panelColors=null)
 validateAdaptivePlan(plan,input,{fontTokens:input.fonts.map(f=>f.id)} as import('../../lib/presentations/layout-contract').LayoutEvidence)
 await page.route('**/api/uploads/*/fonts',route=>route.fulfill({json:{fonts:[]}}))
 await page.goto('/processing-worker')
 const result=await page.evaluate(async({input,plan})=>{const f='/browser/layout-fonts.ts',r='/browser/adaptive-layout.ts';const fonts=await (await import(f)).prepareLayoutFonts(input);return (await import(r)).fitAdaptiveLayout(input,plan,'a'.repeat(64),{fontCss:Object.values(fonts.css).join('\n')})},{input,plan})
 await writeFile(info.outputPath('flow-slide.png'),Buffer.from(result.preview.split(',')[1],'base64'));await writeFile(info.outputPath('fit.json'),JSON.stringify(result.fit,null,2))
 validateAdaptiveFit(result.fit,plan,input,'a'.repeat(64),result.preview)
 expect(result.fit.version).toBe('adaptive-render-9');expect(result.fit.passed).toBe(true)
 expect(result.fit.trials.at(-1)!.components.every((c: {layoutVersion?:string})=>c.layoutVersion==='metric-caption-flow-1')).toBe(true)
 const legacy={...plan,version:'adaptive-blocks-4' as const}
 expect(()=>validateAdaptiveFit(result.fit,legacy,input,'a'.repeat(64),result.preview)).toThrow()
 const bad=structuredClone(result.fit);bad.trials.at(-1).components[0].fields[1].box.y-=15
 expect(()=>validateAdaptiveFit(bad,plan,input,'a'.repeat(64),result.preview)).toThrow()
})
