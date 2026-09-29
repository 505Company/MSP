import type { RefinementJob } from '@/lib/design-system/refinement-contract'
import { componentSettingsPath } from '@/lib/component-lab/links'

export function RefinementResult({ job, uploadId, active }: { job: RefinementJob; uploadId: string; active: boolean }) {
  const items=job.result?.items??[], reasons=job.tasks.flatMap(t=>(t.rejectedReasons??[]).map(reason=>({slide:t.slide,reason})))
  return <div className="rf-receipt">
    {!!items.length&&<details className="rf-changes"><summary>Что добавлено · {items.length}</summary><ul>{items.map(item=>{
      const section=item.kind==='graphic'?'assets':['diagram','composition'].includes(item.kind)?'composition':'components'
      return <li key={item.id}>{active?<a href={componentSettingsPath(uploadId,item.id)}>{item.name}</a>:<span>{item.name}</span>}<small>Слайд {item.slide} · {section==='assets'?'графика':section==='composition'?'композиция':'компонент'}</small></li>
    })}</ul></details>}
    {!!job.result?.duplicates&&<p>Уже есть в дизайн-системе: {job.result.duplicates}.</p>}
    {!!reasons.length&&<details className="rf-rejections" open={!items.length}><summary>Не добавлено · {job.result?.rejected??reasons.length}</summary><ul>{reasons.map((r,i)=><li key={i}>Слайд {r.slide}: {r.reason}</li>)}</ul></details>}
    {!items.length&&!job.result?.added&&!job.result?.updated&&!reasons.length&&job.status==='complete'&&<details className="rf-explanation"><summary>Почему нет новых элементов</summary>{job.tasks.map(t=><p key={t.slide}>Слайд {t.slide}: {t.note||'Новых самостоятельных конструкций не найдено.'}</p>)}</details>}
  </div>
}
