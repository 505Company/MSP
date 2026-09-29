import { test, expect } from '@playwright/test'
import type { BankStyle, ProjectSummary } from '../../lib/workspace/types'

const styles: BankStyle[] = [
  { id: 'a933ed19-a2e0-468c-ad63-5a07914f0652', name: 'Оформление команды', fileName: 'Команда.pptx', sourceId: 'source', createdAt: '2026-09-29T00:00:00.000Z', slideCount: 24, componentCount: 299, styleCount: 32, previewId: 'cover-test', colors: ['#0878f9', '#182438', '#b9dcff'], fonts: ['Inter'] },
  { id: 'b033ed19-a2e0-468c-ad63-5a07914f0652', name: 'Шаблон презентации с длинным названием для конференции', fileName: 'Конференция.pptx', sourceId: 'source', createdAt: '2026-09-29T00:00:00.000Z', slideCount: 29, componentCount: 574, styleCount: 50, previewId: null, colors: ['#a51c30', '#ffe8dd'], fonts: ['Arial'] },
]
const projects: ProjectSummary[] = [{ schemaVersion: 1, objectCount: 0, id: 'c133ed19-a2e0-468c-ad63-5a07914f0652', name: 'План развития команды', uploadId: styles[0].id, styleName: styles[0].name, createdAt: styles[0].createdAt, updatedAt: styles[0].createdAt, revision: 'd233ed19-a2e0-468c-ad63-5a07914f0652', slideCount: 6, readyCount: 6, status: 'ready', previewUrl: null }]

test('MSP 3 shell and cards keep original navigation and fit desktop and mobile', async ({ page }, info) => {
  let writes = 0, msp2Reads = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') { writes++; return route.abort() }
    if (path.includes('/msp2/')) msp2Reads++
    if (path === '/api/style-bank') return route.fulfill({ json: { styles } })
    if (path.endsWith('/assets/preview-cover-test')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#0878f9"/></svg>'})
    if (path === '/api/projects') return route.fulfill({ json: { projects } })
    return route.fallback()
  })
  for (const path of ['/', '/styles', '/projects', '/create']) {
    await page.goto(path)
    await expect(page.locator('.msp-classic')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Рецепты', exact: true })).toHaveAttribute('href', '/recipes')
    await expect(page.getByRole('link', { name: 'Создать новую презентацию', exact: true })).toHaveAttribute('href', '/create')
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
    if (path === '/create') {
      await expect(page.locator('#presentation-style input')).toHaveCount(2)
      await expect(page.locator('.msp-style-thumbnail img').first()).toHaveAttribute('src',`/api/uploads/${styles[0].id}/assets/preview-cover-test`)
      await expect(page.getByRole('group', { name: 'Режим генерации' }).getByRole('radio')).toHaveCount(3)
      await expect(page.getByRole('button', { name: 'Сгенерировать слайды' })).toBeDisabled()
    } else {
      await expect(page.locator('.m2-card').first()).toBeVisible()
    }
    for (const width of [1920, 1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} at ${width}px`).toBe(true)
      if (width === 1440 || width === 390) await page.screenshot({ path: info.outputPath(`${path.replaceAll('/', '') || 'home'}-${width}.png`), fullPage: true })
    }
  }
  await page.goto('/projects')
  await page.getByRole('searchbox', { name: 'Найти проект' }).fill('не найден')
  await expect(page.locator('.ws-project-tile')).toHaveCount(0)
  await expect(page.getByText('По этому запросу ничего не найдено.')).toBeVisible()
  await page.goto('/styles')
  await page.getByRole('searchbox', { name: 'Найти дизайн-систему' }).fill('команды')
  await expect(page.locator('.m2-card')).toHaveCount(1)
  expect(writes).toBe(0); expect(msp2Reads).toBe(0); expect(errors).toEqual([])
})

test('MSP 3 keeps style deep links and keyboard selection without creating a project', async ({ page }) => {
  let writes = 0
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') { writes++; return route.abort() }
    if (new URL(route.request().url()).pathname === '/api/style-bank') return route.fulfill({ json: { styles } })
    return route.fallback()
  })
  for (const path of ['/create', '/', '/projects']) {
    await page.goto(`${path}?template=${styles[1].id}`)
    await expect(page.locator(`#presentation-style input[value="${styles[1].id}"]`)).toBeChecked()
  }
  const selected = page.locator(`#presentation-style input[value="${styles[1].id}"]`)
  await selected.press('ArrowUp')
  await expect(page.locator(`#presentation-style input[value="${styles[0].id}"]`)).toBeChecked()
  expect(writes).toBe(0)
})

test('saved project inputs belong to the header and disclosure does not write or start generation', async ({page},info)=>{
  const project={...projects[0],text:'Исходное содержание проекта.',generationMode:'fast'}
  let writes=0
  await page.route('**/api/**',route=>{
    if(route.request().method()!=='GET'){writes++;return route.abort()}
    const path=new URL(route.request().url()).pathname
    if(path==='/api/style-bank')return route.fulfill({json:{styles}})
    if(path===`/api/projects/${project.id}`)return route.fulfill({json:{project}})
    if(path.endsWith('/generations'))return route.fulfill({json:{generations:[]}})
    if(path.endsWith('/compose'))return route.fulfill({json:{run:null,configured:false}})
    return route.fallback()
  })
  await page.goto(`/projects/${project.id}`)
  const toggle=page.getByRole('button',{name:'Содержание и параметры'})
  await expect(toggle).toHaveAttribute('aria-expanded','false')
  await expect(page.locator('#presentation-content')).toHaveCount(1)
  await expect(page.locator('#presentation-content')).toBeHidden()
  await expect(page.locator('.msp-project-workspace #presentation-content')).toHaveValue(project.text)
  await expect(page.locator('.m2-project-style')).toBeVisible()
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1080})
    await toggle.focus();await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded','true')
    await expect(page.locator('#presentation-content')).toBeVisible()
    await expect(page.locator('.m2-project-style')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:info.outputPath(`project-settings-${width}.png`),fullPage:true})
    await toggle.click();await expect(page.locator('#presentation-content')).toBeHidden()
    await expect(page.locator('.m2-project-style')).toBeVisible()
  }
  expect(writes).toBe(0)
})

test('design-system status appears only in design systems and keeps its task across navigation',async({page})=>{
  await page.route('**/api/style-bank',r=>r.fulfill({json:{styles}}))
  await page.route('**/api/projects',r=>r.fulfill({json:{projects}}))
  await page.goto('/styles')
  await page.evaluate(async()=>{
    const path='/lib/uploads/design-progress.ts',progress=await import(path)
    progress.reportDesignProgress('cover-status',{step:'graphics',detail:'Готово'},{label:'Команда.pptx',owned:true})
    progress.settleDesignProgress('cover-status','complete','Дизайн-система готова.')
  })
  const banner=page.getByRole('region',{name:'Сборка дизайн-системы'})
  await expect(banner).toBeVisible()
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('link',{name:'Проекты',exact:true}).click()
  await expect(banner).toBeHidden()
  await page.getByRole('link',{name:'Создать новую презентацию',exact:true}).click()
  await expect(banner).toBeHidden()
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('link',{name:'Дизайн система',exact:true}).click()
  await expect(banner).toBeVisible()
})
