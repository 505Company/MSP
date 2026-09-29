// Read-only, opt-in local corpus audit. No model calls or application writes.
import {writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build,stop} from 'esbuild'
import {chromium} from '@playwright/test'

const [source,dragRoot,upload,output='outputs/diagnostics/pptx-drag-parity']=process.argv.slice(2)
if(!source||!dragRoot||!upload)throw Error('Usage: check-pptx-drag-parity.mjs SOURCE_PPTX DRAG_REPOSITORY UPLOAD_ID [OUTPUT]')
const origin='http://127.0.0.1:5184',folder=resolve(output)
await mkdir(folder,{recursive:true})
const bundle=await build({stdin:{contents:`
import {PptxCatalogReader as WebReader} from './vendor/drag/src/formats/pptx/catalog';
import {readSlide as webSlide} from './vendor/drag/src/formats/pptx/scene';
import {renderSlidePreview as webPreview} from './vendor/drag/src/formats/pptx/preview';
import {PptxCatalogReader as DragReader} from ${JSON.stringify(resolve(dragRoot,'src/formats/pptx/catalog.ts'))};
import {readSlide as dragSlide} from ${JSON.stringify(resolve(dragRoot,'src/formats/pptx/scene.ts'))};
import {renderSlidePreview as dragPreview} from ${JSON.stringify(resolve(dragRoot,'src/formats/pptx/preview.ts'))};
import {ensureSceneFonts} from './browser/fonts';
export {WebReader,DragReader,webSlide,dragSlide,webPreview,dragPreview,ensureSceneFonts};`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Parity',write:false})
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage()
 await page.route('**/__parity_source',route=>route.fulfill({contentType:'application/octet-stream',path:resolve(source)}))
 await page.goto(`${origin}/api/uploads/${upload}/fonts`)
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 const count=await page.evaluate(async()=>{
  const bytes=new Uint8Array(await(await fetch('/__parity_source')).arrayBuffer()),api=window.Parity
  window.parityReaders={web:new api.WebReader(bytes,new DOMParser()),drag:new api.DragReader(bytes,new DOMParser())}
  window.parityPages={web:window.parityReaders.web.analyze().pages,drag:window.parityReaders.drag.analyze().pages}
  return {web:window.parityPages.web.length,drag:window.parityPages.drag.length}
 })
 if(count.web!==count.drag)throw Error('Different page counts')
 const checks=[]
 for(let i=0;i<count.web;i++){
  const result=await page.evaluate(async index=>{
   const api=window.Parity,walk=nodes=>nodes.flatMap(n=>[n,...('children'in n?walk(n.children):[])]),results={}
   const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')
   for(const kind of ['web','drag']){
    const ir=await api[kind+'Slide'](window.parityReaders[kind],window.parityPages[kind][index]),nodes=walk(ir.elements),fonts=await api.ensureSceneFonts(ir.elements)
    const preview=await api[kind+'Preview'](ir,1024)
    const assets=await Promise.all((ir.assets??[]).map(async a=>({id:a.id,bytes:a.bytes.length,sha256:await hash(a.bytes)})))
    results[kind]={width:ir.width,height:ir.height,nodes:nodes.length,texts:nodes.filter(n=>n.kind==='text').map(n=>({id:n.id,text:n.text,font:n.fontFamily,style:n.fontStyle,size:n.fontSize})),tables:nodes.filter(n=>n.tableGrid).map(n=>({id:n.id,height:n.bounds.height,grid:n.tableGrid})),assets,warnings:ir.degradations,fonts,preview,ir:{...ir,assets:undefined}}
   }
   return results
  },i)
  for(const kind of ['web','drag']){
   await writeFile(`${folder}/${kind==='web'?'fresh':'drag-preview'}-s${String(i+1).padStart(2,'0')}.png`,Buffer.from(result[kind].preview.split(',')[1],'base64'))
   if([11,14,15,38,39,40].includes(i+1))await writeFile(`${folder}/${kind}-ir-s${i+1}.json`,JSON.stringify(result[kind].ir))
   delete result[kind].preview;delete result[kind].ir
  }
  const check={slide:i+1,...result,textsMatch:JSON.stringify(result.web.texts)===JSON.stringify(result.drag.texts),assetBytesMatch:JSON.stringify(result.web.assets)===JSON.stringify(result.drag.assets)}
  checks.push(check);console.log(JSON.stringify({slide:i+1,web:result.web.nodes,drag:result.drag.nodes,textsMatch:check.textsMatch,assetBytesMatch:check.assetBytesMatch}))
  await writeFile(`${folder}/drag-runtime-parity.json`,JSON.stringify({source,dragRoot,count,checks},null,2))
 }
}finally{await browser.close();stop()}
