import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverNativeDiagrams } from '../lib/design-system/diagram-discovery'
import { readSourceScene } from '../lib/design-system/source-scene'
import { compileLibrary, flatten } from '../lib/design-system/compiler'
import { nativeDiagramFixture } from './fixtures/native-diagram'
import { nativeDiagramGraph } from '../lib/design-system/diagram-native'

test('native connectors recover a diagram without a model diagram label, but do not invent connections', () => {
  const source = nativeDiagramFixture(), scene = readSourceScene(source), library = compileLibrary(source)
  const found = discoverNativeDiagrams(scene, library, [])
  assert.equal(found.length, 1)
  assert.equal(found[0].graph.edges[0].arrow, 'end')
  assert.equal(found[0].graph.nodes.filter(n => n.kind === 'block').length, 2)
  assert.equal(discoverNativeDiagrams(scene, library, [found[0].graph]).length, 0, 'An already recognized graph is not duplicated')
  source.elements = source.elements.filter(e => !['edge', 'line', 'head'].includes(e.id))
  assert.equal(discoverNativeDiagrams(readSourceScene(source), compileLibrary(source), []).length, 0, 'Two cards are not a process without source connectors')
})

test('separate text objects inside nodes survive discovery; unattached captions prevent a partial graph', () => {
  const source = nativeDiagramFixture()
  source.elements.push({ id: 'text', name: 'Caption', kind: 'text', slide: 1, properties: { bounds: { x: 5, y: 10, width: 50, height: 25 }, rotation: 0, opacity: 1, visible: true, zIndex: 2, text: 'A label', fontFamily: 'Arial', fontSize: 12 } })
  const found = discoverNativeDiagrams(readSourceScene(source), compileLibrary(source), [])
  assert.equal(found.length, 1)
  assert.ok(found[0].graph.nodes.some(n => flatten(n.elements).some(e => e.kind === 'text' && e.text === 'A label')))
  source.elements.at(-1)!.properties.bounds = { x: 100, y: 70, width: 50, height: 25 }
  assert.equal(discoverNativeDiagrams(readSourceScene(source), compileLibrary(source), []).length, 0)
  assert.equal(discoverNativeDiagrams(readSourceScene(source), compileLibrary(source), [], ['text']).length, 1, 'A source paragraph explicitly classified as a style instruction is not diagram content')
})

test('ambiguous native transforms remain unqualified rather than guessed', () => {
  const source = nativeDiagramFixture(); source.elements[0].properties.rotation = 30
  assert.equal(discoverNativeDiagrams(readSourceScene(source), compileLibrary(source), []).length, 0)
})

test('a native block diagram retains the source surface for light connectors without making the background a block',()=>{
 const source=nativeDiagramFixture(),ids=source.elements.map(e=>e.id)
 source.elements.push({id:'bg',name:'Slide background',slide:1,kind:'rectangle',properties:{bounds:{x:0,y:0,width:300,height:100},rotation:0,visible:true,opacity:1,zIndex:0,fill:{type:'solid',color:{r:0,g:0,b:0,a:1}}}})
 const graph=nativeDiagramGraph(readSourceScene(source),ids)!
 assert.equal(graph.sourceSurface,'#000000');assert.equal(graph.nodes.filter(n=>n.kind==='block').length,2);assert.ok(!graph.sourceIds.includes('bg'))
})

test('rotated reflected orthogonal connectors retain their actual direction and every bend',()=>{
 const source=nativeDiagramFixture()
 source.elements.find(e=>e.id==='a')!.properties.bounds={x:0,y:0,width:60,height:50}
 source.elements.find(e=>e.id==='b')!.properties.bounds={x:200,y:100,width:60,height:50}
 source.slides[0].height=180
 const edge=source.elements.find(e=>e.id==='edge')!,line=source.elements.find(e=>e.id==='line')!,head=source.elements.find(e=>e.id==='head')!
 edge.properties.bounds={x:65,y:25,width:130,height:100};edge.properties.centeredTransform={flipH:true,flipV:true};edge.properties.rotation=0
 line.properties.bounds={x:0,y:0,width:130,height:100};line.properties.pathData='M0 0 L65 0 L65 100 L130 100'
 head.properties.bounds={x:126,y:97,width:6,height:6}
 const g=nativeDiagramGraph(readSourceScene(source),['a','b','edge'])
 assert.ok(g,'an observed reflected polyline is unambiguous')
 assert.equal(g.nodes.filter(n=>n.kind==='block').length,2)
 assert.ok(g.edges.some(e=>e.arrow==='end'))
 assert.ok(g.edges.length>=3,'the orthogonal route must not turn into a diagonal shortcut')
})
