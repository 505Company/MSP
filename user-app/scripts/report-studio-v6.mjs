import {readFile,writeFile,readdir} from 'node:fs/promises'
import {dirname} from 'node:path'

// A report assembled from saved product results; never a slide/layout input.
const root='outputs/diagnostics',normal=`${root}/studio-semantic-pilot/b0120aca-bfb3-48ce-a146-b62f38802f18/v6-final-retry`
const components=process.argv[2]
if(!components)throw Error('Provide the final component experiment directory')
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const entries=await Promise.all([normal,components].map(async dir=>({dir,run:await read(dir+'/run.json'),report:await read(dir+'/report.json'),audit:await read(dir+'/audit.json')})))
const [a,b]=entries
const cold=await read(dirname(components)+'/components-v2-cold/report.json')
const componentElapsed=b.report.elapsedMs+(components.endsWith('/components-v2-cold')?0:cold.elapsedMs)
const seconds=ms=>(ms/1000).toFixed(1)
const heading=['Существующие рецепты','Только компоненты · Qwen выбирает сетку']
const card=(entry,id,index)=>{
  const r=entry.run.results[id],unit=entry.run.semantic.units.find(u=>u.id===id),work=entry.run.slides.find(s=>s.content.id===id)
  const url='../'+entry.dir.replace(root+'/','')+'/'+id+'.png'
  return `<article><p class="label">${heading[index]} · ${r?.passed?'готов':'остановлен'}</p>${r?.passed?`<a href="${escape(url)}" target="_blank" rel="noopener"><img src="${escape(url)}" alt="Слайд ${escape(id)}"></a>`:`<div class="missing"><strong>Нужен пересмотр вместимости</strong><p>${escape(unit?.error??work?.error??'Слайд не готов')}</p></div>`}<small>${r?.passed?`${r.components.length} компонентов · все исходные поля сохранены`:'Содержание сохранено. Уменьшение ниже порога и удаление текста не выполнены.'}</small></article>`
}
const items=a.run.semantic.units.map((u,i)=>`<section><h2>${i+1}. ${escape(a.run.slides.find(s=>s.content.id===u.id)?.content.title??u.packet.atoms[0]?.text??u.id)}</h2><div class="pair">${card(a,u.id,0)}${card(b,u.id,1)}</div></section>`).join('')
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MSP · проверка независимых слайдов</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#142333;font:16px/1.5 system-ui,sans-serif}main{max-width:1920px;margin:auto;padding:32px}h1{font-size:32px;margin:0 0 12px}h2{font-size:20px;margin:0 0 14px}p{max-width:1100px}a{color:#0767d6}nav{display:flex;gap:24px;flex-wrap:wrap;margin:24px 0}section{margin:36px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{min-width:0}.label{font-weight:600;margin:0 0 8px}img{width:100%;display:block;border:1px solid #d6dfe8;background:white}.missing{aspect-ratio:16/9;background:white;border:1px dashed #9ba9ba;padding:32px;display:flex;flex-direction:column;justify-content:center;overflow:auto}.missing p{font-size:14px;overflow-wrap:anywhere}small{display:block;color:#516172;margin-top:8px}table{border-collapse:collapse;background:white}td,th{border:1px solid #d6dfe8;padding:10px 16px;text-align:left}@media(max-width:900px){main{padding:20px}.pair{grid-template-columns:1fr}}</style><main><h1>Пять слайдов через MSP</h1><p>Один исходный текст и библиотека VK Education. Слайды ниже — сохранённые PNG самого продукта. Qwen назначает содержание по идентификаторам; числа извлекает код. Существующие рецепты не менялись.</p><table><tr><th>Проверка</th><th>Готово</th><th>Измеренное время</th><th>Запросы</th></tr><tr><td>Рецепты, включая возобновление</td><td>${a.audit.ready}/${a.audit.total}</td><td>${seconds(93982+a.report.elapsedMs)} с</td><td>${a.audit.paidRequests}</td></tr><tr><td>Компоненты, первый запуск с нуля</td><td>${cold.results.length}/${b.audit.total}</td><td>${seconds(cold.elapsedMs)} с</td><td>${cold.modelRequests}</td></tr><tr><td>Компоненты, текущее состояние с повторами</td><td>${b.audit.ready}/${b.audit.total}</td><td>${seconds(componentElapsed)} с</td><td>${b.audit.paidRequests}</td></tr></table><p>Время нескольких запусков суммируется без пауз на исправление кода; это не непрерывная генерация. У предыдущего независимого эксперимента компонентов было 3/5 за 270,1 с и 5/5 после ещё 134,3 с исправления. Повторяемость и визуальное качество не гарантируются одним успешным прогоном.</p><nav><a href="${escape(a.report.url)}">Проект с рецептами</a><a href="${escape(b.report.url)}">Проект только с компонентами</a><a href="REPORT.md">Подробный отчёт</a></nav>${items}</main></html>`
await writeFile(root+'/studio-v6/index.html',html)

const runs=[],models=new Map()
for(const p of (await readdir(root+'/studio-semantic-pilot',{withFileTypes:true})).filter(e=>e.isDirectory())){
  for(const a of (await readdir(root+'/studio-semantic-pilot/'+p.name,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^(v6-|components-)/.test(e.name))){
    const dir=root+'/studio-semantic-pilot/'+p.name+'/'+a.name
    let r;try{r=await read(dir+'/report.json')}catch{continue}
    runs.push({project:p.name,attempt:a.name,elapsedMs:r.elapsedMs,ready:r.results.filter(v=>v.passed).length,newRequests:r.newModelRequests,status:r.status})
    for(const f of (await readdir(dir)).filter(f=>/^model-.*\.json$/.test(f))){
      const {metadata:m}=await read(dir+'/'+f);if(!m)continue
      const q=m.provenance??m.attempts.at(-1)?.provenance
      models.set(m.id,{id:m.id,project:p.name,slide:m.scope.slideId,liveRequests:m.liveRequests,cacheHit:m.cacheHit,status:m.status,provider:q?.routingReceipt?.providerName,quantization:q?.endpoint?.declaredQuantization,costRub:q?.routingReceipt?.totalCostRub,error:m.error?.code})
    }
  }
}
const requests=[...models.values()],summary={generatedAt:new Date().toISOString(),normal:a.audit,components:b.audit,runs,requests,totalRequests:requests.reduce((n,r)=>n+r.liveRequests,0),knownCostRub:requests.reduce((n,r)=>n+(r.costRub??0),0),unknownCosts:requests.filter(r=>r.liveRequests&&r.costRub===undefined).length}
await writeFile(root+'/studio-v6/summary.json',JSON.stringify(summary,null,2))
console.log(JSON.stringify({ready:b.audit.ready,total:b.audit.total,seconds:seconds(b.report.elapsedMs),requests:b.audit.paidRequests,knownExperimentCostRub:b.audit.knownCostRub,totalDocumentedRequests:summary.totalRequests,totalDocumentedKnownCostRub:summary.knownCostRub,unknownCosts:summary.unknownCosts},null,2))
