import test from 'node:test'
import assert from 'node:assert/strict'
import {googleFont,googleFontUrl,googleFontQuery,googleFontSources} from '../lib/fonts/google'
import {memoryBucket} from './helpers/memory-bucket'
test('Google font requests constrain hosts and never contain presentation text',()=>{
 assert.equal(new URL(googleFontUrl('Play','SemiBold')).searchParams.get('family'),'Play:ital,wght@0,600')
 const url=new URL(googleFontUrl('Noto Sans','Bold Italic'));assert.equal(url.origin,'https://fonts.googleapis.com');assert.deepEqual([...url.searchParams.keys()],['family','display']);assert.equal(url.searchParams.get('family'),'Noto Sans:ital,wght@1,700')
 assert.equal(googleFontQuery.safeParse({family:'Font&text=private'}).success,false)
 for(const url of ['http://fonts.gstatic.com/s/a.ttf','https://example.com/s/a.ttf','https://fonts.gstatic.com@evil.test/s/a.ttf'])assert.throws(()=>googleFontSources(`@font-face {src: url(${url});}`))
})
test('font downloads and negative lookups are cached; transient failures can recover',async t=>{
 const {bucket}=memoryBucket();let calls=0
 t.mock.method(globalThis,'fetch',async (input:unknown)=>{calls++;return String(input).startsWith('https://fonts.googleapis.com')?new Response('@font-face { src: url(https://fonts.gstatic.com/s/a.ttf); unicode-range: U+0-FF, U+0400-045F; }'):new Response(Uint8Array.from([0,1,0,0,0,0,0,0,0,0,0,0]))})
 const first=await googleFont(bucket,{family:'Noto Sans',style:'Regular'});assert.equal(first.files.length,1);assert.equal(first.files[0].unicodeRange,'U+0-FF, U+0400-045F')
 assert.deepEqual(await googleFont(bucket,{family:'Noto Sans',style:'Regular'}),first);assert.equal(calls,2)
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:400})})
 assert.equal((await googleFont(bucket,{family:'Private Brand',style:'Regular'})).files.length,0);await googleFont(bucket,{family:'Private Brand',style:'Regular'});assert.equal(calls,3)
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('offline')})
 await assert.rejects(()=>googleFont(bucket,{family:'Roboto',style:'Regular'}));await assert.rejects(()=>googleFont(bucket,{family:'Roboto',style:'Regular'}));assert.equal(calls,5)
})
