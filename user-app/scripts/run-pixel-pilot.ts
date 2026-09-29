import { mkdir, open, unlink, readFile, writeFile, readdir } from 'node:fs/promises'
import { chromium, type Browser } from '@playwright/test'
import { inventory, diagnosticBucket, digest, loadJson, saveJson } from './pixel-pilot-store'
import { pixelDesignerTask, pixelDesignerRecoveryTask, pixelDesignerReasonedTask, pixelTypesetterTask, pixelReviewTask, pixelClarification, pixelRecipeV2, pixelReviewSchema, pixelGenerationProfile, withPixelGenerationProfile, type PixelReview } from '../lib/presentations/pixel-task'
import { validatePixelBrief, validatePixelPlan, pixelComponentCatalog, type PixelEnvironment, type PixelBrief, type PixelPlan } from '../lib/presentations/pixel-contract'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import { beginModelRun, readModelRun } from '../lib/uploads/model-run'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { modelIdentity, structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { routeraiConfig } from '../lib/uploads/routerai'
import type { PixelReport } from '../browser/pixel-layout'

const output = 'outputs/diagnostics/qwen-pixel-service', origin = 'http://127.0.0.1:5184', request = process.argv.includes('--request')
const extensionArg = process.argv.find(arg => arg.startsWith('--extend-limit='))
const extension = extensionArg ? Number(extensionArg.split('=')[1]) : null
const routerai = process.argv.includes('--routerai')
const recommended = process.argv.includes('--recommended') || routerai
const reasoned = process.argv.includes('--reasoned') || recommended
const auditOnly = process.argv.includes('--audit-only')
const resumeRouteraiTypesetter = process.argv.includes('--resume-routerai-typesetter')
if (resumeRouteraiTypesetter && (!routerai || !request || auditOnly || extension !== null || process.argv.includes('--prepare'))) throw Error('RouterAI typesetter continuation requires --routerai --request without preparation, audit or allowance changes')
const escapes = (v: unknown) => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
if (auditOnly) {
  if (request || extension !== null || reasoned || process.argv.includes('--prepare')) throw Error('Audit-only cannot modify the model run or its allowance')
  await writeAudit()
  console.log(JSON.stringify({ auditOnly: true, modelCalls: 0, output: `${output}/index.html` }))
} else await run()

async function run() {
const snapshot = await loadJson(`${output}/source.json`)
if (!snapshot) throw Error('Prepare the immutable source snapshot first')
await mkdir(output, { recursive: true })
const lock = await open(`${output}/running.lock`, 'wx'), before = inventory(), bucket = diagnosticBucket(output)
const protectedRows = (rows: typeof before) => rows.filter(r => !/^(processing-worker|fonts)\//.test(r.key))
const protectedHash = digest(protectedRows(before))
const rounds: { round: number; plan: PixelPlan; report: Omit<PixelReport, 'preview'>; review?: PixelReview }[] = []
let brief: PixelBrief | undefined, failure: string | undefined
let manifest = await loadJson(`${output}/experiment.json`)
let browser: Browser | undefined
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
  const page = await browser.newPage({viewport:{width:1920,height:1080}}), blocked: string[] = [], browserErrors: string[] = []
  page.on('pageerror',e=>browserErrors.push(e.message))
  await page.route('**/*',route=>{
    const r=route.request(),u=new URL(r.url())
    if(u.origin===origin&&['GET','HEAD'].includes(r.method())||['data:','blob:'].includes(u.protocol))return route.continue()
    blocked.push(`${r.method()} ${u.origin}${u.pathname}`);return route.abort('blockedbyclient')
  })
  await page.exposeFunction('__mspCaptureLayout',async(id:string)=>'data:image/png;base64,'+(await page.locator(`[data-layout-capture="${id}"]`).screenshot({animations:'disabled'})).toString('base64'))
  await page.goto(`${origin}/processing-worker`)
  const fontTokens = await page.evaluate(async input => {
    const path='/browser/layout-fonts.ts'
    const {prepareLayoutFonts}=await import(path) as typeof import('../browser/layout-fonts')
    return (await prepareLayoutFonts(input)).fontTokens
  }, snapshot.input)
  const env: PixelEnvironment={input:snapshot.input,compositions:snapshot.compositions,fontTokens}
  const catalog=pixelComponentCatalog(env)
  await saveJson(`${output}/catalog.json`,{catalogId:snapshot.catalogId,fontTokens,fonts:env.input.fonts,colors:env.input.colors,components:catalog,compositions:env.compositions.map(t=>({id:t.id,name:t.name,style:t.style,config:t.config,members:t.children?.map(c=>c.id)}))})
  await saveJson(`${output}/recipe-v2.json`,pixelRecipeV2)
  let libraryPreview: string
  const atlas = await loadJson(`${output}/atlas.json`)
  if (atlas?.inputHash === digest(snapshot)) libraryPreview = 'data:image/png;base64,'+(await readFile(`${output}/library.png`)).toString('base64')
  else {
    if (manifest) throw Error('A started pilot must retain its original library preview')
    await page.evaluate(async ({input,ids})=>{
      const path='/lib/design-system/editable-render.ts',hydratePath='/lib/design-system/editable-hydrate.ts'
      const {renderEditableHtml}=await import(path) as typeof import('../lib/design-system/editable-render')
      const {hydrateEditableHtml}=await import(hydratePath) as typeof import('../lib/design-system/editable-hydrate')
      const host=document.createElement('main');host.id='pixel-atlas';host.style.cssText='position:absolute;left:0;top:0;width:1600px;background:white;z-index:9999;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:24px;box-sizing:border-box;font:14px system-ui;color:#222;'
      for(const id of ids){const t=input.components.find(t=>t.id===id)!;const item=document.createElement('section');item.style.cssText='height:300px;overflow:hidden;position:relative;border-bottom:1px solid #ddd;';const label=document.createElement('p');label.textContent=`${t.id} | ${t.name}`;item.appendChild(label);const box=document.createElement('div'),scale=Math.min(340/t.width,245/t.height);box.style.cssText=`width:${t.width}px;transform:scale(${scale});transform-origin:top left;`;box.innerHTML=renderEditableHtml(t,t.data);item.appendChild(box);host.appendChild(item)}
      document.body.appendChild(host);await hydrateEditableHtml(host,{loadFonts:false});await document.fonts.ready
      for(const n of host.querySelectorAll('image')){try{const im=new Image();im.src=n.getAttribute('href')??'';await im.decode()}catch{throw Error('Library preview artwork failed')}}
    },{input:env.input,ids:catalog.map(c=>c.id)})
    const png=await page.locator('#pixel-atlas').screenshot({animations:'disabled'})
    await writeFile(`${output}/library.png`,png);libraryPreview='data:image/png;base64,'+png.toString('base64')
    await page.evaluate(()=>document.getElementById('pixel-atlas')?.remove())
    await saveJson(`${output}/atlas.json`,{inputHash:digest(snapshot),note:'Source samples, not generated slide content. Native HTML rendered with the available browser fonts; font availability is provided separately to Qwen.'})
  }
  const firstTask=pixelDesignerTask(env,libraryPreview)
  const identity={version:'qwen-pixel-service-1',sourceHash:digest(snapshot),designerTaskHash:digest(firstTask),recipeHash:digest(pixelRecipeV2),model:snapshot.model,objective:'Custom user content: Qwen designer selects library styles/components/composition, Qwen typesetter authors exact pixel plan, executor has no layout choices. All inputs/replies and measurements retained.'}
  if(!manifest){manifest={identity,maxRequests:12,used:0,reservations:[],protectedHash,createdAt:new Date().toISOString()};await saveJson(`${output}/experiment.json`,manifest)}
  if(digest(manifest.identity)!==digest(identity)||![12,24,36].includes(manifest.maxRequests)||manifest.used!==manifest.reservations.length)throw Error('Experiment identity changed; no budget reset')
  if(extension !== null){
    if(![24,36].includes(extension)||extension<manifest.maxRequests)throw Error('Only the user-authorized 2x/3x extension is allowed')
    if(extension>manifest.maxRequests){
      manifest.allowanceEvents??=[]
      manifest.allowanceEvents.push({at:new Date().toISOString(),previous:manifest.maxRequests,limit:extension,usedUnchanged:manifest.used,reason:'User explicitly authorized increasing the current allowance two to three times on 2026-09-27.'})
      manifest.maxRequests=extension;await saveJson(`${output}/experiment.json`,manifest)
    }
  }
  // Other chats may update the library between invocations; the frozen input
  // remains unchanged, and each invocation audits all writes during its run.
  const config=routerai?routeraiConfig(process.env):{apiKey:process.env.INTELION_API_KEY,baseUrl:snapshot.model.baseUrl,model:snapshot.model.model,timeoutMs:recommended?900000:reasoned?600000:300000}
  if(routerai){
    const connection={model:modelIdentity(config),sourceHash:identity.sourceHash,allowance:'Existing experiment.json; no reset',sourceSnapshotChanged:false}
    const path=`${output}/routerai-connection.json`,saved=await loadJson(path)
    if(saved&&digest(saved)!==digest(connection))throw Error('Saved RouterAI connection changed; no silent provider substitution')
    if(!saved)await saveJson(path,connection)
  }
  if(recommended)await saveJson(`${output}/generation-profile${routerai?'-routerai':''}.json`,{...pixelGenerationProfile,requestParameters:structuredGeneration(withPixelGenerationProfile(firstTask),config),maxTokensMeaning:'Requested output allowance; provider accounting of reasoning and final answer must be verified from usage. No claim that all settings were applied without a completed response.',sourceHash:identity.sourceHash,oldPromptsChanged:false})
  let connectivityChecked = false
  const execute=async<T>(prefix:string,task:StructuredRequest,validate:(raw:unknown)=>T,clarify=true):Promise<T>=>{
    const requestPath=`${output}/${prefix}-request.json`,savedRequest=await loadJson(requestPath)
    if(savedRequest && digest(savedRequest)!==digest(task))throw Error(`Prepared request changed: ${prefix}`)
    if(!savedRequest)await saveJson(requestPath,task)
    const previous=await readModelRun(bucket,prefix)
    if(previous){
      const saved=await loadJson(`${output}/model/${prefix}/inputs/${previous.inputHash}.json`)
      if(digest(saved.task)!==digest(task)||digest(saved.model)!==digest(modelIdentity(config)))throw Error(`Saved request or provider changed: ${prefix}`)
      if(previous.status==='complete')return validate(previous.result)
      throw Error(`Retained failed/interrupted model stage ${prefix}; no automatic restart`)
    }
    if(!request)throw Error(`Prepared ${prefix}; --request is required for a new model call`)
    if(recommended && !routerai && !connectivityChecked){
      const started=Date.now(),check:{at:string;modelRequests:0;http?:number;modelPresent?:boolean;error?:string;elapsedMs?:number}={at:new Date().toISOString(),modelRequests:0}
      try{
        const response=await fetch(`${config.baseUrl}/models`,{headers:{Authorization:`Bearer ${config.apiKey}`},redirect:'manual',signal:AbortSignal.timeout(20000)})
        check.http=response.status
        if(response.ok){const data=await response.json() as {data?:{id:string}[]};check.modelPresent=data.data?.some(m=>m.id===config.model)??false}
        else await response.body?.cancel()
      }catch(error){const value=error as {name?:string;cause?:{code?:string}};check.error=value.cause?.code??value.name??'network'}
      check.elapsedMs=Date.now()-started
      await saveJson(`${output}/network-checks/${crypto.randomUUID()}.json`,check)
      console.log(JSON.stringify({stage:'connectivity',...check}))
      if(check.http!==200 || !check.modelPresent)throw Error('Intelion preflight failed; the recommended request is prepared but not sent. No model allowance was reserved.')
      connectivityChecked=true
    }
    const validateSafe=(raw:unknown)=>{try{return validate(raw)}catch(e){if(e instanceof SemanticValidationError)throw e;throw new SemanticValidationError([String(e).slice(0,3000)])}}
    const started=await beginModelRun({bucket,prefix,task,config,version:identity.version,scope:{diagnostic:true,catalogId:snapshot.catalogId,sourceHash:identity.sourceHash},validate:validateSafe,
      ...(clarify?{clarification:{version:'pixel-clarification-1',request:(reply:{content:string},issues:string[])=>pixelClarification(task,reply.content,issues)}}:{}),
      beforeRequest:async()=>{if(manifest.used>=manifest.maxRequests)throw Error('Pixel pilot allowance exhausted');manifest.used++;manifest.reservations.push({prefix,at:new Date().toISOString()});await saveJson(`${output}/experiment.json`,manifest);console.log(JSON.stringify({stage:prefix,reserved:manifest.used,limit:manifest.maxRequests}))},
    })
    await started.execute?.()
    if(started.run.status!=='complete')throw Error(JSON.stringify(started.run.error))
    await saveJson(`${output}/${prefix}-response.json`,started.run.result)
    return started.run.result!
  }
  try {
    if(process.argv.includes('--prepare')){
      if(recommended){const task=withPixelGenerationProfile(pixelDesignerReasonedTask(env,libraryPreview)),path=`${output}/01-designer-${routerai?'routerai':'recommended'}-1-request.json`,saved=await loadJson(path);if(saved&&digest(saved)!==digest(task))throw Error('Prepared recommended request changed');if(!saved)await saveJson(path,task)}
      console.log(JSON.stringify({prepared:true,components:catalog.length,compositions:env.compositions.length,fontTokens,modelCalls:0}));
    }
    else {
      const oldDesigner = await readModelRun(bucket, '01-designer')
      const recoverDesigner = oldDesigner?.status === 'failed' && ['QWEN_TRUNCATED', 'QWEN_INVALID_JSON'].includes(oldDesigner.error?.code ?? '')
      let designerPrefix = recoverDesigner ? '01-designer-recovery-1' : '01-designer'
      let designerTask = recoverDesigner ? pixelDesignerRecoveryTask(env, libraryPreview, { runId: oldDesigner.id, code: oldDesigner.error!.code }) : firstTask
      if(reasoned){designerPrefix='01-designer-reasoned-1';designerTask=pixelDesignerReasonedTask(env,libraryPreview)}
      if(recommended){designerPrefix='01-designer-recommended-1';designerTask=withPixelGenerationProfile(designerTask)}
      if(routerai)designerPrefix='01-designer-routerai-1'
      const savedDesigner = await readModelRun(bucket, designerPrefix)
      if (!reasoned && savedDesigner?.status === 'complete') {
        try { validatePixelBrief(savedDesigner.result, env, layoutStates.map(s => s.id)) }
        catch (error) {
          if (!(error instanceof SemanticValidationError)) throw error
          await saveJson(`${output}/designer-revalidation-1.json`, { sourceRunId: savedDesigner.id, validation: 'independent-percent-cards-and-explicit-placement-1', issues: error.issues, previousResponseChanged: false })
          designerTask = pixelClarification(designerTask, JSON.stringify(savedDesigner.result), error.issues)
          designerTask.messages.push({ role: 'user', content: 'Исправь дизайнерское решение самостоятельно. Совместимость библиотечной карточки проверяется для отдельной пары число/подпись, а не для всего слайда сразу. Несколько карточек и обычные типографические группы можно комбинировать. Каждая карточка отдельный group с component и полными fields. Не выдавай общую типографику за использование библиотеки. Пользовательское пространственное указание обязательно; авторское состояние можно адаптировать. Сохрани краткость брифа.' })
          designerPrefix = '01-designer-semantic-1'
        }
      }
      brief=await execute(designerPrefix,designerTask,raw=>validatePixelBrief(raw,env,layoutStates.map(s=>s.id)))
      await saveJson(`${output}/${designerPrefix}-response.json`,brief)
      await saveJson(`${output}/designer-selected.json`,{prefix:designerPrefix,briefHash:digest(brief)})
      const briefHash=digest(brief)
      console.log(JSON.stringify({stage:'designer-complete',composition:brief.compositionId,compositionUse:brief.compositionUse,components:brief.groups.map(g=>({group:g.id,id:g.component?.id??null}))}))
      let feedback: Parameters<typeof pixelTypesetterTask>[3]
      let offset = routerai ? 12 : recommended ? 9 : reasoned ? 6 : designerPrefix === '01-designer-semantic-1' ? 3 : 0
      if (resumeRouteraiTypesetter) {
        const failed = await readModelRun(bucket, '02-typesetter-13')
        if (!failed || failed.status !== 'failed' || failed.error?.code !== 'QWEN_INCOMPLETE' || failed.model.provider !== 'routerai') throw Error('No retained incomplete RouterAI typesetter attempt to continue')
        const previousInput = await loadJson(`${output}/model/02-typesetter-13/inputs/${failed.inputHash}.json`)
        const currentTask = withPixelGenerationProfile(pixelTypesetterTask(env, brief, briefHash))
        if (digest(previousInput?.task) !== digest(currentTask) || digest(previousInput?.model) !== digest(modelIdentity(config))) throw Error('Continuation must retain the original typesetter input and provider')
        const continuation = { sourceRunId: failed.id, sourceRunStatus: failed.status, sourceError: failed.error.code, sourceInputHash: failed.inputHash, briefHash, firstAttempt: 14, maxRounds: 3, originalRunChanged: false, allowance: 'Existing experiment.json; no reset', reason: 'Explicit bounded continuation after a terminal provider response; diagnostic preservation fixed, generation settings and content unchanged.' }
        const path = `${output}/routerai-typesetter-continuation-1.json`, saved = await loadJson(path)
        if (saved && digest(saved) !== digest(continuation)) throw Error('Saved RouterAI continuation changed')
        if (!saved) await saveJson(path, continuation)
        offset = 13
      }
      const previousRounds = await loadJson(`${output}/rounds.json`) as typeof rounds | null
      rounds.push(...previousRounds?.filter(r => r.round <= offset) ?? [])
      for(let round=0;round<3;round++){
        const attempt = offset + round + 1
        const prefix=`02-typesetter-${attempt}`
        let task=pixelTypesetterTask(env,brief,briefHash,feedback)
        if(recommended)task=withPixelGenerationProfile(task)
        else if(reasoned){task.thinking=true;task.maxTokens=20000}
        const plan=await execute(prefix,task,raw=>validatePixelPlan(raw,brief!,briefHash,env))
        await saveJson(`${output}/${prefix}-response.json`,plan)
        const planHash=digest(plan)
        const rendered=await page.evaluate(async({env,brief,plan,planHash})=>{
          const path='/browser/pixel-layout.ts',fontPath='/browser/layout-fonts.ts'
          const{prepareLayoutFonts}=await import(fontPath)as typeof import('../browser/layout-fonts')
          const fonts=await prepareLayoutFonts(env.input)
          if(env.fontTokens.some(id=>!fonts.fontTokens.includes(id)))throw Error('Frozen font availability changed before rendering')
          const{renderPixelLayout}=await import(path)as typeof import('../browser/pixel-layout')
          return renderPixelLayout(env,brief,plan,planHash)
        },{env,brief,plan,planHash})
        const {preview,...report}=rendered
        await writeFile(`${output}/slide-attempt-${attempt}.png`,Buffer.from(preview.split(',')[1],'base64'))
        await saveJson(`${output}/03-measurements-${attempt}.json`,report)
        const entry: typeof rounds[number] = { round: attempt, plan, report }
        rounds.push(entry);await saveJson(`${output}/rounds.json`,rounds)
        let review:PixelReview|undefined
        if(report.passed){
          let reviewTask=pixelReviewTask(env,brief,plan,rendered)
          if(reasoned){reviewTask.thinking=true;reviewTask.maxTokens=8000;reviewTask.messages.push({role:'user',content:'Не путай краткую пересказанную подпись с обрезанием. Сверь конкретное место на PNG с полным текстом и измерениями. Если заявляешь потерю, назови действительно отсутствующие символы/слова; одинаковые строки до/после не являются доказательством дефекта. При этом технический PASS не доказывает композиционного качества: проверь расположение карточек, ритм, читаемость и выполнение брифа.'})}
          if(recommended)reviewTask=withPixelGenerationProfile(reviewTask)
          review=await execute(`04-review-${attempt}`,reviewTask,raw=>{const r=pixelReviewSchema.parse(raw);if((r.verdict==='pass')!==!r.issues.length)throw new SemanticValidationError(['inconsistent-review-verdict']);return r})
        }
        entry.review=review
        await saveJson(`${output}/rounds.json`,rounds)
        console.log(JSON.stringify({round:attempt,fit:report.passed,geometryUnchanged:report.geometryUnchanged,issues:report.issues,review}))
        if(report.passed&&review?.verdict==='pass')break
        feedback={plan,report,preview,review}
      }
    }
  } catch(e){failure=String(e);console.log(JSON.stringify({failure}))}
  const after=inventory(), unchanged=digest(protectedRows(after))===protectedHash
  const selected=rounds.at(-1)
  await saveJson(`${output}/result.json`,{sourceHash:identity.sourceHash,catalogId:snapshot.catalogId,...(routerai?{connection:modelIdentity(config)}:{}),used:manifest.used,limit:manifest.maxRequests,unchanged,protectedHash,protectedCount:protectedRows(before).length,browserErrors,blocked,failure,selectedRound:selected?.round,passed:!!selected?.report.passed&&selected.review?.verdict==='pass',geometryUnchanged:selected?.report.geometryUnchanged,manualSlideEdits:false,productionProjectChanged:false})
  await saveJson(`${output}/preservation.json`,{beforeHash:protectedHash,afterHash:digest(protectedRows(after)),unchanged,changed:protectedRows(before).filter(r=>!after.some(a=>a.key===r.key&&a.blob_id===r.blob_id)).map(r=>r.key),added:protectedRows(after).filter(r=>!before.some(a=>a.key===r.key)).map(r=>r.key)})
  await writeAudit()
  if(failure||!unchanged||browserErrors.length||blocked.length||!process.argv.includes('--prepare')&&(!selected?.report.passed||selected.review?.verdict!=='pass'))process.exitCode=1
}finally{await browser?.close();await lock.close();await unlink(`${output}/running.lock`)}
}

async function writeAudit(){
  const manifest = await loadJson(`${output}/experiment.json`), result = await loadJson(`${output}/result.json`)
  const rounds = (await loadJson(`${output}/rounds.json`) ?? []) as { round: number; plan: PixelPlan; report: Omit<PixelReport, 'preview'>; review?: PixelReview }[]
  const selection = await loadJson(`${output}/designer-selected.json`)
  const brief = (selection ? await loadJson(`${output}/${selection.prefix}-response.json`) : null) as PixelBrief | null
  const failure = result?.failure
  const files=(await readdir(output)).filter(f=>/^0[124].*-(request|response)\.json$/.test(f)).sort()
  const links:string[]=[]
  for(const file of files){const value=await loadJson(`${output}/${file}`),md=file.replace(/\.json$/,'.md');let body=`# ${file}\n\n`
    if(file.endsWith('-request.json')){body+=`Schema: ${value.schemaName}; maxTokens: ${value.maxTokens}.\n\n`;for(const[m,message]of value.messages.entries()){body+=`## Message ${m+1}: ${message.role}\n\n`;const contents=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content;for(const c of contents){if(c.type==='image_url')body+=`Image supplied to model; exact data URL retained in [request JSON](${file}).\n\n`;else{let text=c.text;try{text=JSON.stringify(JSON.parse(text),null,2)}catch{/* Natural-language system prompt. */}body+=`\`\`\`text\n${text}\n\`\`\`\n\n`}}}body+=`## Exact response schema\n\n\`\`\`json\n${JSON.stringify(value.schema,null,2)}\n\`\`\`\n`}
    else body+=`\`\`\`json\n${JSON.stringify(value,null,2)}\n\`\`\`\n`
    await writeFile(`${output}/${md}`,body);links.push(`<li><a href="${md}">${escapes(md)}</a> · <a href="${file}">JSON</a></li>`)
  }
  // Include all immutable clarification prompts/replies, not just the accepted answer.
  const walk=async(path:string):Promise<string[]>=>{let result:string[]=[];for(const e of await readdir(path,{withFileTypes:true}).catch(()=>[])){if(e.isDirectory())result=result.concat(await walk(`${path}/${e.name}`));else if(e.name.endsWith('.json'))result.push(`${path}/${e.name}`)}return result}
  const history=await walk(`${output}/model`)
  const historyLinks=history.filter(f=>/\/(inputs|responses|clarifications|runs)\//.test(f)).map(f=>{const p=f.slice(output.length+1);return `<li><a href="${p}">${escapes(p)}</a></li>`}).join('')
  const revalidation = await loadJson(`${output}/designer-revalidation-1.json`)
  const rejectedRunPath = history.find(f => f.endsWith(`/runs/${revalidation?.sourceRunId}.json`))
  const rejectedRun = rejectedRunPath ? await loadJson(rejectedRunPath) : null
  const rejectedBriefHash = rejectedRun?.result ? digest(rejectedRun.result) : null
  const final=rounds.find(r=>result?.passed&&r.round===result.selectedRound)??[...rounds].reverse().find(r=>r.report.passed)??rounds.at(-1)
  const slide = (r: typeof rounds[number]) => `<section><h2>Попытка ${r.round}${result?.passed&&r.round===result.selectedRound?'':' · черновик, не принят'}</h2>${r.plan.briefHash === rejectedBriefHash ? '<p>Бриф впоследствии отклонён: вместо двух библиотечных карточек справа выбрана обычная типографика снизу. Технический PASS не означает выполнения ТЗ.</p>' : brief && r.plan.briefHash !== digest(brief) ? '<p>Изображение относится к прежнему брифу.</p>' : ''}<a href="slide-attempt-${r.round}.png"><img class="slide" src="slide-attempt-${r.round}.png" alt="Попытка ${r.round}"></a><p>Измерения: ${r.report.passed?'PASS':'FAIL'}; исполнение численного плана без изменений: ${r.report.geometryUnchanged?'да':'нет'}; визуальное ревью: ${r.review?.verdict??'не запрашивалось'}.</p><p>${escapes(r.report.issues.join('\n'))}</p><p>${escapes(r.review?.observation??'')}</p><a href="03-measurements-${r.round}.json">Полные измерения</a></section>`
  const slides=final?slide(final)+(rounds.length>1?`<details><summary>Остальные изображения (${rounds.length-1})</summary>${rounds.filter(r=>r!==final).map(slide).join('')}</details>`:''):'<p>Изображений пока нет.</p>'
  const coords=final?.plan.texts.map(t=>{const r=final.plan.regions.find(r=>r.id===t.regionId)!;return `<tr><td>${escapes(t.id)}</td><td>${escapes(t.fragments.join(', '))}</td><td>${r.box.x+t.box.x}</td><td>${r.box.y+t.box.y}</td><td>${t.box.width}</td><td>${t.box.height}</td><td>${t.fontSize}</td><td>${t.lineHeight}</td><td>${escapes(t.fontToken)}</td></tr>`}).join('')??''
  const selected=(brief && digest(brief)===rejectedBriefHash?'<li>Этот бриф отклонён последующей проверкой. Новый принятый выбор ещё не получен.</li>':'')+(brief?.groups.map(g=>`<li>${escapes(g.id)}: ${escapes(g.component?.id??'Обычная типографика из токенов')} · ${escapes(g.appearance)}</li>`).join('')??'')
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Qwen: дизайнер и верстальщик</title><style>*{box-sizing:border-box}body{margin:0;color:#202227;background:#f3f4f6;font:16px/1.5 system-ui;letter-spacing:0}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:22px;margin-top:40px}h3{font-size:18px}.slide{display:block;width:100%;aspect-ratio:16/9;border:1px solid #d2d5da;background:white}section{padding-bottom:32px;border-bottom:1px solid #d2d5da}a{color:#085db3;overflow-wrap:anywhere}p{white-space:pre-wrap}table{border-collapse:collapse;width:100%;font:14px/1.4 monospace}td,th{text-align:left;padding:8px;border-bottom:1px solid #d2d5da}summary{cursor:pointer}li{margin-bottom:8px}</style><main><h1>Qwen: дизайнер → верстальщик → точное исполнение</h1><p>Отдельный эксперимент. Запросы ${manifest?.used??0}/${manifest?.maxRequests??12}. Слайды проекта не заменялись. ${escapes(failure??'')}</p>${slides}<h2>Выбор первого Qwen</h2><p>${escapes(brief?.intent??'')}</p><p>Авторское состояние: ${escapes(brief?.authorState??'')}. ${escapes(brief?.authorAdaptation??'')}</p><p>Композиция библиотеки: ${escapes(brief?.compositionId??'нет')}, ${escapes(brief?.compositionUse??'')}. ${escapes(brief?.compositionReason??'')}</p><ul>${selected}</ul><h2>Пиксельное ТЗ второго Qwen</h2><p>Координаты ниже приведены к холсту; исходный ответ содержит локальные рамки внутри каждой области.</p><table><thead><tr><th>Текст</th><th>Источник</th><th>X</th><th>Y</th><th>W</th><th>H</th><th>Кегль</th><th>Интерлиньяж</th><th>Шрифт</th></tr></thead><tbody>${coords}</tbody></table><h2>Документы по этапам</h2><p><a href="DOCUMENTS.md">Читаемые документы, включая все уточнения и неудачные ответы</a></p><ul><li><a href="source.json">00. Точный исходник и снимок библиотеки</a></li><li><a href="catalog.json">00. Каталог, доступный модели</a> · <a href="library.png">Образцы компонентов</a></li><li><a href="recipe-v2.json">00. Контракт авторского рецепта v2</a></li>${links.join('')}<li><a href="result.json">05. Итог и расход</a> · <a href="preservation.json">Сохранность проекта</a></li></ul><details><summary>Все исходные ответы, уточнения и данные провайдера</summary><ul>${historyLinks}</ul></details><p>Проверка одного результата не означает допуска рецепта для любых слайдов. Входы и ответы не исправлялись вручную. Транспорт: Qwen3.8-27b, structured JSON. Режим рассуждения указан в каждом запросе; документы показывают ТЗ и явные решения модели, не скрытые рассуждения.</p></main></html>`
  await writeFile(`${output}/index.html`,html)
  await writeFile(`${output}/README.md`,`# Qwen pixel pilot\n\nOpen [audit gallery](index.html).\n\n- Requests: ${manifest?.used??0}/${manifest?.maxRequests??12}\n- Source: [source.json](source.json)\n- Recipe: [recipe-v2.json](recipe-v2.json)\n- All stages: request/response Markdown and exact JSON in this directory.\n- Immutable provider history: model/.\n- Final status: [result.json](result.json).\n- No production project writes or manual slide changes.\n`)
}
