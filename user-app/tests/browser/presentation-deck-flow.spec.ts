import { test, expect, openTestProject } from './workspace-fixture'
import { controlPptx } from '../fixtures/control-pptx'
import { deckInput, deckScene } from '../fixtures/deck'
import { materialIdentity } from '../../lib/presentations/material-identity'
import { contentHash } from '../../lib/design-system/catalog'
import { compileDeckScene } from '../../lib/presentations/deck-compiler'
import { activeRecipe } from '../../lib/presentations/active-recipe'

test('project automatically renders, submits errors, repairs, and reopens a finished deck without another request', async ({ page, request }, info) => {
  test.skip(activeRecipe() !== 'accepted-10-v1', 'Archived pipeline; covered when the rollback switch is enabled.')
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Проверка колоды.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const uploadId = new URL(page.url()).pathname.split('/').at(-1)!, inputId = 'e'.repeat(64), input = deckInput()
  const background = compileDeckScene(deckScene(input), input).scene.elements.find(e => e.kind === 'rectangle')!
  const resource = { id: 'browser-art', name: 'Фирменная подложка', kind: 'atom' as const, source: { slide: 1, rootId: 'art', elementIds: ['art'], ancestorIds: [], assetIds: [] },
    scene: { width: 1920, height: 1080, elements: [{ ...background, zIndex: 0 }] }, slots: [], fixedTextIds: [], issues: [], semantics: [{ findingId: 'art', name: 'Подложка', role: 'background', basis: 'test' }] }
  let phase: 'catalog' | 'search' | 'evidence' | 'scene' | 'render' | 'review' | 'ready' = 'catalog', starts = 0, reports = 0, reviews = 0, searches = 0, preview = '', scene = deckScene(input), sceneHash = ''
  await page.route('**/api/projects/*/structure', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/structure$/, ''), current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { configured: true, materialId: await materialIdentity(current.text), structure: { status: 'ready', outline: { slides: [{}] } } } })
  })
  await page.route('**/api/projects/*/recipes', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/recipes$/, ''), current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { configured: true, inputId, materialId: await materialIdentity(current.text), uploadId, plan: { status: 'ready', selections: [{}] } } })
  })
  await page.route('**/api/projects/*/deck', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/deck$/, ''), current = (await (await request.get(path)).json()).project
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      if (body.action === 'catalog') { expect(body.evidence.resourceIds).toEqual(['browser-art']); expect(body.pageId).toBe('page-1'); phase = 'search' }
      else if (body.action === 'advance' && phase === 'search') { searches++; phase = 'evidence' }
      else if (body.action === 'evidence') { expect(body.evidence.fonts).toContain('Play'); phase = 'scene' }
      else if (body.action === 'advance' && phase === 'review') { reviews++; phase = 'ready' }
      else if (body.action === 'advance') {
        starts++; scene = deckScene(input)
        if (starts === 1) scene.colors.find(c => c.role === 'white')!.hex = '#000000'
        sceneHash = await contentHash(scene); phase = 'render'
      } else {
        reports++; expect(body.report.sceneHash).toBe(sceneHash)
        if (reports === 1) { expect(body.report.issues.some((i: { code: string }) => i.code === 'text-contrast')).toBe(true); phase = 'scene' }
        else { expect(body.report.issues).toEqual([]); phase = 'review'; preview = body.preview }
      }
      await route.fulfill({ json: { accepted: true } }); return
    }
    await route.fulfill({ json: { inputId, materialId: await materialIdentity(current.text), uploadId,
      state: starts ? { inputId, status: phase === 'ready' ? 'ready' : 'working', jobs: [], slides: [{ id: input.slideId, title: input.title, status: phase === 'review' ? 'fitted' : phase, fittedAttempt: reports > 1 ? 2 : undefined, attempts: reports > 1 ? [{ number: 2, sceneHash }] : [] }] } : null,
      next: phase === 'ready' ? null : { kind: phase, pageId: 'page-1', input: phase === 'catalog' ? { ...input, resources: [resource] } : input, scene: phase === 'render' ? scene : null, sceneHash, referenceUrl: `/recipes/accepted-10-v1/${input.variant.preview}` } } })
  })
  await page.route('**/api/projects/*/deck/preview?*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(preview.split(',')[1], 'base64') }))
  await openTestProject(page, request, uploadId)
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 1' })).toBeVisible({ timeout: 60000 })
  expect(starts).toBe(2); expect(reports).toBe(2); expect(reviews).toBe(1); expect(searches).toBe(1)
  await expect(page.locator('.ws-deck-previews img')).toBeVisible()
  await expect(page.locator('pre,#project-navigation,.slide-composer')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('automatic-deck.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 1' })).toBeVisible()
  expect(starts).toBe(2); expect(reports).toBe(2)
  await page.locator('#presentation-content').fill('Новое содержание скрывает предыдущую колоду сразу.')
  await expect(page.locator('.ws-deck-previews img')).toHaveCount(0)
})
