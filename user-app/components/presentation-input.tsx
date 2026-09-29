"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers3 } from 'lucide-react'
import Link from './site-link'
import { StyleThumbnail } from './style-palette'
import { Icon } from './msp2/shell'
import { useWorkspaceData, workspaceRequest, WorkspaceRequestError } from './workspace-data'
import { readContentFile } from '@/lib/workspace/content-file'
import {PresentationDataStatus} from './presentation-data-status'
import {dataMaterial} from '@/lib/presentations/data-material'
import {splitSlideText} from '@/lib/presentations/studio/text-boundaries'
import { PresentationHistory } from './presentation-history'
import type { GenerationSummary } from '@/lib/presentations/studio/generations'
import { PresentationStructureStatus } from './presentation-structure-status'
import type { BankStyle, PresentationProject } from '@/lib/workspace/types'

/** The public project surface collects inputs; the assembly engine stays out of this form. */
export function PresentationInput({ project, requestedStyle, startGeneration = false }: { project?: PresentationProject; requestedStyle?: string | null; startGeneration?: boolean }) {
  const router = useRouter()
  const { data: bank, error: bankError, reload } = useWorkspaceData<{ styles: BankStyle[] }>('/api/style-bank')
  const [generationMode, setGenerationMode] = useState<'fast'|'smart'|undefined>(project ? project.generationMode : 'fast')
  const [compositionMode,setCompositionMode]=useState<'recipes'|'components'>(project?.compositionMode??'recipes')
  const [historyMode,setHistoryMode]=useState<GenerationSummary['mode']>(project?.generationMode === 'smart' ? project.compositionMode === 'components' ? 'creative' : 'balanced' : 'fast')
  const recipeScope = 'all' as const
  const creative=generationMode==='smart'&&compositionMode==='components'
  const [modelRoute]=useState<'default'|'akashml-fp8'>(project?.modelRoute??'default')
  const [text, setText] = useState(project?.text ?? '')
  const [choice, setChoice] = useState(project?.uploadId ?? requestedStyle ?? '')
  const [saved, setSaved] = useState(project ?? null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [inputsOpen, setInputsOpen] = useState(!project)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null)
  const selectMode=useCallback((mode:GenerationSummary['mode'])=>{setHistoryMode(mode);setGenerationMode(mode==='fast'?'fast':'smart');setCompositionMode(mode==='creative'?'components':'recipes');setSaveError(null)},[])
  const [requestedRevision, setRequestedRevision] = useState(startGeneration ? project?.revision : undefined)
  const [runRevisions,setRunRevisions]=useState<string[]>(startGeneration&&project?[project.revision]:[])
  const generationSettled=useCallback((revision:string)=>{setRunRevisions(previous=>previous.includes(revision)?previous.filter(r=>r!==revision):previous)},[])
  const fileInput = useRef<HTMLInputElement>(null)
  const createId = useRef('')
  const dragDepth = useRef(0)
  const style = bank?.styles.find(s => s.id === choice) ?? (!choice ? bank?.styles[0] : undefined)
  const uploadId = style?.id ?? choice
  // A style removed from the bank is still a valid source for its existing project.
  const retainedStyle = !!saved && uploadId === saved.uploadId
  const styleReady = !!style || retainedStyle
  let structured=false, dataError=''
  try{structured=!!dataMaterial(text)}catch(e){dataError=e instanceof Error?e.message:'Проверьте формат данных'}
  let boundaryError=''
  if(text.trim()&&!structured&&!dataError)try{splitSlideText(text)}catch(e){boundaryError=e instanceof Error?e.message:'Проверьте границы слайдов'}
  const validText = !dataError && !boundaryError && !!text.trim() && text.length <= 100000 && !text.includes('\0')
  const dirty = saved ? text !== saved.text || uploadId !== saved.uploadId || generationMode !== saved.generationMode || compositionMode!==(saved.compositionMode??'recipes') || modelRoute!==(saved.modelRoute??'default') || recipeScope!==(saved.recipeScope??'all') : !!text.trim()

  useEffect(() => {
    if (!dirty || created) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, created])

  useEffect(() => {
    if (!saved || !dirty || !validText || !styleReady || busy || saving || saveError) return
    const timer = window.setTimeout(() => {
      setSaving(true)
      workspaceRequest<{ project: PresentationProject }>(`/api/projects/${saved.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: saved.revision, name: saved.name, text, uploadId, generationMode,compositionMode,modelRoute,recipeScope }),
      }).then(result => setSaved(result.project)).catch(e => {
        setSaveError({ message: e instanceof Error ? e.message : 'Не удалось сохранить изменения', conflict: e instanceof WorkspaceRequestError && e.status === 409 })
      }).finally(() => setSaving(false))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [saved, dirty, validText, styleReady, busy, saving, saveError, text, uploadId, generationMode,compositionMode,modelRoute,recipeScope])

  useEffect(() => {
    if (created && createId.current) router.push(`/projects/${createId.current}?generate=1`)
  }, [created, router])

  useEffect(() => {
    // Consume the explicit create action. Reopening a saved project is a read,
    // not permission to regenerate it after the compiler or style changes.
    if (startGeneration && project) router.replace(`/projects/${project.id}`)
  }, [startGeneration, project, router])

  async function importFile(file: File) {
    setBusy(true); setError('')
    try { setText(await readContentFile(file)); setFileName(file.name); if (!saveError?.conflict) setSaveError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось прочитать файл') }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }

  async function create() {
    if (!validText || !style) return
    setBusy(true); setError('')
    if (!createId.current) createId.current = crypto.randomUUID()
    const name = fileName.replace(/\.(txt|md|csv|tsv|json|xlsx)$/i, '').trim() || (structured?'Данные презентации':text.trim().split('\n')[0].replace(/^#+\s*/, '').trim()) || 'Новая презентация'
    try {
      await workspaceRequest('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: createId.current, uploadId: style.id, name: name.slice(0, 120), text, generationMode: generationMode ?? 'fast',compositionMode,modelRoute,recipeScope }),
      })
      setCreated(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать проект'); setBusy(false) }
  }

  async function generateSaved() {
    if (!saved) return
    // An explicit generation creates a new immutable run, including after an
    // engine update. Merely reopening the project still reads the saved run.
    setBusy(true); setError('')
    try {
      const next = await workspaceRequest<{project:PresentationProject}>(`/api/projects/${saved.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:saved.revision,name:saved.name,text,uploadId,generationMode:generationMode??'fast',compositionMode,modelRoute,recipeScope})})
      setSaved(next.project)
      // Freeze and enqueue this revision before another mode can save a new one.
      await workspaceRequest(`/api/projects/${saved.id}/compose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',revision:next.project.revision,compact:true})})
      setGenerationMode(next.project.generationMode);setRequestedRevision(next.project.revision);setRunRevisions(previous=>[...previous,next.project.revision])
      setHistoryMode(next.project.generationMode === 'fast' ? 'fast' : next.project.compositionMode === 'components' ? 'creative' : 'balanced')
      setInputsOpen(false)
    } catch(e) { setError(e instanceof Error?e.message:'Не удалось начать генерацию.') }
    finally { setBusy(false) }
  }

  return <div className="ws-presentation-input">
    <section className={saved ? 'msp-project-workspace' : undefined} aria-label={saved ? 'Настройки проекта' : undefined}>
    {saved && <><header className="m2-project-heading"><div><nav aria-label="Навигация проекта"><Link href="/projects">Проекты</Link><Icon name="right" /><span>Презентация</span></nav><h1>{saved.name}</h1></div>{!inputsOpen && <Link className="m2-project-style" href={`/styles/${saved.uploadId}`}>{style && <StyleThumbnail style={style} />}<span><strong>{saved.styleName}</strong><small>Дизайн-система презентации</small></span><Icon name="right" /></Link>}</header>
      <div className="msp-project-controls">
        <button type="button" className="m2-button m2-outline msp-input-toggle" aria-expanded={inputsOpen} aria-controls="project-inputs" onClick={() => setInputsOpen(open => !open)}><Icon name="settings" />Содержание и параметры<Icon name="right" /></button>
        <span className="ws-form-status" role="status">{saveError ? 'Изменения не сохранены' : dirty ? validText ? 'Сохраняем…' : 'Добавьте содержание, чтобы сохранить изменения' : 'Все изменения сохранены'}</span>
        {!inputsOpen && <button className="m2-button m2-primary" disabled={busy || saving || dirty || !validText || !styleReady || !!saveError || runRevisions.includes(saved.revision)} onClick={() => void generateSaved()}><Icon name="generate" />Сгенерировать слайды<Icon name="arrow" /></button>}
      </div></>}
    <div className="m2-form-grid" id="project-inputs" hidden={!!saved && !inputsOpen}>
      <section className="m2-form-card" aria-label="Содержание презентации">
        <div className="m2-form-heading"><div><h2>Что нужно создать?</h2><p>Добавьте текст, факты и данные для ваших слайдов.</p></div><span className={`m2-saved${!saved || dirty || saveError ? ' is-unsaved' : ''}`}>● {saved ? saveError ? 'Не сохранено' : dirty ? 'Сохраняем…' : 'Проект сохранён' : 'Новый проект'}</span></div>
        <label className="m2-field-label" htmlFor="presentation-content">Содержание презентации <span>*</span></label>
        <div className={`m2-text-area${dragging ? ' ws-input-dragging' : ''}`}
          onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true) } }}
          onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' } }}
          onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }}
          onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!busy && event.dataTransfer.files[0]) void importFile(event.dataTransfer.files[0]) }}>
          <textarea id="presentation-content" aria-describedby="presentation-content-help" maxLength={100000} value={text} disabled={busy} onChange={event => { setText(event.target.value); setFileName(''); setError(''); if (!saveError?.conflict) setSaveError(null) }}
            placeholder="Добавьте заголовки слайдов, ключевые факты, пояснения и данные для графиков. Весь текст и числа сохранятся в презентации." />
          <p id="presentation-content-help" className="m2-tip"><Icon name="bulb" />В обычном тексте разделяйте слайды пустой строкой. Для абзацев внутри слайда используйте заголовки «Слайд 1», «Слайд 2» или разделитель ---.</p>
          <footer><button type="button" className="m2-button m2-outline" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="clip" />Загрузить файл</button><span>{fileName || `${text.length.toLocaleString('ru-RU')} / 100 000`}<small>TXT, MD, CSV, TSV, JSON, XLSX · до 2 МБ</small></span></footer>
          <input ref={fileInput} type="file" accept=".txt,.md,.csv,.tsv,.json,.xlsx" hidden aria-label="Файл содержания" onChange={event => { if (event.target.files?.[0]) void importFile(event.target.files[0]) }} />
        </div>
      </section>
      <section className="m2-form-card" aria-label="Стиль презентации">
        <div className="m2-form-heading"><div><h2>Дизайн-система и параметры</h2><p>Выберите стиль и режим генерации презентации.</p></div></div>
        {bankError ? <div className="ws-input-empty" role="alert"><p>{bankError}</p><button className="m2-button m2-outline" onClick={reload}>Повторить</button></div>
          : !bank ? <p className="ws-form-status" role="status">Загружаем стили…</p>
          : <>
            {(bank.styles.length > 0 || retainedStyle) && <div className="m2-style-options" id="presentation-style" role="radiogroup" aria-label="Дизайн-система">
              {retainedStyle && !bank.styles.some(s => s.id === saved.uploadId) && <label className="m2-style-choice is-selected"><Layers3 size={32} /><span><strong>{saved.styleName}</strong><small>Оформление сохранённого проекта</small></span><input type="radio" name="presentation-style" value={saved.uploadId} checked disabled={busy} onChange={() => { setChoice(saved.uploadId); setSaveError(null); setError('') }} /></label>}
              {bank.styles.map(item => <label key={item.id} className={`m2-style-choice${uploadId === item.id ? ' is-selected' : ''}`}><StyleThumbnail style={item} /><span><strong>{item.name}</strong><small>{item.componentCount} компонентов · {item.fonts[0] ?? 'Шрифты из шаблона'}</small></span><input type="radio" name="presentation-style" value={item.id} checked={uploadId === item.id} disabled={busy} onChange={() => { setChoice(item.id); setSaveError(null); setError('') }} /></label>)}
            </div>}
            {!styleReady && <div className="ws-input-empty"><Layers3 size={28} /><p>{bank.styles.length ? 'Выберите стиль для презентации.' : 'Добавьте дизайн-систему, чтобы выбрать оформление.'}</p>{!bank.styles.length && <Link className="m2-button m2-outline" href="/styles">Открыть банк стилей</Link>}</div>}
          </>}
        <div className="m2-settings"><h3><Icon name="settings" />Параметры</h3>
          <fieldset className="ws-generation-mode" disabled={busy || saving}>
            <legend>Режим генерации</legend>
            <label className={!generationMode||generationMode==='fast'?'is-selected':''}><input type="radio" name="generation-mode" value="fast" checked={!generationMode||generationMode==='fast'} onChange={()=>selectMode('fast')}/><span><strong>Быстрый</strong><small>Автолейауты и готовые рецепты. Без ожидания модели.</small></span></label>
            <label className={generationMode==='smart'&&!creative?'is-selected':''}><input type="radio" name="generation-mode" value="balanced" checked={generationMode==='smart'&&!creative} onChange={()=>selectMode('balanced')}/><span><strong>Сбалансированный</strong><small>Qwen распределяет содержание, сервис заполняет готовые рецепты.</small></span></label>
            <label className={creative?'is-selected':''}><input type="radio" name="generation-mode" value="creative" checked={creative} onChange={()=>selectMode('creative')}/><span><strong>Творческий</strong><small>Qwen выбирает компоненты библиотеки, акценты и сетку слайда.</small></span></label>
          </fieldset>
        </div>
        <div className="m2-form-footer"><button className="m2-button m2-primary" disabled={busy || saving || !validText || !styleReady || !!saved && (dirty || !!saveError || runRevisions.includes(saved.revision))} onClick={saved ? generateSaved : create}><Icon name="generate" />{busy ? 'Подготовка…' : 'Сгенерировать слайды'}<Icon name="arrow" /></button></div>
      </section>
    </div>
    </section>
    <div className="msp-results">
    {saved && (saved.generationMode?<PresentationHistory key={saved.id} projectId={saved.id} name={saved.name} activeRevisions={runRevisions} onSettled={generationSettled} mode={historyMode} onModeChange={selectMode}/>:structured?<PresentationDataStatus projectId={saved.id} revision={saved.revision} uploadId={saved.uploadId} paused={dirty||!validText||Boolean(saveError)}/>:<PresentationStructureStatus projectId={saved.id} text={saved.text} uploadId={saved.uploadId} allowStart={requestedRevision === saved.revision} stylePaused={uploadId !== saved.uploadId} paused={text !== saved.text || !validText || Boolean(saveError)} />)}
    </div>
    {(error||dataError||boundaryError) && <p className="pw-error" role="alert">{error||dataError||boundaryError}</p>}
    {saveError && <div className="pw-error ws-input-error" role="alert"><p>{saveError.message}</p>{saveError.conflict ? <button className="pw-outline" disabled={busy || !validText || !style} onClick={create}>Сохранить отдельным проектом</button> : <button className="pw-outline" onClick={() => setSaveError(null)}>Повторить сохранение</button>}</div>}
  </div>
}
