// Defaults to the saved response. A new paid request requires an explicit flag
// and is refused when evidence already exists; never overwrite a source run.
import fs from 'node:fs/promises'
import {beginModelRun} from '../lib/uploads/model-run'
import {memoryBucket} from '../tests/helpers/memory-bucket'
import {graphicRecognitionPrompt} from '../lib/design-system/reconstruction'
import {modelSchema,recognitionSchema,RECONSTRUCTION_VERSION} from '../lib/design-system/reconstruction-contract'
const dir='outputs/diagnostics/reconstruction',prefix='raster-vk-14',pointer=`${dir}/model/${prefix}/current.json`
const saved=await fs.readFile(pointer,'utf8').catch(()=>null)
if(saved){
 if(process.argv.includes('--request'))throw Error('Диагностический запрос уже выполнен; используйте сохранённый ответ')
 const {runId}=JSON.parse(saved),run=JSON.parse(await fs.readFile(`${dir}/model/${prefix}/runs/${runId}.json`,'utf8')),r=recognitionSchema.parse(run.result)
 await fs.writeFile(`${dir}/raster-recognition.json`,JSON.stringify(r,null,2));console.log({kind:r.kind,sourceRunId:runId,liveRequests:0})
}else{
 if(!process.argv.includes('--request'))throw Error('Сохранённого ответа нет. Новый запрос требует отдельного разрешения и --request')
 const image=JSON.parse(await fs.readFile(`${dir}/raster-input.json`,'utf8')),{bucket,data}=memoryBucket()
 const task={messages:[{role:'system' as const,content:graphicRecognitionPrompt},{role:'user' as const,content:[{type:'text' as const,text:JSON.stringify({imageWidth:image.width,imageHeight:image.height,suppliedFonts:['Arial','Play']})},{type:'image_url' as const,image_url:{url:image.url}}]}],schema:modelSchema(recognitionSchema),schemaName:'editable_graphic',maxTokens:10000}
 const config={apiKey:process.env.INTELION_API_KEY,baseUrl:process.env.INTELION_API_BASE_URL,model:process.env.INTELION_MODEL,timeoutMs:300000},run=await beginModelRun({bucket,prefix,version:RECONSTRUCTION_VERSION,scope:{diagnostic:true,source:'VK-14-raster-no-native-objects'},task,config,validate:raw=>recognitionSchema.parse(raw)})
 try{await run.execute?.();console.log({kind:run.run.result?.kind,runId:run.run.id})}
 finally{for(const [key,entry] of data){const path=`${dir}/model/${key}`;await fs.mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await fs.writeFile(path,entry.value,{flag:'wx'})}}
}
