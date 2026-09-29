import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBackgroundCatalog, assembleBackground } from '../lib/design-system/backgrounds'
import { flatten } from '../lib/design-system/compiler'
import { parseSceneElements } from '../vendor/drag/src/core/page-ir'
import { reconstructedLibrary } from '../lib/design-system/reconstruction-resources'
import type { ReconstructionCatalog } from '../lib/design-system/reconstruction-contract'

import { backgroundFixture } from './fixtures/backgrounds'

function nativeDecorationFixture() {
 const {snapshot,library}=backgroundFixture(),c=library.components[0]
 snapshot.elements=snapshot.elements.filter(e=>e.id!=='raster')
 const shape={...snapshot.elements[1],kind:'rectangle',properties:{bounds:{x:600,y:0,width:200,height:450},rotation:0,visible:true,opacity:1,zIndex:2,fill:{type:'solid',color:{r:1,g:.5,b:0,a:1}}}}
 snapshot.elements[1]=shape;c.source.assetIds=[];c.source.elementIds=['mask'];c.scene.elements=[{...shape.properties,id:'mask',name:'Decoration',kind:'rectangle',bounds:{x:0,y:0,width:200,height:450}} as typeof c.scene.elements[number]]
 return {snapshot,library}
}

test('native decoration belongs to the background, but a separate text-bearing panel does not',()=>{
 const {snapshot,library}=nativeDecorationFixture()
 assert.equal(buildBackgroundCatalog(snapshot,library,'catalog').artworks.length,1)
 snapshot.elements.push({id:'inside',slide:1,name:'Body',kind:'text',properties:{bounds:{x:620,y:40,width:150,height:40},text:'Содержание карточки',fontFamily:'Arial',fontSize:18,rotation:0,visible:true,opacity:1,zIndex:3}})
 assert.equal(buildBackgroundCatalog(snapshot,library,'catalog').artworks.length,0)
})

test('whole content ownership keeps native parts out of backgrounds even when their caption is outside', () => {
 for (const grouped of [false, true]) {
  const {snapshot,library}=nativeDecorationFixture()
  if (grouped) {
   snapshot.elements[1].parentId='content-unit'
   snapshot.elements.push({id:'content-unit',slide:1,name:'Content',kind:'group',properties:{bounds:{x:0,y:0,width:800,height:450},rotation:0,visible:true,opacity:1,zIndex:1}})
  }
  const before=JSON.stringify({snapshot,library})
  assert.equal(buildBackgroundCatalog(snapshot,library,'catalog',[],[grouped?'content-unit':'mask']).artworks.length,0)
  assert.equal(JSON.stringify({snapshot,library}),before)
 }
})

test('a frame around an image or formula and a connector arrowhead are not standalone background motifs', () => {
 const {snapshot,library}=nativeDecorationFixture()
 snapshot.elements.push({id:'formula',slide:1,name:'Formula',kind:'raster',properties:{bounds:{x:620,y:40,width:150,height:40},assetId:'image',reason:'source',rotation:0,visible:true,opacity:1,zIndex:3}})
 assert.equal(buildBackgroundCatalog(snapshot,library,'catalog').artworks.length,0)
 snapshot.elements.pop()
 library.components[0].scene.elements[0].name='Arrowhead'
 assert.equal(buildBackgroundCatalog(snapshot,library,'catalog').artworks.length,0)
 library.components[0].scene.elements[0].name='Decoration'
 assert.equal(buildBackgroundCatalog(snapshot,library,'catalog').artworks.length,1)
})

function repeatedLayoutFixture() {
  const f = backgroundFixture()
  const sourceRef = { part: 'ppt/slideLayouts/slideLayout7.xml', shapeId: '203' }
  f.snapshot.elements[1].properties.sourceRef = sourceRef
  f.library.components[0].scene.elements[0].sourceRef = sourceRef
  f.snapshot.slides.push({ ...f.snapshot.slides[0], id: 's2', number: 2 }); f.snapshot.slideCount = 2
  f.snapshot.elements.push(...f.snapshot.elements.map(e => ({ ...structuredClone(e), id: `${e.id}-2`, slide: 2, ...(e.parentId ? { parentId: `${e.parentId}-2` } : {}) })))
  const second = structuredClone(f.library.components[0])
  second.id = 'c2'; second.source = { ...second.source, slide: 2, rootId: 'mask-2', elementIds: ['mask-2', 'raster-2'] }
  for (const e of flatten(second.scene.elements)) e.id += '-2'
  second.semantics[0].role = 'photo'
  f.library.components.unshift(second) // Misclassified occurrence precedes the confirmed one.
  return f
}

test('an identical inherited background survives a conflicting photo label on another slide', () => {
  const { snapshot, library } = repeatedLayoutFixture(), before = JSON.stringify({ snapshot, library })
  const result = buildBackgroundCatalog(snapshot, library, 'catalog')
  assert.equal(result.artworks.length, 1)
  assert.deepEqual(result.artworks[0].placements.map(p => p.slide).sort(), [1, 2])
  assert.deepEqual(result.presets[0].slides, [1, 2])
  assert.equal(JSON.stringify({ snapshot, library }), before)
})

