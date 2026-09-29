/** Read-only replay of captured evidence. All API writes are blocked. */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { compileRasterCandidate, rasterRegionSource, validateRasterReply } from '../lib/design-system/refinement-raster.ts'

const folder='outputs/diagnostics/refinement-selection'
const read=async name=>JSON.parse(await readFile(`${folder}/${name}.json`,'utf8'))
const visual=await read('visual'),job=await read('live-card-state'),saved=await read('live-card-candidate'),response=await read('live-card-response')
const uploadId='8b23b119-b4cb-47aa-8e10-b3ecd3b75344',source=rasterRegionSource(visual,job),dimensions=job.tasks[0].raster
const reply=validateRasterReply(JSON.parse(response.content),source,dimensions,'component')
const candidate=await compileRasterCandidate({...saved.catalog,families:[]},source,dimensions,reply,job,uploadId)
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try {
  const page=await browser.newPage()
  await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort())
  await page.goto('http://127.0.0.1:5184/styles')
  const result=await page.evaluate(async({candidate,source,uploadId})=>{
    const {ensureUploadFonts}=await import('/browser/fonts.ts')
    const {scenePreview,graphicPixels,compareGraphicPixels}=await import('/lib/design-system/reconstruction-browser.ts')
    const {prepareRasterRegion}=await import('/browser/refinement-raster.ts')
    const {fitDiagramText}=await import('/lib/design-system/diagram-text-fit.ts')
    await ensureUploadFonts(uploadId)
    const input=await prepareRasterRegion(uploadId,source),original=await graphicPixels(input.dataUrl,input.width,input.height)
    const template=candidate.catalog.families[0].variants[0],elements=template.sourceRegion.elements
    const before=await scenePreview(elements,template.width,template.height,uploadId)
    const calibrated=structuredClone(elements);let fitted=0
    for(const field of elements.filter(e=>e.kind==='text')) {
      const margin=field.fontSize*.5,x=Math.max(0,field.bounds.x-margin),y=Math.max(0,field.bounds.y-margin)
      const bounds={x,y,width:Math.min(original.width-x,field.bounds.width+margin*2),height:Math.min(original.height-y,field.bounds.height+margin*2)}
      const graph={width:original.width,height:original.height,origin:'reconstructed',sourceIds:[],warnings:[],decoration:[],edges:[],nodes:[{id:field.id,kind:'block',bounds,elements:[{...field,bounds:{...field.bounds,x:field.bounds.x-x,y:field.bounds.y-y}}],sourceIds:[]}]}
      const [fit]=await fitDiagramText(graph,original,source.fonts)
      if(!fit||fit.elements.map(e=>e.text).join('').replace(/\s/g,'')!==field.text.replace(/\s/g,''))continue
      fitted++;const index=calibrated.findIndex(e=>e.id===field.id)
      calibrated.splice(index,1,...fit.elements.map(e=>({...e,bounds:{...e.bounds,x:e.bounds.x+x,y:e.bounds.y+y}})))
    }
    const after=await scenePreview(calibrated,template.width,template.height,uploadId)
    return {original:input.dataUrl,before,after,summary:{blocks:candidate.catalog.families.length,textFields:elements.filter(e=>e.kind==='text').length,fitted,before:compareGraphicPixels(original,await graphicPixels(before,original.width,original.height)),after:compareGraphicPixels(original,await graphicPixels(after,original.width,original.height)),published:false,modelCalls:0}}
  },{candidate,source,uploadId})
  for(const name of ['original','before','after'])await writeFile(`${folder}/card-replay-${name}.png`,Buffer.from(result[name].split(',')[1],'base64'))
  await writeFile(`${folder}/card-replay.json`,JSON.stringify(result.summary,null,2))
  console.log(JSON.stringify(result.summary,null,2))
} finally {await browser.close()}
