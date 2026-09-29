"use client"
import { useEffect, useState } from 'react'
import type { publicPreparationJob } from '@/lib/component-lab/preparation-jobs'

export type PreparationView = ReturnType<typeof publicPreparationJob>
/** The background queue is the single status source for the gallery and editor.
 * Ensure only derives profiles and queues local browser checks; it uses no model. */
export function useComponentPreparation(uploadId: string, catalogId: string | null, ensure = false) {
  const [value, setValue] = useState<{ key: string; jobs: PreparationView[]; error?: string } | null>(null)
  const key = `${uploadId}:${catalogId}`
  useEffect(() => {
    if (!catalogId) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const url = `/api/uploads/${uploadId}/component-preparation`
    const load = async (refresh = false) => {
      try {
        const response = await fetch(url, { signal: controller.signal, ...(refresh ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ensure' }) } : {}) })
        const data = await response.json() as { jobs?: PreparationView[]; error?: string }
        if (!response.ok || !data.jobs) throw Error(data.error ?? 'Статус адаптивности недоступен')
        setValue({ key, jobs: data.jobs })
        if (data.jobs.some(j => ['queued', 'running', 'retrying'].includes(j.status))) timer = setTimeout(() => void load(), 3000)
      } catch (e) { if (!controller.signal.aborted) setValue({ key, jobs: [], error: e instanceof Error ? e.message : 'Статус адаптивности недоступен' }) }
    }
    void load(ensure)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [uploadId, catalogId, key, ensure])
  return value?.key === key ? value : null
}

export function preparationLabel(job: PreparationView | undefined) {
  if (job?.status === 'complete') return job.result?.generationAdmission ? 'Адаптивный · проверен' : 'Исходная вёрстка · адаптация не прошла проверку'
  if (job && ['queued', 'running', 'retrying'].includes(job.status)) return 'Проверяется адаптивность'
  if (job?.status === 'unsupported') return 'Исходная вёрстка · адаптация пока недоступна'
  if (job?.status === 'blocked' || job?.status === 'cancelled') return 'Исходная вёрстка · проверка приостановлена'
  return 'Исходная вёрстка · адаптация ещё не проверена'
}
