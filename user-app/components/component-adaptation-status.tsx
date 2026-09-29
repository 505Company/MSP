"use client"
import { useComponentPreparation, preparationLabel } from './use-component-preparation'
export function ComponentAdaptationStatus({uploadId,catalogId,ready}:{uploadId:string;catalogId:string|null;ready:boolean}) {
 const value=useComponentPreparation(uploadId,ready?catalogId:null)
 if(!ready)return null
 if(!value)return <p className="rf-muted" role="status">Получаем результат проверки адаптивности…</p>
 if(value.error)return <p className="rf-muted">{value.error}</p>
 const n=value.jobs.filter(j=>j.status==='complete'&&j.result?.generationAdmission).length
 return <details className="rf-adaptation"><summary>Вариантов с проверенной адаптивностью: {n}</summary><p>Проверены вместимость, читаемость и сохранность исходного оформления. Возможности зависят от формы контейнера и содержания.</p>{value.jobs.map(j=><p key={j.id}>{j.name} · {preparationLabel(j)}{j.reason?` · ${j.reason}`:''}</p>)}</details>
}
