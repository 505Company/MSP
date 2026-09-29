import type { EditableCatalog, EditableTemplate } from '../lib/design-system/editable-contract'
import { sourceCandidate, type SourceCandidate } from '../lib/component-lab/source'
import { sampleContent, shapes, type SampleName } from '../lib/component-lab/cases'
import { LAB_VERSION, MINIMUM_TEXT_CONTRAST, behaviorFor, behaviorSchema, rulesSchema, type ComponentContent, type ComponentMeasurement, type ComponentProfile, type ComponentRules, type ComponentState } from '../lib/component-lab/contract'
import { emptyRules } from '../lib/component-lab/rules'
import { componentLibraryPath } from '../lib/component-lab/links'
import type { RuleHistory, RuleRevision } from '../lib/component-lab/storage'
import { measureComponent, type FontEvidence } from '../browser/component-lab/measure'
import { resolveComponentFonts } from '../browser/component-lab/fonts'
import { editableOriginal, otherOriginal, type OriginalPreview } from '../browser/component-lab/original'
import { checkQuality, qualityProof, type QualityReport } from '../browser/component-lab/qualification'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import { hydrateEditableHtml } from '../lib/design-system/editable-hydrate'
import { editorView, esc, names } from './view'
import { preparationStatus } from './preparation-status'

export type EditorOptions = {
  uploadId?: string
  componentId?: string
  workspace?: boolean
  onSelect?: (componentId: string) => void
  onBack?: (href: string) => void
}

