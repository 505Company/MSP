import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeLayoutFixture} from './fixtures/native-layout'
import {compileEditableProposal} from '../lib/design-system/editable-source'
import {renderEditableHtml} from '../lib/design-system/editable-render'

test('a metric preserves captions supplied in items rather than silently dropping data',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),t=compileEditableProposal(proposal,1,snapshot,'job',[])
 assert.match(renderEditableHtml(t),/Описание показателя/)
})
test('native radial geometry retains the outer ring, four markers, and source text styles',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('radial'),t=compileEditableProposal(proposal,1,snapshot,'job',[]),html=renderEditableHtml(t)
 assert.equal((html.match(/<ellipse\b/g)??[]).length,6)
 assert.match(html,/Arial/);assert.match(html,/#000000|rgba\(0,0,0,1\)/)
})

test('native text keeps mixed number/unit sizes and binds new values without old sample text',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),t=compileEditableProposal(proposal,1,snapshot,'job',[])
 const text=t.sourceLayout!.text.find(s=>s.binding.field==='metric')!
 assert.deepEqual(text.element.styleRuns!.map(r=>r.fontSize),[319,184])
 const html=renderEditableHtml(t,{value:'73',unit:'млн',items:[{text:'Новая подпись'}]}).replace(/<[^>]*>/g,'')
 assert.match(html,/73млн/);assert.match(html,/Новая подпись/);assert.doesNotMatch(html,/Описание показателя/)
})

test('native diagrams discard model chart fields and retain zero-height source connectors',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements.push({id:'arrow',slide:1,name:'Connector',kind:'line',properties:{bounds:{x:200,y:50,width:80,height:0},rotation:0,opacity:1,visible:true,zIndex:3,stroke:{width:2,paint:{type:'solid',color:{r:0,g:0,b:1,a:1}}}}})
 proposal.sourceIds.push('arrow');proposal.data={rows:[['Unused model chart field']],series:[{name:'Unused',values:[10]}]}
 const t=compileEditableProposal(proposal,1,snapshot,'job',[]),html=renderEditableHtml(t)
 assert.deepEqual(Object.keys(t.data),['items'])
 assert.match(html,/width="80" height="1" overflow="visible"/)
 assert.match(html,/data-source-object="arrow"/)
})

test('feature captions and legend labels cannot disappear from generic templates',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),base=compileEditableProposal(proposal,1,snapshot,'job',[])
 const feature={...base,kind:'feature' as const,sourceLayout:undefined,data:{items:[{text:'Смысл тезиса'}]}}
 assert.match(renderEditableHtml(feature),/Смысл тезиса/)
 const legend={...base,kind:'progress' as const,sourceLayout:undefined,data:{items:[{text:'DAU'},{text:'MAU'}]}}
 assert.match(renderEditableHtml(legend),/>DAU</);assert.match(renderEditableHtml(legend),/>MAU</)
})
