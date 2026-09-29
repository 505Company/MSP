import type { publicPreparationJob } from '../lib/component-lab/preparation-jobs'
type Job = ReturnType<typeof publicPreparationJob>

/** Only admission/polling lives in the editor. Closing it does not cancel work. */
export function preparationStatus(root: HTMLElement, upload: string, selected: () => string, signal: AbortSignal) {
  let jobs: Job[] = [], timer: ReturnType<typeof setTimeout> | undefined, background = true, polling = false
  const box = root.querySelector<HTMLElement>('#background-preparation')!, text = root.querySelector<HTMLElement>('#background-preparation-text')!, retry = root.querySelector<HTMLButtonElement>('#background-preparation-retry')!
  const endpoint = `/api/uploads/${encodeURIComponent(upload)}/component-preparation`
  function paint() {
    if (signal.aborted) return
    const job = jobs.find(j => j.componentId === selected())
    box.hidden = !job || job.status === 'unsupported'; retry.hidden = !job || !['blocked', 'cancelled'].includes(job.status)
    if (!job) return
    text.textContent = job.status === 'complete' ? job.result?.generationAdmission
      ? `Готов к использованию в новых презентациях. Текст, цвета и графика проверены; проходят ${job.result.fits} из ${job.result.tested} вариантов. Композицию стоит оценить визуально.`
      : 'Фоновая проверка сохранённой версии нашла ограничения. Подробную проверку можно открыть ниже.'
      : job.status === 'running' ? 'Проверяем адаптацию в фоне. Можно закрыть страницу.'
      : job.status === 'blocked' ? `Фоновая проверка приостановлена. ${job.reason ?? ''}`
      : job.status === 'cancelled' ? 'Фоновая проверка остановлена.'
      : background ? 'Адаптация ожидает фоновой проверки. Можно продолжать работу.' : 'Адаптация в очереди. Ожидаем подключения фонового обработчика.'
  }
  async function poll() {
    clearTimeout(timer)
    if (signal.aborted || polling) return
    polling = true
    try {
      const response = await fetch(endpoint, { signal, cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { jobs: Job[]; background: boolean }
      jobs = data.jobs; background = data.background; paint()
    } catch { /* The component editor still works when the queue is offline. */ }
    finally { polling = false; if (!signal.aborted) timer = setTimeout(poll, 5000) }
  }
  retry.addEventListener('click', () => {
    const job = jobs.find(j => j.componentId === selected()); if (!job) return
    retry.disabled = true
    void fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry', jobId: job.id }) }).then(async response => {
      if (!response.ok) throw Error('Не удалось повторить проверку. Попробуйте ещё раз.')
      await poll()
    }).catch(e => { if (!signal.aborted) text.textContent = e.message }).finally(() => { if (!signal.aborted) retry.disabled = false })
  })
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  const ensure = async () => {
    try { await fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ensure' }) }) } catch { /* Admission retries on a later visit, without any model calls. */ }
    await poll()
  }
  void ensure()
  return { refresh: paint }
}