/** One editor per mounted workspace. All controls and async work belong to it. */
export function mountComponentEditor(root: HTMLElement, options: EditorOptions = {}) {
const lifecycle = new AbortController()
let disposed = false
const fetch = (url: string, init?: RequestInit) => window.fetch(url, { ...init, signal: lifecycle.signal })
const $ = <T = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T
const select = (id: string) => $<HTMLSelectElement>(id), input = (id: string) => $<HTMLInputElement>(id)
root.classList.add('component-editor')
if (options.workspace) root.classList.add('component-editor-workspace')
root.innerHTML = editorView(!!options.workspace)
let upload = options.uploadId ?? new URL(location.href).searchParams.get('upload') ?? '', candidates: SourceCandidate[] = [], selected: SourceCandidate | undefined, profile: ComponentProfile | undefined
let fonts: FontEvidence = { css: '', available: [] }, content: ComponentContent = {}, report: QualityReport | undefined, measurement: ComponentMeasurement | undefined
let rules = emptyRules(), history: RuleHistory = { head: null, versions: [] }, baseRevision: string | null = null, dirty = false, storageReady = false
let revision = 0, rulesRevision = 0, editTimer: ReturnType<typeof setTimeout> | undefined, matrix: AbortController | undefined, loading = false
let preparation: ReturnType<typeof preparationStatus> | undefined
const notice = (message: string) => { if (!disposed) $('notice').textContent = message }
const draftKey = () => `msp-component-rules:${upload}:${selected?.profile?.fingerprint}`
const endpoint = () => `/api/uploads/${encodeURIComponent(upload)}/component-profiles?component=${encodeURIComponent(selected!.template.id)}`
const saveStatus = (message: string) => { if (!disposed) $('save-status').textContent = message }
const needsRecheck = () => !!history.versions[0]?.proof && history.versions[0].proof.version !== LAB_VERSION
function busy(value: boolean) {
  if (disposed) return
  loading = value
  for (const el of root.querySelectorAll<HTMLInputElement>('input,select,textarea,button:not(#cancel)')) el.disabled = value
  if (!value) {
    if (!profile) for (const el of root.querySelectorAll<HTMLInputElement>('[data-adaptive-controls] input,[data-adaptive-controls] select,[data-adaptive-controls] textarea,[data-adaptive-controls] button')) el.disabled = true
    $<HTMLButtonElement>('run').disabled = !profile; $<HTMLButtonElement>('save').disabled = !profile || !storageReady || !(dirty || needsRecheck())
    $<HTMLButtonElement>('download').disabled = !report; $<HTMLButtonElement>('restore').disabled = !history.versions.length; $<HTMLButtonElement>('reset').disabled = !dirty
  }
}
function cancelMatrix() { matrix?.abort(); $('cancel').hidden = true }
function invalidateQuality() { report = undefined; $('cases').replaceChildren(); $('progress').textContent = 'Ещё не проверено'; $('quality-note').textContent = `Пять форм и разные тексты. Проверка выполняется автоматически при сохранении. Порог контраста: ${MINIMUM_TEXT_CONTRAST.toFixed(1)}.`; $<HTMLButtonElement>('download').disabled = true }
function clearResults() { invalidateQuality(); measurement = undefined; $('preview').replaceChildren(); $('source-preview').replaceChildren(); $('result').replaceChildren(); $('font-note').hidden = true; $('dimensions').textContent = ''; $('status').textContent = 'Ожидание'; delete $('status').dataset.status }
function adaptiveControls(available: boolean) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-adaptive-controls]')) el.hidden = !available
  $('unprepared-panel').hidden = available
}
function originalView(original: OriginalPreview, reason: string) {
  $('component-title').textContent = original.name; $('status').textContent = original.reconstructed ? 'Образец компонента' : 'Исходный вид'
  $('unprepared-reason').textContent = reason
  const source = $<HTMLAnchorElement>('original-slide')
  source.href = `/api/uploads/${encodeURIComponent(upload)}/assets/preview-s${String(original.slide).padStart(2, '0')}`
  source.hidden = false
  $('preview').replaceChildren(original.node); fitPreview()
  $('result').textContent = original.warnings.join('. ')
  notice('Компонент открыт. Для проверки разных форм сначала нужна его адаптация.')
}
function keepDraft() { try { localStorage.setItem(draftKey(), JSON.stringify({ rules, baseRevision })) } catch { saveStatus('Не удалось сохранить черновик в браузере. Сохраните правила перед закрытием.') } }
function discardDraft() { try { localStorage.removeItem(draftKey()) } catch { /* Server save remains authoritative. */ } }
const editingState = (): ComponentState => select('state').value === 'auto' ? measurement?.chosen?.state ?? profile?.preferred ?? 'vertical' : select('state').value as ComponentState
function fontNote() {
  const replacements = profile?.fontReplacements ?? []
  $('font-note').hidden = !replacements.length
  $('font-note').textContent = `${replacements.length > 1 ? 'Шрифты заменены' : 'Шрифт заменён'}: ${replacements.map(r => `${r.source} → ${r.family} (Google Fonts)${fonts.available.includes(r.family) ? '' : ' · загрузка недоступна'}`).join('; ')}.`
}
function controls() {
  if (!profile) return
  const state = editingState(), b = behaviorFor(profile, state), own = rules.states[state]
  $('scope').textContent = `Сейчас: ${names[state].toLowerCase()}. Правки относятся к этому виду.`
  for (const [id, value] of [['alignment', b.textAlign], ['position', b.position]]) for (const button of $(id).querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.value === value))
  select('gap').value = own?.gap === undefined ? '' : String(own.gap); input('padding').value = own?.padding === undefined ? '' : String(own.padding); input('content-width').value = String(b.contentWidth)
}
async function changed(next: ComponentRules) {
  if (!selected?.profile) return
  const token = ++rulesRevision
  rules = rulesSchema.parse(next); dirty = true; keepDraft(); invalidateQuality(); saveStatus('Есть несохранённые изменения'); $<HTMLButtonElement>('save').disabled = true
  busy(true)
  try {
    const resolved = await resolveComponentFonts(upload, selected.profile, rules)
    if (token !== rulesRevision) return
    rules = resolved.rules; profile = resolved.profile; fonts = resolved.fonts; keepDraft(); fontNote(); controls(); busy(false); await update()
  } catch (e) { if (token === rulesRevision) { busy(false); saveStatus(e instanceof Error ? e.message : 'Не удалось подготовить шрифты. Черновик сохранён.') } }
}
async function editBehavior(patch: Record<string, unknown>) {
  const state = editingState()
  try {
    const behavior = behaviorSchema.parse({ ...rules.states[state], ...patch })
    select('state').value = state
    await changed({ ...rules, states: { ...rules.states, [state]: behavior } })
  } catch { saveStatus('Отступ: 12–48; ширина содержимого: 50–100%.'); controls() }
}
function fields() {
  $('fields').replaceChildren()
  const labels = { number: 'Значение с единицей', caption: 'Подпись', ordinal: 'Номер', title: 'Заголовок', body: 'Описание', quote: 'Цитата', author: 'Автор' }
  for (const f of profile?.fields ?? []) {
    const label = document.createElement('label'); label.textContent = labels[f.role]
    const el = document.createElement('textarea'); el.rows = ['body', 'caption'].includes(f.role) ? 3 : 1; el.value = content[f.id] ?? ''; el.maxLength = 12000; el.dataset.field = f.id
    el.addEventListener('input', () => { content[f.id] = el.value; select('sample').value = 'custom'; clearTimeout(editTimer); editTimer = setTimeout(() => void update(), 180) }); label.appendChild(el); $('fields').appendChild(label)
  }
}
function fitPreview() {
  if (disposed) return
  const child = $('preview').firstElementChild as HTMLElement | null
  if (!child?.matches('[data-component-box],[data-original-preview]')) { $('preview').style.width = '100%'; $('preview').style.height = 'auto'; return }
  const scale = Math.max(.05, Math.min(1, ($('viewport').clientWidth - 32) / child.offsetWidth, 440 / Math.max(1, child.offsetHeight)))
  child.style.transformOrigin = 'top left'; child.style.transform = `scale(${scale})`; $('preview').style.width = `${child.offsetWidth * scale}px`; $('preview').style.height = `${child.offsetHeight * scale}px`
}
const observer = new ResizeObserver(fitPreview); observer.observe($('viewport'))
function previewMessage(title: string, message: string, action?: { label: string; run: () => void }) {
  const panel = document.createElement('div'); panel.className = 'preview-problem'
  panel.innerHTML = `<h3>${esc(title)}</h3><p>${esc(message)}</p>`
  if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.addEventListener('click', action.run); panel.appendChild(button) }
  $('preview').replaceChildren(panel); fitPreview()
}
function reason(issue: string) {
  if (issue.startsWith('font-unavailable:')) return `Не удалось загрузить шрифт: ${issue.slice(17)}`
  if (issue.startsWith('required-field:')) return 'Не заполнено обязательное поле'
  if (issue.startsWith('number-expected:')) return 'Значение должно начинаться с числа'
  if (issue.startsWith('ordinal-expected:')) return 'Номер должен содержать до трёх цифр'
  if (issue === 'container-height') return 'Содержанию нужна большая высота'
  if (issue === 'container-width') return 'Ширина за пределами поддержанного диапазона'
  if (issue.startsWith('field-overflow:')) return 'Текст выходит за доступную область'
  if (issue === 'field-overlap') return 'Текстовые поля пересекаются'
  return 'Этот вариант не прошёл проверку'
}
async function update() {
  if (!profile || loading || disposed) return
  const token = ++revision, width = Number(input('width').value), maxHeight = Number(input('height').value)
  if (!Number.isFinite(width) || !Number.isFinite(maxHeight) || width < 120 || width > 1200 || maxHeight < 60 || maxHeight > 1000) { measurement = undefined; $('preview').replaceChildren(); $('status').textContent = 'Проверьте размеры'; delete $('status').dataset.status; $('result').textContent = 'Ширина: 120–1200, высота: 60–1000.'; return }
  const detached = document.createElement('div'), state = select('state').value
  try {
    const result = await measureComponent(profile, { ...content }, { width, maxHeight, widthMode: 'fill', heightMode: select('height-mode').value as 'hug' | 'fill', ...(state === 'auto' ? {} : { allowedStates: [state as ComponentState] }) }, fonts, { target: detached })
    if (token !== revision) return
    measurement = result; $('preview').replaceChildren(...detached.childNodes); fitPreview(); controls()
    $('dimensions').textContent = `${width} × ${maxHeight}`
    $('status').textContent = { fits: 'Помещается', 'needs-space': 'Нужно больше места', incompatible: 'Проверьте текст', unavailable: 'Шрифт недоступен' }[result.status]; $('status').dataset.status = result.status
    $('result').innerHTML = result.status === 'fits' ? `<span>${names[result.chosen!.state]} · содержание занимает ${Math.ceil(result.chosen!.requiredHeight)} по высоте</span>` : `<span>${[...new Set(result.issues.map(reason))].map(esc).join('. ')}</span>${result.feasibleSizes.length ? `<p>Измеренные варианты: ${result.feasibleSizes.map(s => `${s.width} × ${s.height}`).join('; ')}.</p>` : ''}`
    if (result.status === 'needs-space') {
      // Offer only a recovery that was measured with the same text and rules.
      const automatic = { ...result.constraints }; delete automatic.allowedStates
      const alternative = state !== 'auto' ? await measureComponent(profile, { ...content }, automatic, fonts) : undefined
      if (token !== revision) return
      if (alternative?.status === 'fits') {
        previewMessage('В этом виде текст не помещается', `Для этой области подходит вид «${names[alternative.chosen!.state].toLowerCase()}». Текст и настройки сохранятся.`, { label: 'Подобрать вид', run: () => { select('state').value = 'auto'; void update() } })
      } else {
        const size = result.feasibleSizes.find(s => s.width <= 1200 && s.height <= 1000)
        previewMessage('Для текста недостаточно места', size ? `Проверенный размер: ${size.width} × ${Math.max(maxHeight, size.height)}. Текст и настройки сохранятся.` : 'Попробуйте большую область или другой вид. Текст и настройки сохранены.', size ? { label: 'Увеличить область', run: () => { input('width').value = String(size.width); input('height').value = String(Math.max(maxHeight, size.height)); void update() } } : undefined)
      }
    } else if (result.status !== 'fits') previewMessage(result.status === 'unavailable' ? 'Не удалось показать компонент' : 'Проверьте текст примера', [...new Set(result.issues.map(reason))].join('. '))
  } catch (e) { if (token === revision) { measurement = undefined; previewMessage('Проверка не завершена', 'Повторите изменение, чтобы проверить размещение.'); $('status').textContent = 'Проверка не завершена'; delete $('status').dataset.status; $('result').textContent = e instanceof Error ? e.message : String(e) } }
}
function historyView() { select('versions').innerHTML = history.versions.map(v => `<option value="${v.id}">Версия ${v.number} · ${v.proof && v.proof.version !== LAB_VERSION ? 'нужна новая проверка' : v.technical === 'passed' ? 'проверена' : 'черновик'}</option>`).join('') || '<option>Пока нет версий</option>' }
async function choose() {
  cancelMatrix(); clearTimeout(editTimer); const token = ++revision; ++rulesRevision
  selected = candidates.find(c => c.template.id === select('component').value); profile = undefined; storageReady = false; clearResults(); history = { head: null, versions: [] }; dirty = false; rules = emptyRules(); baseRevision = null
  const id = select('component').value
  preparation?.refresh()
  adaptiveControls(!!selected?.profile); busy(true); saveStatus('Загружаем настройки…')
  if (options.workspace) $<HTMLAnchorElement>('bank-link').href = componentLibraryPath(upload, id, selected?.template.kind)
  if (options.workspace) options.onSelect?.(id)
  else { const url = new URL(location.href); url.searchParams.set('component', id); window.history.replaceState(window.history.state, '', url) }
  if (!selected?.profile) {
    $('component-title').textContent = selected?.template.name ?? 'Загружаем компонент…'
    $('unprepared-reason').textContent = 'Проверяем исходную конструкцию…'; $('original-slide').hidden = true
    try {
      const original = selected ? await editableOriginal(upload, selected.template) : await otherOriginal(upload, id, lifecycle.signal)
      if (token !== revision) return
      if (original) {
        originalView(original, selected?.reason ?? 'Для этой конструкции нужен отдельный профиль адаптации')
        select('component').selectedOptions[0].textContent = `${original.name} · слайд ${original.slide}`
      } else {
        $('component-title').textContent = 'Компонент недоступен'
        $('unprepared-panel').hidden = true
        notice('Компонент отсутствует в текущей библиотеке. Вернитесь в компоненты дизайн-системы.')
      }
    } catch (e) { if (token === revision) { previewMessage('Исходный вид недоступен', 'Обновите страницу, чтобы повторить загрузку.'); notice(e instanceof Error ? e.message : 'Не удалось открыть компонент') } }
    if (token === revision) busy(false)
    return
  }
  const current = selected; $('component-title').textContent = current.profile!.name
  select('state').innerHTML = `<option value="auto">Подобрать по форме</option>${current.profile!.states.map(s => `<option value="${s}">${names[s]}</option>`).join('')}`
  try {
    const response = await fetch(endpoint()), data = await response.json() as RuleHistory & { error?: string }
    if (!response.ok) throw Error(data.error ?? 'Сохранение временно недоступно')
    if (token !== revision) return
    history = data as RuleHistory; baseRevision = history.head; rules = history.versions[0]?.rules ?? emptyRules(); storageReady = true
  } catch (e) { saveStatus(e instanceof Error ? e.message : 'Настройки недоступны') }
  if (token !== revision) return
  try { const draft = JSON.parse(localStorage.getItem(draftKey()) ?? 'null') as { rules: ComponentRules; baseRevision: string | null } | null
    if (draft) { rules = rulesSchema.parse(draft.rules); baseRevision = draft.baseRevision; dirty = true }
  } catch { /* An invalid browser draft never modifies server state. */ }
  let resolved: Awaited<ReturnType<typeof resolveComponentFonts>>
  try { resolved = await resolveComponentFonts(upload, current.profile!, rules) }
  catch (e) { if (token === revision) { busy(false); notice(e instanceof Error ? e.message : 'Не удалось подготовить шрифты') }; return }
  if (token !== revision) return
  const addedReplacement = JSON.stringify(resolved.rules) !== JSON.stringify(rules)
  if (addedReplacement) dirty = true
  rules = resolved.rules; profile = resolved.profile; fonts = resolved.fonts
  if (dirty) keepDraft()
  fontNote(); content = { ...current.content }; fields(); select('sample').value = 'source'; historyView()
  const original = document.createElement('div'); original.innerHTML = renderEditableHtml(current.template, current.template.data)
  try { if (current.profile!.fields.every(f => fonts.available.includes(f.font))) await hydrateEditableHtml(original, { loadFonts: false }); else original.textContent = 'Точный исходный шрифт недоступен.' } catch { original.textContent = 'Исходное превью недоступно' }
  if (token !== revision) return
  $('source-preview').replaceChildren(original); busy(false); notice('Настройте поведение, попробуйте разные формы и сохраните правила.')
  if (storageReady) saveStatus(dirty ? baseRevision !== history.head ? 'Есть более новая версия. Черновик сохранён; проверьте историю перед сохранением.' : addedReplacement ? 'Замена шрифта готова. Сохраните правила.' : 'Восстановлен ваш несохранённый черновик' : history.versions.length ? `Сохранена версия ${history.versions[0].number}${needsRecheck() ? ' · нужна новая проверка' : ''}` : 'Правила ещё не сохранены')
  await update()
}
async function load() {
  cancelMatrix(); const token = ++revision; clearResults(); busy(true); notice('Читаем исходные компоненты…')
  try {
    const response = await fetch(`/api/uploads/${encodeURIComponent(upload)}/editable-system`); if (!response.ok) throw Error('Не удалось открыть библиотеку')
    const { catalog, native } = await response.json() as { catalog?: EditableCatalog; native?: EditableTemplate[] }
    if (token !== revision) return
    const qualified = new Set(catalog?.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
    candidates = catalog ? await Promise.all(catalog.families.flatMap(f => f.variants).filter(t => qualified.has(t.id)).map(t => sourceCandidate(t, catalog.id))) : (native ?? []).map(template => ({ template, reason: 'Исходная конструкция сохранена. Её адаптация ещё не проверена.' }))
    if (catalog) {
      const derived = await fetch(`/api/uploads/${encodeURIComponent(upload)}/component-profiles?candidates=1`)
      if (derived.ok) { const data = await derived.json() as { candidates?: SourceCandidate[] }; if (data.candidates) candidates = data.candidates.filter(c => qualified.has(c.template.id)) }
    }
    if (token !== revision) return
    const requested = options.componentId ?? new URL(location.href).searchParams.get('component')
    select('component').innerHTML = candidates.map(c => `<option value="${esc(c.template.id)}">${esc(c.template.name)} · слайд ${c.template.slide}</option>`).join('')
    $('unsupported').innerHTML = candidates.filter(c => !c.profile).map(c => `<li><strong>${esc(c.template.name)}</strong><span>${esc(c.reason)}</span></li>`).join('')
    $<HTMLAnchorElement>('bank-link').href = `${options.workspace ? '' : 'http://127.0.0.1:5184'}/styles/${encodeURIComponent(upload)}?section=components`
    if (!options.workspace) { const url = new URL(location.href); url.searchParams.set('upload', upload); window.history.replaceState(window.history.state, '', url) }
    if (requested && !candidates.some(c => c.template.id === requested)) select('component').add(new Option('Загружаем компонент…', requested))
    if (requested) select('component').value = requested
    if (!select('component').value) { selected = undefined; profile = undefined; adaptiveControls(false); $('unprepared-panel').hidden = true; $('component-title').textContent = 'Нет доступных компонентов'; notice('Сначала завершите проверку импорта этого стиля.'); busy(false); return }
    await choose()
    if (options.workspace && !preparation && !lifecycle.signal.aborted) preparation = preparationStatus(root, upload, () => select('component').value, lifecycle.signal)
  } catch (e) { if (token !== revision) return; selected = undefined; profile = undefined; busy(false); notice(e instanceof Error ? e.message : String(e)) }
}
async function runCheck(signal: AbortSignal) {
  const result = await checkQuality(profile!, fonts, { signal, onCase: (c, done, total) => {
    signal.throwIfAborted()
    $('progress').textContent = `${done} из ${total}`; saveStatus(`Проверяем: ${done} из ${total}`)
    const card = document.createElement('article'); card.className = 'case'
    const status = c.evidence?.pixels.some(p => p.contrast < MINIMUM_TEXT_CONTRAST) ? 'Недостаточный контраст' : c.assertion === false || c.evidence && !c.evidence.passed ? 'Проверка провалена' : c.measurement.status === 'fits' ? 'Помещается · текст виден' : c.measurement.status === 'unavailable' ? 'Шрифт недоступен' : c.expect === 'explore' ? 'Вне вместимости' : 'Ожидаемый отказ'
    card.innerHTML = `${c.evidence ? `<img src="${c.evidence.preview}" alt="${esc(c.name)}" loading="lazy">` : '<div class="case-empty">Нет допустимого изображения</div>'}<h3>${esc(c.name)}</h3><p>${status}</p>`; $('cases').appendChild(card)
  } })
  signal.throwIfAborted()
  report = result; $('quality-note').textContent = `${report.technical === 'passed' ? 'Технические проверки пройдены' : 'Есть ошибки'}. Помещается ${report.coverage.fits} из ${report.coverage.tested}; читаемо ${report.coverage.readable} из ${report.coverage.fits}. Порог контраста ${MINIMUM_TEXT_CONTRAST.toFixed(1)}. Сохранённую версию проверяем в фоне перед использованием в презентациях.`
  return result
}
async function checkAndSave(save: boolean) {
  if (!profile || loading || save && !storageReady) return
  clearTimeout(editTimer); ++revision; matrix = new AbortController(); const signal = matrix.signal; busy(true); invalidateQuality(); $('cancel').hidden = false
  try {
    const result = await runCheck(signal); signal.throwIfAborted(); $('cancel').hidden = true
    if (save) {
      saveStatus('Сохраняем правила…')
      const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision, source: selected!.profile!.fingerprint, rules, proof: qualityProof(result) }) }), data = await response.json() as { revision?: RuleRevision; error?: string }
      if (!response.ok || !data.revision) throw Error(data.error ?? 'Не удалось сохранить. Черновик остался в браузере.')
      const v = data.revision; baseRevision = v.id; history = { head: v.id, versions: [v, ...history.versions].slice(0, 20) }; dirty = false; discardDraft(); historyView()
      saveStatus(`Сохранена версия ${v.number}${v.technical === 'passed' ? ' · проверка пройдена' : ' · есть замечания, сохранена как черновик'}`)
    } else saveStatus(dirty ? 'Проверка завершена. Правила ещё не сохранены.' : 'Проверка завершена.')
  } catch (e) { saveStatus(signal.aborted ? 'Проверка остановлена. Изменения остались в черновике.' : e instanceof Error ? e.message : String(e)) }
  finally { matrix = undefined; if (!disposed) { $('cancel').hidden = true; busy(false) } }
}
$('bank-link').addEventListener('click', event => { if (options.onBack && event instanceof MouseEvent && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); options.onBack($<HTMLAnchorElement>('bank-link').getAttribute('href')!) } })
select('style').addEventListener('change', () => { upload = select('style').value; void load() })
select('component').addEventListener('change', () => void choose())
for (const id of ['width', 'height', 'height-mode', 'state']) $(id).addEventListener('change', () => void update())
for (const [id, key] of [['alignment', 'textAlign'], ['position', 'position']]) $(id).addEventListener('click', event => { const value = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-value]')?.dataset.value; if (value) void editBehavior({ [key]: value }) })
select('gap').addEventListener('change', () => void editBehavior({ gap: select('gap').value ? Number(select('gap').value) : undefined }))
input('padding').addEventListener('change', () => void editBehavior({ padding: input('padding').value ? Number(input('padding').value) : undefined }))
input('content-width').addEventListener('change', () => void editBehavior({ contentWidth: Number(input('content-width').value) }))
select('sample').addEventListener('change', () => { if (!profile) return; const sample = select('sample').value; if (sample !== 'custom') content = sample === 'source' ? { ...selected!.content } : sampleContent(profile, sample as SampleName); fields(); void update() })
$('shapes').addEventListener('click', event => { const shape = shapes.find(s => s.id === (event.target as HTMLElement).closest<HTMLButtonElement>('[data-shape]')?.dataset.shape); if (shape) { input('width').value = String(shape.width); input('height').value = String(shape.maxHeight); select('state').value = 'auto'; for (const b of $('shapes').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.shape === shape.id)); void update() } })
$('save').addEventListener('click', () => void checkAndSave(true)); $('run').addEventListener('click', () => void checkAndSave(false)); $('cancel').addEventListener('click', cancelMatrix)
$('source-rules').addEventListener('click', () => void changed(emptyRules()))
$('restore').addEventListener('click', () => { const v = history.versions.find(v => v.id === select('versions').value); if (v) { baseRevision = history.head; void changed(v.rules) } })
$('reset').addEventListener('click', async () => { baseRevision = history.head; await changed(history.versions[0]?.rules ?? emptyRules()); dirty = false; discardDraft(); busy(false); saveStatus(history.versions[0] ? `Сохранена версия ${history.versions[0].number}` : 'Исходные правила восстановлены') })
$('download').addEventListener('click', () => { if (!report) return; const blob = new Blob([JSON.stringify({ profile, rules, revisionId: history.head, report }, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `component-quality-${profile?.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) })
void (async () => {
  try {
    if (options.workspace && upload) { await load(); return }
    const r = await fetch('/api/style-bank'); if (!r.ok) throw Error('Банк стилей недоступен')
    const data = await r.json() as { styles: { id: string; name: string }[] }
    if (disposed) return
    select('style').innerHTML = data.styles.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')
    if (upload) select('style').value = upload; else upload = select('style').value
    if (upload) await load(); else notice('Добавьте дизайн-систему в банк стилей')
  } catch { if (!disposed) notice('Не удалось открыть банк стилей. Обновите страницу, чтобы повторить.') }
})()
return {
  inspect: () => ({ measurement, report, profile, rules, revisionId: history.head, dirty }),
  dispose: () => { disposed = true; ++revision; ++rulesRevision; lifecycle.abort(); matrix?.abort(); clearTimeout(editTimer); observer.disconnect() },
}
}
