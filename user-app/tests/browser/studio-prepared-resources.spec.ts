import {test,expect} from '@playwright/test'
import {labTemplate} from '../../component-lab/fixtures'
import {sourceCandidate} from '../../lib/component-lab/source'
import {LAB_VERSION} from '../../lib/component-lab/contract'

test('a generation checks pinned resources once, while a changed pin still fails fidelity validation',async({page})=>{
 let manifests=0
 await page.route('**/api/uploads/*/fonts',r=>{manifests++;return r.fulfill({json:{fonts:[]}})})
 await page.goto('/processing-worker')
 const source=await sourceCandidate(labTemplate(),'fixture')
 const result=await page.evaluate(async({profile,version})=>{
  const paths={fonts:'/browser/component-lab/fonts.ts',resources:'/browser/prepared-components.ts'}
  const {sourceFonts}=await import(paths.fonts) as typeof import('../../browser/component-lab/fonts')
  const {preparedResources}=await import(paths.resources) as typeof import('../../browser/prepared-components')
  const fonts=await sourceFonts('pinned-test',profile,true)
  const pin={version,profile,faces:fonts.faces??[],assets:fonts.artwork?.assets??[],fidelity:{status:'preserved'}} as Parameters<typeof preparedResources>[1]
  await Promise.all(Array.from({length:12},()=>preparedResources('pinned-test',pin)))
  const changed={...pin,faces:pin.faces.map(f=>({...f,hash:'0'.repeat(64)}))}
  const failures=await Promise.all(Array.from({length:5},()=>preparedResources('pinned-test',changed).then(()=>'',e=>e.message)))
  return {failures,faces:fonts.faces?.length}
 },{profile:source.profile!,version:`preparation-1:${source.profile!.version}:${LAB_VERSION}`})
 expect(result.faces).toBeGreaterThan(0)
 expect(result.failures).toEqual(Array(5).fill('prepared-component-resources-changed'))
 expect(manifests).toBe(3) // initial snapshot, repeated valid pin, repeated invalid pin
})
