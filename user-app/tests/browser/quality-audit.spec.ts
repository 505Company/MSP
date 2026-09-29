import {build} from 'esbuild'
import {test,expect} from './workspace-fixture'
import {nativeLayoutFixture} from '../fixtures/native-layout'
import {compileEditableProposal} from '../../lib/design-system/editable-source'
import type {QualityAuditState} from '../../lib/design-system/quality-audit-contract'

test('audit captures every actual variant with source fonts and isolates an unrenderable component',async({page})=>{
 await page.goto('/processing-worker')
 const writes:string[]=[]
 await page.route('**/api/uploads/audit-preview/fonts',r=>r.fulfill({json:{fonts:[],requested:[{family:'Play',style:'Regular'},{family:'Play',style:'Bold'}]}}))
 await page.route('**/api/uploads/broken-fonts/fonts',r=>r.fulfill({status:500,json:{error:'Unavailable'}}))
 page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())})
 const {snapshot,proposal}=nativeLayoutFixture('metric')
 const template=compileEditableProposal(proposal,1,snapshot,'audit-preview',[])
 const bundle=await build({stdin:{contents:"export {renderAuditBoards} from './browser/quality-audit'; export {captureSourceFontCss} from './browser/fonts';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'AuditPreview',write:false})
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 const result=await page.evaluate(async template=>{
  const api=(window as unknown as {AuditPreview:typeof import('../../browser/quality-audit')&typeof import('../../browser/fonts')}).AuditPreview
  const variants=Array.from({length:13},(_,i)=>({...structuredClone(template),id:`variant-${i}`}))
  const broken=structuredClone(template);broken.id='broken'
  for(const field of broken.sourceLayout!.text){field.element.fontFamily='MissingAuditFace';for(const run of field.element.styleRuns??[])run.fontFamily='MissingAuditFace'}
  const audit=await api.renderAuditBoards('audit-preview',[...variants,broken],[1],new AbortController().signal)
  const unavailable=await api.renderAuditBoards('broken-fonts',variants.slice(0,2),[],new AbortController().signal)
  const pixels=await Promise.all(audit.boards.map(async b=>{
   const img=new Image();img.src=b.image;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height
   const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);const a=ctx.getImageData(0,0,c.width,c.height).data
   let blue=0;for(let i=0;i<a.length;i+=4)if(a[i]<70&&a[i+1]>60&&a[i+1]<190&&a[i+2]>210)blue++
   return {width:img.width,height:img.height,blue}
  }))
  const css=await api.captureSourceFontCss()
  return {ids:audit.boards.flatMap(b=>b.ids),failed:audit.failed,pixels,unavailable,embedded:css.includes('font-family:"Play"')&&css.includes('base64,'),leftovers:document.querySelectorAll('[aria-hidden="true"][style*="-20000px"]').length}
 },template)
 expect(result.ids).toEqual(Array.from({length:13},(_,i)=>`variant-${i}`))
 expect(result.failed.map(f=>f.id)).toEqual(['broken'])
 expect(result.pixels).toHaveLength(2)
 expect(result.pixels.every(p=>p.width===1440&&p.blue>500)).toBe(true)
 expect(result.embedded).toBe(true)
 expect(result.unavailable.boards).toHaveLength(0);expect(result.unavailable.failed).toHaveLength(2)
 expect(result.leftovers).toBe(0);expect(writes).toEqual([])
})

test('the audit UI stays compact, starts only on request, and links the accepted whole block',async({page})=>{
 await page.goto('/processing-worker')
 let started=false;const calls:unknown[]=[]
 const state:QualityAuditState={enabled:true,stale:false,job:{version:'design-quality-audit-1',id:'revision',sourceHash:'hash',sourceRevision:'source',sourceCatalogId:'source-catalog',catalogId:'catalog',createdAt:1,updatedAt:2,status:'complete',batches:[{id:'slides-1',slides:[1],status:'complete'}],overview:{id:'template-style',slides:[],status:'complete'},integrity:{status:'checked',resources:1,missing:[],incompleteSlides:[]},modelRequests:2,repairPlanReady:true,repairs:[{id:'s1-missing',batchId:'s1',findingId:'missing',slide:1,sourceIds:['panel','text'],unit:null,reason:'Пропущена связка с пояснением',target:'component',region:{x:0,y:0,width:1,height:1},status:'accepted',componentIds:['whole-block'],detail:'Целый блок добавлен и проверен'}]},results:[{rejected:[],slides:[{slide:1,units:[],relations:[],techniques:[],findings:[{id:'missing',kind:'lost-relationship',unitId:null,sourceIds:['panel','text'],componentIds:[],reason:'Пропущена связка с пояснением',repair:'component'}],note:''}]}],style:{summary:'Текст и примеры сгруппированы',patterns:[{name:'Плашка и пояснение',purpose:'Связывает пример с выводом',application:'Сохранять абзац рядом с примером',scope:'observed',preserve:['Отступ и принадлежность подписи'],evidence:[{slide:1,sourceIds:['panel','text']}]}],limitations:[]}}
 await page.route('**/api/uploads/audit-ui/quality-audit',async route=>{
  if(route.request().method()==='POST'){calls.push(route.request().postDataJSON());started=true;return route.fulfill({json:{job:state.job,background:true}})}
  return route.fulfill({json:started?state:{enabled:false,job:null,stale:false,results:[],style:null}})
 })
 const bundle=await build({stdin:{contents:"import React from 'react'; import {createRoot} from 'react-dom/client'; import {QualityAudit} from './components/quality-audit'; export function mount(){const host=document.createElement('main');document.body.appendChild(host);createRoot(host).render(React.createElement(QualityAudit,{uploadId:'audit-ui',showStyle:true}));}",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'AuditUI',write:false})
 await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>{(window as unknown as {AuditUI:{mount():void}}).AuditUI.mount()})
 const details=page.getByLabel('Аудит дизайн-системы')
 await expect(details.locator('summary')).toHaveText('Аудит смысловых блоков')
 await expect(details).not.toHaveAttribute('open','');expect(calls).toEqual([])
 await details.locator('summary').click();await page.getByRole('button',{name:'Проверить дизайн-систему',exact:true}).click()
 await expect(page.getByRole('link',{name:'Открыть добавленный блок'})).toHaveAttribute('href','/styles/audit-ui/components/whole-block')
 await expect(page.getByRole('heading',{name:'Плашка и пояснение'})).toBeVisible()
 expect(calls).toEqual([{action:'start',explicit:true}])
})
