import { test, expect } from './workspace-fixture'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Local, opt-in acceptance: exercises the actual upload UI without model calls.
test.use({ trace: 'off' })
test('image-heavy source deck imports every slide and keeps the source intact', async ({ page, request, browser }, testInfo) => {
  const sourcePath = process.env.MSP_ASSET_HEAVY_PPTX
  test.skip(!sourcePath, 'Set MSP_ASSET_HEAVY_PPTX to a local presentation')
  test.setTimeout(300000)
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  if (process.env.MSP_ITERATED_BYTES === '1') await page.addInitScript(() => {
    // Same bytes/iteration results, but no engine-specific TypedArray.from shortcut.
    const original = Uint8Array.prototype[Symbol.iterator]
    Uint8Array.prototype[Symbol.iterator] = function* () { yield* original.call(this); return undefined }
  })
  const errors: string[] = [], progress: string[] = []
  const memory: Array<{ stage?: string; rssMiB: number }> = []
  const cdp = await browser.newBrowserCDPSession()
  let sampling = false
  const timer = setInterval(async () => {
    if (sampling) return
    sampling = true
    try {
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
      const { stdout } = await promisify(execFile)('ps', ['-p', processInfo.map((p: { id: number }) => p.id).join(','), '-o', 'rss='])
      memory.push({ stage: progress.at(-1), rssMiB: Math.round(stdout.trim().split(/\s+/).reduce((sum, value) => sum + Number(value), 0) / 1024) })
    } catch { /* A crashed renderer is separately recorded by the page event. */ }
    finally { sampling = false }
  }, 1000)
  page.on('pageerror', error => errors.push(error.message))
  let failCrash: (error: Error) => void
  const crashed = new Promise<never>((_, reject) => { failCrash = reject })
  void crashed.catch(() => {})
  page.on('crash', () => { errors.push('browser-page-crashed'); failCrash(new Error('browser-page-crashed')) })
  await page.exposeFunction('reportImportProgress', (message: string) => {
    if (progress.at(-1) !== message) { progress.push(message); console.log('[import-progress]', message) }
  })
  await page.goto('/styles')
  if (page.url().includes('signin-with-chatgpt')) await page.getByRole('button').filter({ hasText: /войти|sign in|continue/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Банк стилей', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    new MutationObserver(() => {
      const status = document.querySelector('.ws-import [role=status],.ws-import [role=alert]')?.textContent
      if (status) void (window as unknown as { reportImportProgress(message: string): Promise<void> }).reportImportProgress(status)
    }).observe(document.querySelector('.ws-import')!, { subtree: true, childList: true, characterData: true })
  })
  try {
    await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(sourcePath!)
    await Promise.race([crashed, expect(page.locator('.pw-error').or(page.getByRole('link', { name: 'Компоненты' })).first()).toBeVisible({ timeout: 250000 })])
    expect(await page.locator('.pw-error').allTextContents(), JSON.stringify({ errors, lastProgress: progress.at(-1) })).toEqual([])
    await expect(page.getByRole('link', { name: 'Компоненты' })).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    const data = await (await request.get(`/api/uploads/${id}/design-system`)).json()
    expect(data.visual.snapshot.slideCount).toBe(Number(process.env.MSP_ASSET_HEAVY_SLIDES ?? 83))
    expect(data.visual.snapshot.slides).toHaveLength(data.visual.snapshot.slideCount)
    expect(data.visual.previews).toHaveLength(data.visual.snapshot.slideCount)
    expect(data.visual.snapshot.elements.length).toBeGreaterThan(data.visual.snapshot.slideCount)
    const original = await request.get(`/api/uploads/${id}/source`)
    expect(original.ok()).toBe(true)
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(sha(await original.body())).toBe(sha(await readFile(sourcePath!)))
    expect(errors).toEqual([])
    await writeFile(testInfo.outputPath('upload-id.txt'), id)
  } finally {
    clearInterval(timer)
    await cdp.detach()
    await writeFile(testInfo.outputPath('import-progress.json'), JSON.stringify({ errors, progress, memory }, null, 2))
  }
})
