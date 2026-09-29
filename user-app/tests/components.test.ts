import assert from 'node:assert/strict'
import test from 'node:test'
import { compileLibrary, flatten, instantiateComponent } from '../lib/design-system/compiler'
import { initializeLibrary, loadLibrary } from '../lib/design-system/storage'
import type { SourceSnapshot, SourceElement } from '../lib/digital-designer/source-types'
import type { DesignAnalysis } from '../lib/digital-designer/design-analysis'

function fixture():SourceSnapshot{
  const element=(id:string,kind:string,parentId?:string,properties:Record<string,unknown>={}):SourceElement=>({id:`s01-${id}`,slide:1,kind,name:id,...(parentId?{parentId:`s01-${parentId}`} :{}),properties:{bounds:{x:0,y:0,width:300,height:80},rotation:0,opacity:1,visible:true,zIndex:1,...properties}})
  const text='Сохранить полный текст'
  return {schemaVersion:1,sourceId:'a'.repeat(64),name:'control.pptx',slideCount:1,slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text,warnings:[]}],assets:[],colors:[{hex:'#123456',occurrences:1}],fonts:[{family:'Arial',sizes:[20],occurrences:1}],limitations:[],elements:[
    element('outer','group',undefined,{bounds:{x:150,y:60,width:400,height:200},rotation:20,opacity:.7,centeredTransform:{flipH:true,flipV:false},clipsContent:true}),
    element('card','group','outer',{bounds:{x:20,y:30,width:300,height:120}}),
    element('bg','rectangle','card',{fill:{type:'solid',color:{r:.8,g:.9,b:.9,a:1}},bounds:{x:0,y:0,width:300,height:120}}),
    element('text','text','card',{bounds:{x:10,y:10,width:260,height:60},text,fontFamily:'Arial',fontSize:20,textBox:{align:'LEFT',vertical:'TOP',wrap:true},paragraphs:[{start:0,end:text.length,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,fontSize:20}],styleRuns:[{start:0,end:text.length,fontFamily:'Arial',fontSize:20,fontStyle:'Bold'}],colorRuns:[{start:0,end:text.length,fill:{type:'solid',color:{r:.1,g:.1,b:.1,a:1}}}],flow:{columns:1,gap:0,autoFit:'SHRINK'}}),
    element('marker','text','card',{bounds:{x:270,y:80,width:25,height:30},text:'01',fontFamily:'Arial',fontSize:20}),
    {id:'s01-picture-0-1',slide:1,kind:'source-picture',name:'Auxiliary',properties:{sourcePart:'ppt/slides/slide1.xml',sourceShapeId:'1',assetId:'not-a-scene-node'}}
  ]}
}
test('native groups preserve ancestors, numeric content and source identity; auxiliary pictures are not scene nodes',()=>{
  const result=compileLibrary(fixture()),card=result.components.find(c=>c.source.rootId==='s01-card')!
  assert.equal(result.excluded.length,0)
  assert.equal(card.slots.length,2);assert.deepEqual(card.fixedTextIds,[])
  assert.equal(card.slots.find(s=>s.id==='s01-marker')?.defaultText,'01')
  assert.deepEqual(card.source.ancestorIds,['s01-outer'])
  const outer=flatten(card.scene.elements).find(e=>e.id==='s01-outer')!
  assert.equal(outer.rotation,20);assert.equal(outer.opacity,.7);assert.equal(outer.centeredTransform?.flipH,true)
  assert.ok(!flatten(card.scene.elements).some(e=>e.id.includes('picture')))
  assert.equal(result.compilerVersion,'web-components-2')
})
test('replacement preserves all text, uniform styles and multiline ranges without changing the definition',()=>{
  const card=compileLibrary(fixture()).components.find(c=>c.source.rootId==='s01-card')!,before=JSON.stringify(card)
  const value='  Новый текст\nИ вторая строка.  ',scene=instantiateComponent(card,{[card.slots[0].id]:value}),e=flatten(scene.elements).find(e=>e.kind==='text'&&e.id==='s01-text')!
  assert.equal(e.kind,'text');if(e.kind!=='text')throw new Error()
  assert.equal(e.text,value);assert.equal(e.styleRuns?.[0].fontStyle,'Bold');assert.equal(e.colorRuns?.[0].end,value.length)
  assert.equal(e.paragraphs?.at(-1)?.end,value.length);assert.equal(e.flow?.autoFit,'NONE')
  assert.equal(JSON.stringify(card),before)
  assert.throws(()=>instantiateComponent(card,{'missing':'Текст'}),/Неизвестное/)
  assert.throws(()=>instantiateComponent(card,{[card.slots[0].id]:'x'.repeat(5001)}),/длинный/)
})
test('rich text and invisible descendants do not become editable slots',()=>{
  const source=fixture(),text=source.elements.find(e=>e.id==='s01-text')!
  text.properties.styleRuns=[{start:0,end:1,fontFamily:'Arial',fontStyle:'Bold',fontSize:20},{start:1,end:String(text.properties.text).length,fontFamily:'Arial',fontStyle:'Italic',fontSize:20}]
  const slots=compileLibrary(source).components.find(c=>c.source.rootId==='s01-card')!.slots
  assert.deepEqual(slots.map(s=>s.id),['s01-marker'])
  source.elements.find(e=>e.id==='s01-outer')!.properties.visible=false
  assert.equal(compileLibrary(source).components.length,0)
})
test('invalid geometry, missing resources and cross-slide ancestry cannot become executable definitions',()=>{
  const bad=fixture();bad.elements.find(e=>e.id==='s01-bg')!.properties.bounds={x:0,y:0,width:-1,height:2}
  assert.equal(compileLibrary(bad).components.length,0);assert.ok(compileLibrary(bad).excluded.length)
  const missing=fixture();const image=missing.elements.find(e=>e.id==='s01-bg')!;image.kind='raster';image.properties={...image.properties,assetId:'asset-'+'b'.repeat(24),reason:'test'}
  assert.equal(compileLibrary(missing).components.length,0)
  const cross=fixture();cross.elements[1].slide=2
  assert.throws(()=>compileLibrary(cross),/связь/)
  const cyclic=fixture();cyclic.elements[0].parentId=cyclic.elements[1].id
  assert.throws(()=>compileLibrary(cyclic),/Цикл/)
})
test('semantic roles cannot silently join separate slide instances',()=>{
  const source=fixture(),analysis={sourceId:source.sourceId,findings:[{id:'bad',kind:'molecule',name:'Cross slide',role:'Invented',evidence:{basis:'inferred',elementIds:['s01-text','s02-text']}}]} as DesignAnalysis
  assert.ok(compileLibrary(source,analysis).components.every(c=>!c.semantics.length))
})

