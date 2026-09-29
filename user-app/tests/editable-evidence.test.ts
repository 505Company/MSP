import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeLayoutFixture,sourceText} from './fixtures/native-layout'
import {compileEditableSlides} from '../lib/design-system/editable-analysis'
import type {SourceElement} from '../lib/digital-designer/source-types'
import {validateEditableReply} from '../lib/design-system/editable-contract'

const raster=(id:string,x:number,y:number,width:number,height:number):SourceElement=>({id,slide:1,kind:'raster',name:'Source image',properties:{bounds:{x,y,width,height},visible:true,opacity:1,rotation:0,zIndex:1,assetId:id,reason:'source-image'}})

test('an isolated graphic mislabelled as a feature does not block valid components or become editable content',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[raster('icon',500,100,80,80),sourceText('caption','Полезная подпись',20,20,240,40,20)]
 const icon={...proposal,id:'icon-block',kind:'feature' as const,sourceIds:['icon'],data:{graphicId:'icon',rows:[]}}
 const valid={...proposal,id:'caption-block',kind:'text' as const,sourceIds:['caption'],data:{text:'Полезная подпись'}}
 const raw={slides:[{slide:1,blocks:[valid,icon],note:'Пример'}]},before=structuredClone(raw)
 const reply=validateEditableReply(raw,snapshot,[1],[])
 const result=await compileEditableSlides(snapshot,reply.slides,'fixture')
 assert.ok(result.families.some(f=>f.variants.some(t=>t.id==='caption-block')))
 assert.ok(result.families.every(f=>f.variants.every(t=>t.id!=='icon-block')))
 assert.match(result.excluded.find(e=>e.id==='icon-block')!.reason,/график/i)
 assert.deepEqual(raw,before,'provider response remains immutable')
 for(const broken of [{...icon,sourceIds:['missing']},{...icon,data:{graphicId:'missing'}},{...icon,sourceIds:['caption']},{...icon,kind:'metric'},{...icon,dataStatus:'native'}]){
  assert.throws(()=>validateEditableReply({slides:[{slide:1,blocks:[valid,broken],note:''}]},snapshot,[1],[]))
 }
 // A selected group with a nested caption is not a graphic-only exception.
 snapshot.elements.push({id:'group',slide:1,kind:'group',name:'Card',properties:{bounds:{x:0,y:0,width:300,height:100},rotation:0,opacity:1,visible:true,zIndex:1}}, {...sourceText('nested','Подпись внутри',0,0,200,40,20),parentId:'group'})
 assert.throws(()=>validateEditableReply({slides:[{slide:1,blocks:[{...icon,sourceIds:['group']}],note:''}]},snapshot,[1],[]))
})

test('a model text label cannot hide illustrated step cards or their observed row',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[0,1,2].flatMap(i=>[raster(`frame${i}`,i*310,100,290,350),raster(`image${i}`,i*310,260,290,190),sourceText(`number${i}`,`0${i+1}`,i*310+10,110,30,30,22),sourceText(`body${i}`,`Описание этапа ${i+1}`,i*310+50,110,230,120,20)])
 const blocks=[0,1,2].map(i=>({...proposal,id:`b${i}`,kind:'text' as const,sourceIds:[`frame${i}`,`number${i}`,`body${i}`],data:{title:`0${i+1}`,text:`Описание этапа ${i+1}`}}))
 const before=structuredClone(blocks),result=await compileEditableSlides(snapshot,[{slide:1,blocks,note:''}],'fixture')
 const templates=result.families.flatMap(f=>f.variants),cards=templates.filter(t=>t.kind==='feature')
 assert.equal(cards.length,3)
 cards.forEach((c,i)=>{assert.ok(c.sourceLayout?.graphicIds.includes(`image${i}`));assert.equal(c.sourceLayout?.text.length,2)})
 assert.ok(templates.some(t=>t.kind==='composition'&&t.children?.length===3))
 assert.deepEqual(blocks,before,'raw recognition evidence stays immutable')
})