test('a shared bitmap alone cannot turn a photo, changed crop or hidden occurrence into a background', () => {
  for (const change of ['slide-object', 'crop', 'hidden', 'icon'] as const) {
    const { snapshot, library } = repeatedLayoutFixture(), second = library.components[0]
    if (change === 'slide-object') snapshot.elements.find(e => e.id === 'mask-2')!.properties.sourceRef = { part: 'ppt/slides/slide2.xml', shapeId: '203' }
    if (change === 'crop') second.scene.elements[0].bounds.width -= 20
    if (change === 'hidden') snapshot.elements.find(e => e.id === 'mask-2')!.properties.visible = false
    if (change === 'icon') second.semantics[0].role = 'icon'
    assert.deepEqual(buildBackgroundCatalog(snapshot, library, 'catalog').artworks.flatMap(a => a.placements.map(p => p.slide)), [1], change)
  }
})

test('backgrounds preserve source crop and separate fill; new formats never distort artwork', () => {
  const { snapshot, library } = backgroundFixture(), original = JSON.stringify({ snapshot, library }), catalog = buildBackgroundCatalog(snapshot, library, 'catalog')
  assert.equal(catalog.fills.length, 1); assert.equal(catalog.artworks.length, 1)
  const source = assembleBackground(catalog, catalog.presets[0].selection, { width: 800, height: 450 })
  const frame = source.elements[0].children[1]
  assert.deepEqual(frame.bounds, { x: 600, y: 0, width: 200, height: 450 })
  assert.equal(frame.kind, 'group')
  assert.ok('children' in frame && 'clipsContent' in frame.children[0] && frame.children[0].clipsContent)
  for (const size of [{ width: 450, height: 800 }, { width: 900, height: 900 }, { width: 1200, height: 400 }]) {
    const scene = assembleBackground(catalog, catalog.presets[0].selection, size), art = scene.elements[0].children[1], raster = flatten([art]).find(e => e.kind === 'raster')!
    parseSceneElements(scene.elements)
    assert.equal(art.bounds.width / art.bounds.height, 200 / 450)
    assert.equal(raster.bounds.width / raster.bounds.height, .5)
    assert.equal(art.bounds.x + art.bounds.width, size.width)
    assert.deepEqual(scene.elements[0].children[0].bounds, { x: 0, y: 0, ...size })
  }
  assert.equal(JSON.stringify({ snapshot, library }), original)
  assert.throws(() => assembleBackground(catalog, { fillId: 'foreign', layers: [] }, { width: 800, height: 450 }), /Заливка/)
  assert.throws(() => assembleBackground(catalog, { fillId: null, layers: [{ artworkId: catalog.artworks[0].id, placementId: 'foreign' }] }, { width: 800, height: 450 }), /Графика/)
})

test('background selection uses explicit roles and geometry, excluding text, photos, icons and hidden graphics', () => {
  const { snapshot, library } = backgroundFixture()
  library.components[0].semantics[0].role = 'photo'
  assert.equal(buildBackgroundCatalog(snapshot, library, 'catalog').artworks.length, 0)
  library.components[0].semantics[0].role = 'decoration'
  library.components[0].scene.width = 24; library.components[0].scene.height = 24
  assert.equal(buildBackgroundCatalog(snapshot, library, 'catalog').artworks.length, 0)
  library.components[0].scene.width = 200; library.components[0].scene.height = 450
  snapshot.elements[1].properties.visible = false
  assert.equal(buildBackgroundCatalog(snapshot, library, 'catalog').artworks.length, 0)
  snapshot.elements[1].properties.visible = true
  library.components[0].slots = [{ id: 't', elementId: 't', label: 'Text', defaultText: 'A caption', maxLength: 100, policy: 'fixed-box' }]
  assert.equal(buildBackgroundCatalog(snapshot, library, 'catalog').artworks.length, 0)
})

test('one motif may retain multiple observed placements but not repeat the same placement twice', () => {
  const { snapshot, library } = backgroundFixture(), catalog = buildBackgroundCatalog(snapshot, library, 'test'), art = catalog.artworks[0]
  art.placements.push({ ...art.placements[0], id: 'second', bounds: { ...art.placements[0].bounds, x: 0 } })
  const selection = { fillId: null, layers: art.placements.map(p => ({ artworkId: art.id, placementId: p.id })) }
  assert.equal(assembleBackground(catalog, selection, { width: 800, height: 450 }).elements[0].children.length, 2)
  assert.throws(() => assembleBackground(catalog, { ...selection, layers: [selection.layers[0], selection.layers[0]] }, { width: 800, height: 450 }), /повторяется/)
})

test('gradient fills remain gradients after changing the slide format', () => {
  const { snapshot, library } = backgroundFixture()
  delete snapshot.elements[0].properties.fill
  snapshot.elements[0].properties.gradient = { type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, stops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] }
  const catalog = buildBackgroundCatalog(snapshot, library, 'catalog'), scene = assembleBackground(catalog, catalog.presets[0].selection, { width: 900, height: 900 })
  assert.deepEqual((scene.elements[0].children[0] as { gradient: unknown }).gradient, snapshot.elements[0].properties.gradient)
  assert.equal(catalog.fills[0].name, 'Градиент')
})

