import test from 'node:test'
import assert from 'node:assert/strict'
import {buildBackgroundCatalog,assembleBackground} from '../lib/design-system/backgrounds'
import {flatten} from '../lib/design-system/compiler'
import {slideMasterFixture} from './fixtures/slide-master'
import {masterItemBounds,masterContentArea} from '../lib/design-system/slide-masters'

test('inherited footer logos become a separate master style and survive the actual background assembly',()=>{
 const {snapshot,library}=slideMasterFixture(),before=JSON.stringify({snapshot,library})
 const catalog=buildBackgroundCatalog(snapshot,library,'source')
 assert.equal(catalog.masters?.length,1)
 assert.equal(catalog.presets[0].selection.masterId,catalog.masters![0].id)
 assert.ok(!catalog.artworks.some(a=>a.assetIds.includes('brand-image')),'branding is not a pattern')
 const scene=assembleBackground(catalog,catalog.presets[0].selection,{width:800,height:450})
 assert.equal(flatten(scene.elements).filter(e=>e.kind==='raster'&&e.assetId==='brand-image').length,1)
 assert.equal(JSON.stringify({snapshot,library}),before)
})

test('a logo used only in slide content is not promoted to inherited branding',()=>{
 const {snapshot,library}=slideMasterFixture()
 snapshot.elements.find(e=>e.id==='brand')!.properties.sourceRef={part:'ppt/slides/slide1.xml',shapeId:'logo'}
 assert.equal(buildBackgroundCatalog(snapshot,library,'source').masters?.length??0,0)
})

test('a layout mask hides the older master logo instead of reviving it above the footer',()=>{
 const {snapshot,library}=slideMasterFixture()
 snapshot.elements.push({id:'occluder',slide:1,name:'Layout mask',kind:'rectangle',properties:{bounds:{x:20,y:400,width:140,height:40},rotation:0,visible:true,opacity:1,zIndex:25,fill:{type:'solid',color:{r:0,g:0,b:0,a:1}},sourceRef:{part:'ppt/slideLayouts/slideLayout1.xml',shapeId:'mask'}}})
 assert.equal(buildBackgroundCatalog(snapshot,library,'source').masters?.length??0,0)
 snapshot.elements.at(-1)!.properties.opacity=.5
 assert.equal(buildBackgroundCatalog(snapshot,library,'source').masters?.length,1,'a translucent mask does not fully hide the logo')
})

test('a grouped logo keeps its glyph and wordmark together',()=>{
 const {snapshot,library,logo}=slideMasterFixture()
 const source=snapshot.elements.find(e=>e.id===logo.id)!
 source.parentId='logo-group';source.properties.bounds={x:20,y:0,width:112,height:22}
 snapshot.elements.push({id:'logo-group',name:'Brand group',kind:'group',slide:1,properties:{bounds:{x:32,y:408,width:132,height:22},rotation:0,visible:true,opacity:1,zIndex:20,sourceRef:logo.sourceRef}})
 snapshot.elements.push({id:'logo-glyph',name:'Brand glyph',kind:'raster',slide:1,parentId:'logo-group',properties:{...logo,id:'logo-glyph',assetId:'glyph-image',bounds:{x:0,y:0,width:18,height:22}}})
 const master=buildBackgroundCatalog(snapshot,library,'source').masters![0]
 assert.equal(master.items.length,1)
 assert.deepEqual(master.items[0].assetIds.sort(),['brand-image','glyph-image'])
 assert.equal(master.items[0].bounds.width,132)
})

test('overlapping master and layout logos retain source paint order, not coordinate order',()=>{
 const {snapshot,library,logo}=slideMasterFixture(),replacement={...logo,id:'new-brand',zIndex:30,bounds:{...logo.bounds,y:407},sourceRef:{part:'ppt/slideLayouts/slideLayout1.xml',shapeId:'new-logo'},assetId:'replacement-image'}
 snapshot.elements.push({id:replacement.id,slide:1,name:replacement.name,kind:replacement.kind,properties:replacement})
 const original=library.components.at(-1)!
 library.components.push({...original,id:'replacement',source:{...original.source,rootId:replacement.id,elementIds:[replacement.id],assetIds:[replacement.assetId]},scene:{...original.scene,elements:[{...replacement,bounds:{...replacement.bounds,x:0,y:0}}]}})
 const master=buildBackgroundCatalog(snapshot,library,'source').masters![0]
 assert.deepEqual(master.items.map(i=>i.assetIds),[['brand-image'],['replacement-image']])
})

test('one fixed footer is reused on every preset and scales proportionally with a reserved band',()=>{
 const {snapshot,library}=slideMasterFixture()
 snapshot.slides.push({...snapshot.slides[0],id:'s2',number:2});snapshot.slideCount=2
 const catalog=buildBackgroundCatalog(snapshot,library,'source'),master=catalog.masters![0],item=master.items[0]
 assert.equal(catalog.masters!.length,1)
 assert.ok(catalog.presets.every(p=>p.selection.masterId===master.id))
 for(const size of [{width:1600,height:900},{width:900,height:900},{width:720,height:1280}]){
  const b=masterItemBounds(master,item,size),area=masterContentArea(master,size)
  assert.ok(Math.abs(b.width/b.height-item.scene.width/item.scene.height)<1e-6)
  assert.ok(area.y+area.h<b.y)
  assert.ok(b.y+b.height<=size.height)
 }
})
