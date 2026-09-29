import { acceptedVariants } from './recipes/catalog'
import { recipeSlides } from './recipe-selection'
import { resourcePages, resourcePool, resourceQueries, validateResourceResult, type ResourcePage, type ResourceResult } from './deck-resources'
import { replacementChoices, validateReplacement } from './deck-reselection'
import { MAX_VISUAL_ROUNDS, reviewGroups, validateVisualReview, type ReviewTarget, type VisualReview, type VisualRound } from './deck-review'
import { DECK_RENDERER, DECK_VERSION, MAX_SCENE_ATTEMPTS, type BoundScene, type DeckEvidence, type DeckIssue, type DeckReport } from './deck-contract'
import type { DeckContext } from './deck'

export const MAX_DECK_REQUESTS = 120
export const MAX_AUX_ATTEMPTS = 2
export type Attempt = { number: number; variantId: string; correctionRound: number; runId?: string; requests: number; raw?: unknown; scene?: BoundScene; sceneHash?: string; issues?: DeckIssue[]; report?: DeckReport; preview?: string }
export type DeckSlideState = { id: string; title: string; variantId: string; tried: string[]; correctionRound: number; evidence?: DeckEvidence;
  status: 'pending' | 'running' | 'render' | 'fitted' | 'ready' | 'blocked' | 'failed'; attempts: Attempt[]; fittedAttempt?: number;
  selectRequested?: boolean; visualIssues?: DeckIssue[] }
export type AuxSpec = { kind: 'search'; key: string; pageId: string; queryId: string }
  | { kind: 'reselect'; key: string; slideId: string; choices: string[] }
  | { kind: 'review'; key: string; targets: ReviewTarget[]; round: number }
export type AuxJob = { id: string; spec: AuxSpec; status: 'running' | 'complete' | 'invalid' | 'failed'; requests: number; runId?: string; raw?: unknown; result?: unknown; issues?: string[]; applied?: boolean }
export type DeckState = { version: typeof DECK_VERSION; id: string; inputId: string; projectId: string; materialId: string; uploadId: string; catalogId: string;
  createdAt: string; updatedAt: string; status: 'working' | 'ready' | 'blocked' | 'failed'; evidence: DeckEvidence; pages: ResourcePage[]; jobs: AuxJob[]; rounds: VisualRound[];
  slides: DeckSlideState[]; error?: string }
export type DeckOperation = { kind: 'catalog'; page: ResourcePage } | AuxSpec | { kind: 'evidence'; slideId: string } | { kind: 'scene'; slideId: string } | { kind: 'render'; slideId: string }
  | { kind: 'begin-review' } | { kind: 'settle-review' } | { kind: 'done' } | { kind: 'wait' } | { kind: 'limit'; message: string }
export function initialDeck(context: DeckContext): DeckState {
  return { version: DECK_VERSION, id: crypto.randomUUID(), inputId: context.inputId, projectId: context.projectId, materialId: context.recipes.structure.material.id,
    uploadId: context.recipes.brand.uploadId, catalogId: context.recipes.brand.catalogId, status: 'working', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    evidence: { renderer: DECK_RENDERER, fonts: [], resourceIds: [], sheet: null }, pages: resourcePages(context.inputs[0].resources), jobs: [], rounds: [],
    slides: context.inputs.map(i => ({ id: i.slideId, title: i.title, variantId: i.variant.id, tried: [i.variant.id], correctionRound: 0, status: 'pending', attempts: [] })) }
}
export function deckRequests(state: DeckState) { return state.jobs.reduce((n,j) => n+j.requests,0) + state.slides.reduce((n,s) => n+s.attempts.reduce((n,a) => n+a.requests,0),0) }
export function slideInput(context: DeckContext, state: DeckState, slide: DeckSlideState, variantId = slide.variantId) {
  const base = context.inputs.find(i => i.slideId === slide.id)!, variant = acceptedVariants.find(v => v.id === variantId)!
  const results = state.jobs.filter(j => j.spec.kind === 'search' && j.status === 'complete').map(j => j.result as ResourceResult)
  const available = state.pages.flatMap(p => p.availableIds ?? []), pool = resourcePool(base, results, available)
  return { ...base, variant, resources: pool.map(id => base.resources.find(r => r.id === id)!) }
}
export function phaseAttempts(slide: DeckSlideState) { return slide.attempts.filter(a => a.variantId === slide.variantId && a.correctionRound === slide.correctionRound) }
function unchangedVisualCorrection(slide: DeckSlideState) {
  const latest = slide.attempts.find(a => a.number === slide.fittedAttempt)
  if (!slide.visualIssues?.length || !latest?.correctionRound || latest.correctionRound !== slide.correctionRound || latest.variantId !== slide.variantId) return false
  const before = [...slide.attempts].reverse().find(a => a.correctionRound < latest.correctionRound && a.sceneHash && a.report && !a.report.issues.length)
  return Boolean(before && before.sceneHash === latest.sceneHash)
}
export function slideIssues(slide: DeckSlideState) { return [...slide.visualIssues ?? [], ...phaseAttempts(slide).at(-1)?.issues ?? [],
  ...(unchangedVisualCorrection(slide) ? [{ code: 'visual-unchanged', message: 'Исправление вернуло ту же сцену. В текущей опции замечание Q6 не устранено; выбери другую допустимую опцию, сохранив весь текст.' }] : [])] }
