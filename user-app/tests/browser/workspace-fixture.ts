import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
const created = new WeakMap<APIRequestContext, Set<string>>()
export const test = base.extend<{ cleanupWorkspace: void }>({
  cleanupWorkspace: [async ({ page, request }, use) => {
    const styles = new Set<string>(), projects = new Set<string>(), pending: Promise<void>[] = []
    created.set(request, projects)
    page.on('response', response => {
      if (response.request().method() !== 'POST' || response.status() !== 201) return
      const path = new URL(response.url()).pathname
      if (path === '/api/style-bank') pending.push(response.json().then(data => { styles.add(data.style.id) }))
      if (path === '/api/projects') pending.push(response.json().then(data => { projects.add(data.project.id) }))
    })
    await use()
    await Promise.all(pending)
    for (const id of projects) {
      const result = await (await request.get(`/api/projects/${id}`)).json()
      if (result.project) await request.delete(`/api/projects/${id}`, { data: { baseRevision: result.project.revision } })
    }
    for (const id of styles) await request.delete(`/api/style-bank/${id}`)
    created.delete(request)
  }, { auto: true }],
})
export { expect }
export async function openTestProject(page: Page, request: APIRequestContext, uploadId: string, generate = true) {
  const id = crypto.randomUUID()
  const response = await request.post('/api/projects', { data: { id, uploadId, name: 'Проверка проекта', text: 'Полное содержание тестовой презентации.' } })
  expect(response.ok()).toBe(true)
  created.get(request)?.add(id)
  await page.goto(`/projects/${id}${generate ? '?generate=1' : ''}`)
  await page.getByRole('button', { name: 'Содержание и параметры' }).click()
  await expect(page.locator('#presentation-content')).toBeVisible()
  return id
}
