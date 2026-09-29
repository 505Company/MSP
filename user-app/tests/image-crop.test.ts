import test from 'node:test'
import assert from 'node:assert/strict'
import {fallbackSize,validSourceCrop} from '../vendor/drag/src/formats/pptx/image-fallback'

test('source outsets remain valid for masked images without weakening raster budgets',()=>{
 const crop={l:-.25,r:.25,t:0,b:-.00904}
 assert.equal(validSourceCrop(crop),true)
 assert.deepEqual(fallbackSize({width:100,height:80,crop,ellipse:true}),{width:200,height:160})
 for(const bad of [{...crop,l:NaN},{...crop,b:Infinity},{l:.6,r:.4,t:0,b:0},{...crop,t:1},{l:-1e308,r:-1e308,t:0,b:0}]){
  assert.equal(validSourceCrop(bad),false);assert.throws(()=>fallbackSize({width:100,height:80,crop:bad}))
 }
 assert.throws(()=>fallbackSize({width:3000,height:3000,crop,ellipse:true}),/image-pixel-limit/)
})
