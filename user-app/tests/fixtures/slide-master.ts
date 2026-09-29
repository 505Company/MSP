import {backgroundFixture} from './backgrounds'
import type {ElementIR} from '../../vendor/drag/src/core/model'

export function slideMasterFixture(){
 const f=backgroundFixture(),sourceRef={part:'ppt/slideMasters/slideMaster1.xml',shapeId:'logo'}
 const logo:ElementIR={id:'brand',name:'Source brand',kind:'raster',bounds:{x:32,y:408,width:112,height:22},rotation:0,opacity:1,visible:true,zIndex:20,assetId:'brand-image',reason:'source-image',sourceRef}
 f.snapshot.assets.push({id:'brand-image',mime:'image/png',byteLength:1,origins:['ppt/media/brand.png']})
 f.snapshot.elements.push({id:logo.id,slide:1,name:logo.name,kind:logo.kind,properties:logo as unknown as Record<string,unknown>})
 f.library.components.push({id:'brand-component',name:'Source brand',kind:'atom',source:{slide:1,rootId:logo.id,elementIds:[logo.id],ancestorIds:[],assetIds:['brand-image']},scene:{width:112,height:22,elements:[{...logo,bounds:{x:0,y:0,width:112,height:22}}]},slots:[],fixedTextIds:[],issues:[],semantics:[{findingId:'brand-role',name:'Brand',role:'logo',basis:'observed'}]})
 return {...f,logo}
}
