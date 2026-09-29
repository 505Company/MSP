import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {compactPackets,compactContentTask,type CompactProof} from '../lib/presentations/studio/compact-content'
import {componentFlexTask} from '../lib/presentations/studio/component-flex'
import type {StudioRun,SlideWork,ContentSlide} from '../lib/presentations/studio/contract'
import type {ModelRun} from '../lib/uploads/model-run'
import {validateReceipt} from '../lib/presentations/studio/storage'
const dir=process.argv[2];if(!dir)throw Error('Provide a saved experiment directory')
const source=await readFile(dir+'/input.md','utf8'),run=JSON.parse(await readFile(dir+'/run.json','utf8')) as StudioRun,report=JSON.parse(await readFile(dir+'/report.json','utf8'))
assert.equal(run.semantic?.source,source);assert.equal(report.inputHash,createHash('sha256').update(source).digest('hex'))
const packets=compactPackets(source),model:{metadata:ModelRun<{proof:CompactProof}>;response:{content:string}}[]=[]
for(const id of run.modelRunIds){const saved=JSON.parse(await readFile(`${dir}/model-${id}.json`,'utf8'));model.push(saved)}
const rows=[]
for(const u of run.semantic!.units!){
 const s=run.slides.find(s=>s.content.id===u.id),r=run.results[u.id],packet=packets.find(p=>p.id===u.id)!
 if(u.status==='complete'){
  const saved=model.filter(m=>m.metadata.scope.slideId===u.id&&m.metadata.status==='complete').at(-1);assert.ok(saved,`No model evidence for ${u.id}`)
  const raw=JSON.parse(saved.response.content)
  const validated:{work:SlideWork;proof:CompactProof}|{content:ContentSlide;proof:CompactProof}=run.semantic!.strategy==='components'?componentFlexTask(packet,run.library).validate(raw):compactContentTask(packet).validate(raw)
  const content:ContentSlide='work' in validated?validated.work.content:validated.content
  assert.deepEqual(s!.content.blocks.map(b=>b.fields),content.blocks.map(b=>b.fields))
  assert.deepEqual({...u.proof,version:validated.proof.version},validated.proof)
  assert.equal(u.proof?.version,saved.metadata.result!.proof.version)
  if('work' in validated){assert.deepEqual(s!.flexNodes,validated.work.flexNodes);assert.deepEqual(s!.plan?.components,validated.work.plan?.components)}
 }
 if(r?.passed){
  validateReceipt(run,r,true)
  for(const b of s!.content.blocks){for(const [field,value] of Object.entries(b.fields))assert.ok(r.text.some(t=>t.blockId===b.id&&t.field===field&&t.value===value))
   if(b.data)assert.deepEqual(r.dataValues!.find(v=>v.blockId===b.id)?.values,b.data.values)
  }
  assert.deepEqual(r.issues,[])
  assert.ok(r.text.every(t=>t.size>=20))
  if(s!.strictComponents){assert.equal(r.components.length,s!.content.blocks.length);for(const c of r.components)assert.equal(c.componentId,s!.plan!.components[c.blockId])}
 }
 rows.push({id:u.id,semantic:u.status,passed:r?.passed??false,blocks:s?.content.blocks.length,components:r?.components.length??0,error:u.error??s?.error})
}
const requests=model.map(m=>{const p=m.metadata.provenance??m.metadata.attempts.at(-1)?.provenance;return {id:m.metadata.id,slide:m.metadata.scope.slideId,status:m.metadata.status,liveRequests:m.metadata.liveRequests,seconds:(p?.elapsedMs??0)/1000,provider:p?.routingReceipt?.providerName??p?.endpoint?.providerTag,quantization:p?.endpoint?.declaredQuantization,usage:p?.usage,costRub:p?.routingReceipt?.totalCostRub,error:m.metadata.error?.code}})
const audit={checkedAt:new Date().toISOString(),inputHash:report.inputHash,mode:run.semantic?.strategy??'recipes',sourceAndReferencesVerified:true,dataValuesVerified:true,modelChoicesVerified:true,serverReceiptGuardsVerified:true,recipesUnchanged:report.productionFilesUnchanged&&report.templatesUnchangedFromBeforeExperiment,elapsedMs:report.elapsedMs,ready:rows.filter(r=>r.passed).length,total:rows.length,rows,requests,paidRequests:requests.reduce((n,r)=>n+r.liveRequests,0),knownCostRub:requests.reduce((n,r)=>n+(r.costRub??0),0),unknownCosts:requests.filter(r=>r.liveRequests&&r.costRub===undefined).length}
await writeFile(dir+'/audit.json',JSON.stringify(audit,null,2));console.log(JSON.stringify(audit,null,2))