test('small decorative strips on slide edges remain reusable without turning inset icons into backgrounds', () => {
  const { snapshot, library } = backgroundFixture(), c = library.components[0]
  // A thin strip is only 3% of the slide, but still belongs to its background.
  const bounds = { x: 0, y: 420, width: 400, height: 30 }
  snapshot.elements[1].properties.bounds = bounds
  Object.assign(c.scene, { width: 400, height: 30 })
  c.scene.elements[0].bounds = { ...bounds, x: 0, y: 0 }
  const catalog = buildBackgroundCatalog(snapshot, library, 'new')
  assert.equal(catalog.artworks.length, 1)
  assert.deepEqual(catalog.artworks[0].placements[0].bounds, bounds)
  assert.equal(catalog.artworks[0].editableParts, false)
  snapshot.elements[1].properties.bounds = { ...bounds, x: 200, y: 200 }
  assert.equal(buildBackgroundCatalog(snapshot, library, 'new').artworks.length, 0)
  snapshot.elements[1].properties.bounds = bounds
  c.semantics[0].role = 'photo'
  assert.equal(buildBackgroundCatalog(snapshot, library, 'new').artworks.length, 0)
})

test('source-colored masks over background artwork keep their occlusion and paint order', () => {
  const { snapshot, library, fill } = backgroundFixture()
  const mask = { ...structuredClone(fill), id: 'cover', name: 'Cover', zIndex: 3, bounds: { x: 600, y: 350, width: 120, height: 100 } }
  snapshot.elements.push({ id: mask.id, name: mask.name, kind: mask.kind, slide: 1, properties: mask as unknown as Record<string, unknown> })
  library.components.push({ ...structuredClone(library.components[0]), id: 'cover-component', name: 'Cover', scene: { width: 120, height: 100, elements: [{ ...mask, bounds: { x: 0, y: 0, width: 120, height: 100 } }] }, source: { slide: 1, rootId: mask.id, elementIds: [mask.id], ancestorIds: [], assetIds: [] } })
  const catalog = buildBackgroundCatalog(snapshot, library, 'test')
  assert.equal(catalog.artworks.length, 2)
  assert.equal(catalog.artworks[1].kind, 'panel')
  const rendered = assembleBackground(catalog, catalog.presets[0].selection, { width: 800, height: 450 })
  assert.equal(rendered.elements[0].children.at(-1)!.name, 'Cover')
  snapshot.elements.at(-1)!.properties.zIndex = 1
  assert.equal(buildBackgroundCatalog(snapshot, library, 'test').artworks.length, 1)
  snapshot.elements.at(-1)!.properties.zIndex = 3
  library.components.at(-1)!.scene.elements[0] = { ...mask, fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } }
  assert.equal(buildBackgroundCatalog(snapshot, library, 'test').artworks.length, 1)
})

test('a semantic viewport keeps the original placement even without a single source root', () => {
  const { snapshot, library, art } = backgroundFixture(), component = library.components[0]
  component.source.rootId = 'semantic-viewport'
  component.scene.elements = [{ id: 'semantic-viewport', name: 'Viewport', kind: 'group', bounds: { x: -600, y: 0, width: 200, height: 450 }, opacity: 1, visible: true, zIndex: 0, rotation: 0, children: [art] }]
  const catalog = buildBackgroundCatalog(snapshot, library, 'catalog'), scene = assembleBackground(catalog, catalog.presets[0].selection, { width: 800, height: 450 })
  assert.equal(catalog.artworks.length, 1)
  assert.deepEqual(scene.elements[0].children[1].bounds, { x: 600, y: 0, width: 200, height: 450 })
})

test('verified vector reconstruction replaces the image leaf without dropping the source mask or offset', () => {
  const { library } = backgroundFixture(), before = JSON.stringify(library)
  const catalog = { results: [{ id: 'r', status: 'ready', candidate: { componentIds: ['c'], assetId: 'image' }, pattern: { width: 240, height: 480, background: null, palette: ['#ffffff'], origin: 'reconstructed', quality: null, parts: [{ id: 'p', primitive: { kind: 'ellipse' }, aspect: 1 }], instances: [{ partId: 'p', x: 20, y: 20, width: 100, height: 100, rotation: 0, color: '#ffffff' }], rules: { gapRatio: 0, rotations: [0], basis: 'observed', allowRecolor: false } } }] } as ReconstructionCatalog
  const result = reconstructedLibrary(library, catalog).components[0]
  assert.equal(result.source.assetIds.length, 0)
  const mask = result.scene.elements[0]
  assert.ok('children' in mask && mask.clipsContent)
  assert.deepEqual(mask.children[0].bounds, { x: -20, y: -10, width: 240, height: 480 })
  assert.equal(mask.children[0].kind, 'group')
  parseSceneElements(result.scene.elements)
  assert.equal(JSON.stringify(library), before)
})
