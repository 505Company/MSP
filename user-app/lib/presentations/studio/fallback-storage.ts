import { z } from 'zod'
import { contentHash } from '../../design-system/catalog'
import { getProject } from '../../workspace/storage'
import { STUDIO_VERSION, type StudioRun, type SlideWork, type RenderReceipt } from './contract'
import { FALLBACK_VERSION, fallbackSource, fallbackWork, fallbackItems, fallbackPage, validateFallbackCoverage,hasLegacyContent } from './fallback-content'
import { receiptSchema, studioKey, studioCancellationKey, validateReceipt } from './storage'
import { refreshStudioStatus } from './compact-task'
import { draftOptions, optionSignature } from './options'

const pagesSchema = z.object({ basis: z.string().max(128), fontCSS: z.string().max(4000000), pages: z.array(z.object({
  pieces: z.array(z.object({ item: z.string().max(500), start: z.number().int().nonnegative(), end: z.number().int().positive(), render: z.enum(['text', 'native']) }).strict()).min(1).max(200), receipt: receiptSchema,
}).strict()).min(1).max(200) }).strict()
const payloadSchema = z.union([pagesSchema, z.object({basis:z.string().max(128),recipe:z.object({id:z.string().max(500),receipt:receiptSchema}).strict()}).strict()])

/** The first fallback implementation lacked an original-content pointer.
 * Read its immutable backup to upgrade those previews without losing spans. */
export async function hydrateFallbackSources(bucket:R2Bucket,run:StudioRun) {
  const legacy=run.slides.filter(s=>s.fallback&&s.fallback.page===1&&(!s.fallback.source||(s.fallback.version??0)<FALLBACK_VERSION))
  if(!legacy.length)return run
  const file=await bucket.get(studioKey(run.projectId,run.revision).replace('/run.json','/before-readable-fallback.json'))
  if(!file)return run
  const original=await file.json<StudioRun>()
  for(const work of legacy)work.fallback!.source=fallbackSource(original,work.fallback!.sourceSlideId)
  return run
}

/** Local recovery has its own explicit contract. It cannot overwrite a ready
 * slide, count as a model success, or accept missing/duplicated source spans. */
