import test from 'node:test'
import assert from 'node:assert/strict'
import {zipSync,strToU8} from 'fflate'
import {fontBytes,extractEmbeddedFonts} from '../lib/uploads/embedded-fonts'
import {sourceFonts} from '../lib/uploads/source-fonts'
import {memoryBucket} from './helpers/memory-bucket'
import type {UploadJob} from '../lib/uploads/domain'
const sfnt=Uint8Array.from([0,1,0,0,0,0,0,0,0,0,0,0])
function eot(){const bytes=new Uint8Array(100+sfnt.length),v=new DataView(bytes.buffer);v.setUint32(0,bytes.length,true);v.setUint32(4,sfnt.length,true);v.setUint16(34,0x504c,true);bytes.set(sfnt,100);return bytes}
function deck(){return zipSync({'ppt/presentation.xml':strToU8('<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:embeddedFontLst><p:embeddedFont><p:font typeface="Embedded Sample"/><p:bold r:id="rId1"/></p:embeddedFont><p:embeddedFont><p:font typeface="External"/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst></p:presentation>'),'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fnt"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="https://example.invalid/font" TargetMode="External"/></Relationships>'),'ppt/fonts/font1.fnt':eot()})}
test('PPTX embedded EOT fonts retain source family/style and reject unsupported containers',()=>{
 const fonts=extractEmbeddedFonts(deck());assert.equal(fonts.length,1);assert.equal(fonts[0].family,'Embedded Sample');assert.equal(fonts[0].style,'Bold');assert.deepEqual(fonts[0].bytes,sfnt)
 for(const offset of [0,4,12,34]){const bad=eot();bad[offset]=255;assert.equal(fontBytes(bad),null)}
 assert.equal(fontBytes(new Uint8Array(20)),null);assert.deepEqual(fontBytes(sfnt),sfnt)
})
test('reopening an existing upload obtains the same embedded fonts without editing its source snapshot',async()=>{
 const {bucket}=memoryBucket(),bytes=deck();await bucket.put('source.pptx',bytes)
 const upload={id:'job',sourceObjectKey:'source.pptx',fileName:'sample.pptx'} as UploadJob
 const first=await sourceFonts(bucket,upload),second=await sourceFonts(bucket,upload)
 assert.deepEqual(first,second);assert.equal(first.fonts.length,1);assert.deepEqual(new Uint8Array(await(await bucket.get('source.pptx'))!.arrayBuffer()),bytes)
})
