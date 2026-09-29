import { test, expect } from '@playwright/test'

for (const failure of [
  { code: 'SEMANTIC_VALIDATION', retryable: false, error: 'Ответ модели не прошёл проверку объектов и связей.' },
  { code: 'QWEN_TIMEOUT', retryable: true, error: 'Модель не завершила анализ вовремя.' },
]) test(`stage four preserves ${failure.code} through the real background executor`, async ({ page, context }) => {
  const id = 'b1234567-1234-4234-8234-123456789def'; let requests = 0
  await context.route(`**/api/uploads/${id}`, r => r.fulfill({ json: { upload: { id, status: 'processing' } } }))
  await context.route(`**/api/uploads/${id}/processing`, r => r.fulfill({ json: { job: { status: 'running' } } }))
  await context.route(`**/api/uploads/${id}/source-repair`, r => r.fulfill({ json: { needed: false } }))
  await context.route(`**/api/uploads/${id}/semantic-scan`, r => r.fulfill({ json: { run: { status: 'complete', parts: [] } } }))
  await context.route(`**/api/uploads/${id}/fonts`, r => r.fulfill({ json: { fonts: [] } }))
  await context.route(`**/api/uploads/${id}/calibration*`, r => r.fulfill({ json: { components: [], checked: 0, total: 0, calibrated: { families: [] } } }))
  await context.route(`**/api/uploads/${id}/editable-system`, r => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { completed: 0, total: 1, jobs: [{ id: 'part', slides: [1] }], running: false, catalog: null } })
    requests++
    return r.fulfill({ status: 202, contentType: 'application/x-ndjson', body: `{"started":true}\n${JSON.stringify({ complete: false, code: failure.code, error: failure.error })}\n` })
  })
  await page.goto('/processing-worker')
  await page.waitForFunction(() => !!window.__mspRunBackground)
  const result = await page.evaluate(id => window.__mspRunBackground!(id), id)
  expect(result).toMatchObject({ ok: false, retryable: failure.retryable, error: failure.error })
  expect(requests).toBe(1)
})

for (const failure of [
  { code: 'SEMANTIC_SERVICE_UNAVAILABLE', retryable: true, error: 'Сервис модели не отвечает.' },
  { code: 'QWEN_HTTP_401', retryable: false, error: 'Сервис модели отклонил доступ.' },
]) test(`scan polling preserves ${failure.code} and reports unsuccessful packets`, async ({ page, context }) => {
  const id = 'b1234567-1234-4234-8234-123456789def'; let posts = 0, polls = 0
  const progress: { completed?: number; total?: number; detail: string }[] = []
  await page.exposeFunction('__mspWorkerProgress', (value: typeof progress[number]) => { progress.push(value) })
  await context.route(`**/api/uploads/${id}`, r => r.fulfill({ json: { upload: { id, status: 'processing' } } }))
  await context.route(`**/api/uploads/${id}/processing`, r => r.fulfill({ json: { job: { status: 'running' } } }))
  await context.route(`**/api/uploads/${id}/source-repair`, r => r.fulfill({ json: { needed: false } }))
  await context.route(`**/api/uploads/${id}/semantic-scan`, r => {
    if (r.request().method() === 'POST') {
      posts++
      return r.fulfill({ status: 202, contentType: 'application/x-ndjson', body: '{"started":true}\n' })
    }
    polls++
    return r.fulfill({ json: { run: { id: 'scan', status: polls === 2 ? 'running' : 'failed',
      error: failure.error, errorCode: failure.code, parts: [{ status: 'partial' }, { status: 'failed', error: failure.error }, { status: 'running' }] } } })
  })
  await page.goto('/processing-worker')
  await page.waitForFunction(() => !!window.__mspRunBackground)
  const result = await page.evaluate(id => window.__mspRunBackground!(id), id)
  expect(result).toMatchObject({ ok: false, retryable: failure.retryable, error: failure.error })
  expect(posts).toBe(1)
  expect(progress.some(p => p.completed === 2 && p.total === 3 && p.detail.includes('ожидают повтор: 1') && p.detail.includes(failure.error))).toBe(true)
})