export async function commitStudioFallback(bucket: R2Bucket, projectId: string, revision: string, slideId: string, raw: unknown) {
  const payload = payloadSchema.parse(raw), key = studioKey(projectId, revision), project = await getProject(bucket, projectId)
  if (!project || project.archivedAt) throw Error('Проект не найден.')
  for (let attempt = 0; attempt < 12; attempt++) {
    const file = await bucket.get(key); if (!file) throw Error('Не найдена генерация.')
    const before = await file.json<StudioRun>(), saved=before.slides.find(s=>s.content.id===slideId)
    if(before.status==='cancelled'||await bucket.head(studioCancellationKey(projectId,revision)))throw Error('Генерация остановлена.')
    if (before.results[slideId]?.passed&&(!saved?.fallback||(saved.fallback.version??0)>=FALLBACK_VERSION)&&(!saved||!hasLegacyContent(before,saved))) return before
    await hydrateFallbackSources(bucket,before)
    const source = fallbackSource(before, slideId), items = fallbackItems(source)
    if (await contentHash(source) !== payload.basis) throw Error('Содержание слайда изменилось. Откройте его заново.')
    const run: StudioRun = { ...before, version: STUDIO_VERSION, slides: [...before.slides], results: { ...before.results }, semantic: before.semantic ? structuredClone(before.semantic) : undefined }
    // Remove superseded continuation receipts as well as work entries. The
    // immutable backup remains available and ready non-fallback slides stay put.
    for(const old of before.slides.filter(s=>s.fallback?.sourceSlideId===slideId))delete run.results[old.content.id]
    let pages: SlideWork[]
    if('recipe' in payload){
      const work=fallbackWork(before,slideId),draft=draftOptions(work,run.library).find(o=>o.id===payload.recipe.id)
      run.presentationTitle??=work.chrome?.title
      run.slides=run.slides.filter(s=>s.content.id!==slideId&&s.fallback?.sourceSlideId!==slideId).concat(work)
      const receipt=validateReceipt(run,payload.recipe.receipt,true)
      if(!draft||!receipt.passed||receipt.slideId!==slideId||receipt.candidateId!==draft.plan.candidateId||receipt.optionId!==draft.id)throw Error('Результат не соответствует библиотечному рецепту.')
      const components=Object.fromEntries(receipt.components.filter(c=>!work.content.blocks.find(b=>b.id===c.blockId)?.data).map(c=>[c.blockId,c.componentId]))
      const plan={...draft.plan,components}
      work.plan=plan;work.options=[{...draft,plan,signature:optionSignature(work.candidates.find(c=>c.id===receipt.candidateId)!,run.library,components),receipt}]
      run.results[slideId]=receipt;pages=[work]
    }else{
    validateFallbackCoverage(items, payload.pages)
    pages = payload.pages.map((page, index) => {
      const content = fallbackPage(source, items, page.pieces, index), receipt = page.receipt as RenderReceipt
      if (receipt.slideId !== content.id || receipt.candidateId !== 'fallback/readable' || !receipt.passed) throw Error('Резервный слайд не прошёл проверку.')
      const boxes = Object.entries(receipt.layout ?? {})
      if (boxes.length !== content.blocks.length) throw Error('Нет геометрии резервного слайда.')
      for (const [id, rect] of boxes) {
        if (!content.blocks.some(b => b.id === id) || rect.x < 48 || rect.y < 48 || rect.x + rect.w > 1872 || rect.y + rect.h > 1032) throw Error('Резервная вёрстка вышла за поля слайда.')
        for (const [other, b] of boxes) if (other !== id && Math.min(rect.x + rect.w, b.x + b.w) - Math.max(rect.x, b.x) > 1 && Math.min(rect.y + rect.h, b.y + b.h) - Math.max(rect.y, b.y) > 1) throw Error('Блоки резервного слайда пересекаются.')
      }
      if (receipt.text.some(t => { const b = receipt.layout?.[t.blockId]; return !b || t.x < b.x - 1 || t.y < b.y - 1 || t.x + t.width > b.x + b.w + 1 || t.y + t.height > b.y + b.h + 1 })) throw Error('Текст выходит за границы резервного блока.')
      const candidate = { id: 'fallback/readable', recipeId: 'fallback/readable', label: 'Свободная вёрстка', score: 0, slots: boxes.map(([id, rect]) => ({ region: id, blocks: [id], direction: 'column' as const, columns: 1, gap: 0, rect })) }
      return { content, candidates: [candidate], bindings: {}, fallback: { sourceSlideId: slideId, sourceTitle: source.title, page: index + 1, version:FALLBACK_VERSION,...index===0?{source}:{} } }
    })
    run.slides=run.slides.filter(s=>s.content.id!==slideId&&s.fallback?.sourceSlideId!==slideId).concat(pages)
    for (const [index, work] of pages.entries()) {
      const receipt = validateReceipt(run, { ...payload.pages[index].receipt, html: `<style>${payload.fontCSS.replaceAll('</style', '<\\/style')}</style>${payload.pages[index].receipt.html}` }, true)
      const plan = { candidateId: 'fallback/readable', components: {}, primary: [], rationale: 'Содержание сохранено в простой вёрстке.', optionId: receipt.optionId! }
      work.plan = plan; work.options = [{ id: receipt.optionId!, label: 'Свободная вёрстка', signature: await contentHash(payload.pages[index].pieces), plan, receipt }]
      run.results[work.content.id] = receipt
    }
    }
    const order = before.semantic?.units?.map(u => u.id) ?? before.slides.map(s => s.fallback?.sourceSlideId ?? s.content.id)
    run.slides.sort((a, b) => order.indexOf(a.fallback?.sourceSlideId ?? a.content.id) - order.indexOf(b.fallback?.sourceSlideId ?? b.content.id) || (a.fallback?.page ?? 1) - (b.fallback?.page ?? 1))
    const unit = run.semantic?.units?.find(u => u.id === slideId)
    if (unit) { unit.status = 'complete'; unit.fallback = true; delete unit.error }
    refreshStudioStatus(run)
    await bucket.put(key.replace('/run.json', '/before-readable-fallback.json'), JSON.stringify(before), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } })
    if (await bucket.put(key, JSON.stringify(run), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: file.etag } })) return run
  }
  throw Error('Слайды обновились в другой вкладке. Повторите открытие проекта.')
}