function memoryBucket(){
  const data=new Map<string,{value:string;etag:string}>();let generation=0
  const bucket={
    async get(key:string){const item=data.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.value)}:null},
    async put(key:string,value:string,options?:R2PutOptions){
      const existing=data.get(key),condition=options?.onlyIf as R2Conditional|undefined
      if(condition?.etagDoesNotMatch==='*'&&existing||condition?.etagMatches&&condition.etagMatches!==existing?.etag)return null
      const etag=String(++generation);data.set(key,{value,etag});return {etag}
    }
  } as unknown as R2Bucket
  return {bucket,data}
}
test('local preview substitutions never change the stored definition',async()=>{
  const {bucket}=memoryBucket(),library=compileLibrary(fixture()),initial=await initializeLibrary(bucket,'job',library),component=library.components.find(c=>c.slots.length)!
  const scene=instantiateComponent(component,{[component.slots[0].id]:'Точная новая формулировка'})
  assert.ok(flatten(scene.elements).some(e=>e.kind==='text'&&e.text==='Точная новая формулировка'))
  assert.deepEqual(await loadLibrary(bucket,'job'),initial)
  assert.deepEqual(await initializeLibrary(bucket,'job',library),initial)
})
test('concurrent initialization preserves one immutable library and changed definitions are content-addressed',async()=>{
  const {bucket}=memoryBucket(),library=compileLibrary(fixture())
  const [a,b]=await Promise.all([initializeLibrary(bucket,'job',library),initializeLibrary(bucket,'job',library)])
  assert.equal(a.revision.id,b.revision.id)
  const changed=structuredClone(library);changed.components[0].name+=' new'
  const other=await initializeLibrary(bucket,'other-job',changed);assert.notEqual(a.definitionId,other.definitionId)
})
test('automatic compilation retains unsupported effects as explicit execution limits',()=>{
  const source=fixture();source.elements[0].properties.blur=10
  const library=compileLibrary(source)
  assert.ok(library.components[0].issues.some(i=>i.severity!=='warning'))
})

test('complete catalog compilation can reach candidates beyond the legacy 150 slice',()=>{
  const source=fixture(),prototype=source.elements.find(e=>e.id==='s01-text')!
  source.elements=Array.from({length:181},(_,i)=>({...structuredClone(prototype),id:`item-${i}`,name:`Candidate ${i}`,parentId:undefined}))
  const all=compileLibrary(source,null,{maxComponents:Infinity})
  assert.equal(all.components.length,181)
  assert.ok(all.components.some(c=>c.id==='cmp-item-180'))
  assert.equal(all.excluded.length,0)
})