export function nextOperation(context: DeckContext, state: DeckState): DeckOperation {
  if (state.status === 'ready' || state.status === 'blocked') return { kind: 'done' }
  if (state.slides.some(s => s.status === 'running') || state.jobs.some(j => j.status === 'running')) return { kind: 'wait' }
  const page = state.pages.find(p => !p.availableIds)
  if (page) return { kind: 'catalog', page }
  for (const page of state.pages.filter(p => p.availableIds!.length)) for (const query of resourceQueries(context.inputs)) {
    const key = `search-${page.id}-${query.id}`
    if (!state.jobs.some(j => j.spec.key === key && j.status === 'complete')) return { kind: 'search', key, pageId: page.id, queryId: query.id }
  }
  const slide = state.slides.find(s => !['ready','fitted'].includes(s.status) || unchangedVisualCorrection(s))
  if (slide) {
    if (slide.status === 'render') return { kind: 'render', slideId: slide.id }
    if (slide.selectRequested || unchangedVisualCorrection(slide) || phaseAttempts(slide).length >= MAX_SCENE_ATTEMPTS) {
      const input = slideInput(context, state, slide), outline = recipeSlides(context.recipes.structure.material, context.recipes.outline).find(s => s.id === slide.id)!
      const usable = { ...input, brand: { ...input.brand, resources: input.brand.resources.filter(r => slide.evidence?.resourceIds.includes(r.id)) } }
      const choices = replacementChoices(usable, outline, slide.tried, slideIssues(slide)).map(v => v.id)
      return choices.length ? { kind: 'reselect', key: `reselect-${slide.id}-${slide.tried.length}-${slide.correctionRound}`, slideId: slide.id, choices }
        : { kind: 'limit', message: 'Не удалось подобрать оформление для всего содержания. Исходный текст и проверенные слайды сохранены.' }
    }
    if (!slide.evidence) return { kind: 'evidence', slideId: slide.id }
    return { kind: 'scene', slideId: slide.id }
  }
  const round = state.rounds.at(-1)
  if (!round || round.settled) return { kind: 'begin-review' }
  for (const group of reviewGroups(round)) if (!state.jobs.some(j => j.spec.key === group.id && j.status === 'complete')) return { kind: 'review', key: group.id, targets: group.targets, round: round.number }
  return { kind: 'settle-review' }
}
export function validateAux(raw: unknown, spec: AuxSpec, context: DeckContext, state: DeckState) {
  if (spec.kind === 'search') return validateResourceResult(raw, state.pages.find(p => p.id === spec.pageId)!, resourceQueries(context.inputs).find(q => q.id === spec.queryId)!)
  if (spec.kind === 'reselect') return validateReplacement(raw, acceptedVariants.filter(v => spec.choices.includes(v.id)))
  return validateVisualReview(raw, spec.targets)
}
export function applyAux(job: AuxJob, context: DeckContext, state: DeckState) {
  job.result = validateAux(job.raw, job.spec, context, state)
  if (!job.applied && job.spec.kind === 'reselect') {
    const spec = job.spec, slide = state.slides.find(s => s.id === spec.slideId)!, result = job.result as { variantId: string | null; reason: string }
    if (!result.variantId) { slide.status = 'blocked'; state.status = 'blocked'; state.error = 'Подходящее оформление пока не найдено. Всё содержание сохранено.' }
    else { slide.variantId = result.variantId; slide.tried.push(result.variantId); slide.selectRequested = false; slide.status = 'pending' }
  }
  job.applied = true; job.status = 'complete'
}
export function settleReview(state: DeckState) {
  const round = state.rounds.at(-1)!, results = reviewGroups(round).flatMap(g => (state.jobs.find(j => j.spec.key === g.id && j.status === 'complete')!.result as VisualReview).slides)
  const rejected = results.filter(r => r.verdict === 'revise')
  for (const target of round.targets) {
    const slide = state.slides.find(s => s.id === target.slideId)!, attempt = slide.attempts.find(a => a.number === slide.fittedAttempt)
    if (attempt?.sceneHash !== target.sceneHash) throw new Error('Visual review no longer matches the rendered deck')
  }
  round.settled = true
  if (!rejected.length) { state.slides.forEach(s => s.status = 'ready'); state.status = 'ready'; return }
  if (round.number >= MAX_VISUAL_ROUNDS) { state.status = 'blocked'; state.error = 'Слайды собраны, но часть оформления ещё не прошла визуальную проверку. Результат и исходный текст сохранены.'; return }
  for (const result of rejected) {
    const slide = state.slides.find(s => s.id === result.slideId)!
    slide.correctionRound = round.number; slide.selectRequested = result.action === 'reselect'; slide.status = 'pending'
    slide.visualIssues = result.issues.map(i => ({ code: `visual-${i.category}`, message: `${i.evidence} Исправление: ${i.instruction}` }))
  }
}