test('an omitted local backing is recovered without capturing the slide or a neighbouring card',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[raster('background',0,0,1000,600),raster('card',100,100,300,300),raster('other',430,100,300,300),sourceText('heading','Заголовок',120,120,260,45,26),sourceText('body','Описание карточки',120,180,260,180,20),sourceText('neighbour','Чужой текст',450,140,260,200,20),sourceText('title','Обычный заголовок слайда',50,0,900,70,40)]
 const blocks=[{...proposal,kind:'text' as const,sourceIds:['heading','body'],data:{title:'Заголовок',text:'Описание карточки'}},{...proposal,id:'title',kind:'text' as const,sourceIds:['title'],data:{title:'Обычный заголовок слайда'}}]
 const result=await compileEditableSlides(snapshot,[{slide:1,blocks,note:''}],'fixture'),templates=result.families.flatMap(f=>f.variants),card=templates.find(t=>t.id===proposal.id)!
 assert.equal(card.kind,'feature');assert.ok(card.sourceIds.includes('card'))
 assert.ok(!card.sourceIds.includes('background'));assert.ok(!card.sourceIds.includes('other'));assert.ok(!card.sourceIds.includes('neighbour'))
 assert.equal(templates.find(t=>t.id==='title')?.kind,'text')
})

test('a source logo with unrelated model text cannot masquerade as an illustrated explanation',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[raster('logo',0,0,120,60),sourceText('brand','TV',20,20,50,20,12)]
 const result=await compileEditableSlides(snapshot,[{slide:1,blocks:[{...proposal,kind:'feature',sourceIds:['logo','brand'],data:{text:'Длинное описание этапа процесса со связанными объектами'}}],note:''}],'fixture')
 assert.equal(result.families.length,0)
 assert.equal(result.excluded.length,1)
})

test('an isolated brand label and a partially overlapping background stay out of components',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[raster('blur',400,300,250,280),sourceText('title','Большой заголовок',50,350,850,200,60),sourceText('brand','TV',800,20,60,30,18)]
 const blocks=[{...proposal,id:'title',kind:'text' as const,sourceIds:['title'],data:{title:'Большой заголовок'}},{...proposal,id:'logo',kind:'feature' as const,sourceIds:['brand'],data:{title:'TV'}}]
 const result=await compileEditableSlides(snapshot,[{slide:1,blocks,note:''}],'fixture')
 assert.ok(result.families.every(f=>f.kind==='text'))
})

test('a row of aligned step cards survives different source encodings of its illustrations',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements=[0,1,2].flatMap(i=>[raster(`frame${i}`,i*310,100,290,350),...(i===1?[]:[raster(`image${i}`,i*310,260,290,190)]),sourceText(`number${i}`,`0${i+1}`,i*310+10,110,30,30,22),sourceText(`body${i}`,`Описание этапа ${i+1}`,i*310+50,110,230,120,20)])
 const blocks=[0,1,2].map(i=>({...proposal,id:`b${i}`,kind:'text' as const,sourceIds:[`frame${i}`,`number${i}`,`body${i}`],data:{title:`0${i+1}`,text:`Описание этапа ${i+1}`}}))
 const result=await compileEditableSlides(snapshot,[{slide:1,blocks,note:''}],'fixture')
 assert.ok(result.families.some(f=>f.variants.some(t=>t.kind==='composition'&&t.children?.length===3)))
})

test('a hidden white slide base does not override the observed dark canvas of a raster-backed slide',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 const base={...snapshot.elements[0],id:'canvas',name:'Slide background',properties:{...snapshot.elements[0].properties,bounds:{x:0,y:0,width:1000,height:600},fill:{type:'solid',color:{r:1,g:1,b:1,a:1}}}}
 snapshot.elements.unshift(base,raster('background',0,0,1000,600))
 const result=await compileEditableSlides(snapshot,[{slide:1,blocks:[{...proposal,kind:'feature',style:{background:'#020807'},data:{text:'Текст'}}],note:''}],'fixture')
 const card=result.families.find(f=>f.kind==='feature')!.variants[0]
 assert.equal(card.style.background,'#020807')
 assert.ok(!card.sourceIds.includes('background'),'canvas style must not pull the whole slide into a component')
})
