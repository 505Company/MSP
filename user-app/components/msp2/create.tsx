"use client"
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from '../site-link'
import { useWorkspaceData, workspaceRequest } from '../workspace-data'
import { readContentFile } from '@/lib/workspace/content-file'
import { sourcePackets } from '@/lib/msp2/planner'
import type { BankStyle } from '@/lib/workspace/types'
import type { Project } from '@/lib/msp2/types'
import { Icon } from './shell'
import { StyleChoice } from './dashboard'

const DRAFT = 'msp2-draft-v1'
export function CreatePresentation({ project, onSaved }: { project?: Project; onSaved?: (project: Project) => void }) {
  const router = useRouter(), params = useSearchParams(), bank = useWorkspaceData<{ styles: BankStyle[] }>('/api/style-bank')
  const templateId = params.get('template')
  const [text, setText] = useState(project?.text ?? ''), [name, setName] = useState(project?.name ?? ''), [selected, setSelected] = useState(project?.uploadId ?? params.get('template') ?? '')
  const [mode, setMode] = useState<Project['mode']>(project?.mode ?? 'local'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [draftReady, setDraftReady] = useState(!!project), [draftSaved, setDraftSaved] = useState(false), [fileName, setFileName] = useState('')
  const input = useRef<HTMLInputElement>(null), createId = useRef('')
  const style = bank.data?.styles.find(s => s.id === selected) ?? (!selected ? bank.data?.styles[0] : undefined)
  let count = 0, parseError = ''
  if (text.trim()) try { count = sourcePackets(text).length } catch (e) { parseError = e instanceof Error ? e.message : 'Проверьте содержание.' }
  useEffect(() => {
    if (project) return
    try { const raw = localStorage.getItem(DRAFT); if (raw) { const d = JSON.parse(raw); if (typeof d.text === 'string') setText(d.text); if (typeof d.selected === 'string' && !templateId) setSelected(d.selected); if (d.mode === 'local' || d.mode === 'ai') setMode(d.mode) } } catch { /* The editable form still works when storage is unavailable. */ }
    setDraftReady(true)
  }, [project, templateId])
  useEffect(() => {
    if (!draftReady || project) return
    const timer = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ text, selected, mode })); setDraftSaved(true) } catch { setDraftSaved(false) } }, 350)
    return () => clearTimeout(timer)
  }, [text, selected, mode, draftReady, project])
  async function file(file: File) {
    setBusy(true); setError('')
    try { setText(await readContentFile(file)); setFileName(file.name) } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось прочитать файл.') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function generate() {
    if (!text.trim() || !style || parseError || busy) return
    setBusy(true); setError(''); createId.current ||= crypto.randomUUID()
    const payload = { id: project?.id ?? createId.current, name: (name || fileName.replace(/\.[^.]+$/, '') || text.trim().split('\n')[0].replace(/^#+\s*/, '')).slice(0, 120), text, uploadId: style.id, mode }
    try {
      const response = await workspaceRequest<{ project: Project }>(project ? `/api/msp2/projects/${project.id}` : '/api/msp2/projects', { method: project ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ...(project ? { baseRevision: project.revision } : {}) }) })
      sessionStorage.setItem(`msp2-start:${response.project.id}`, response.project.revision)
      if (!project) localStorage.removeItem(DRAFT)
      if (onSaved) onSaved(response.project); else router.push(`/msp2/projects/${response.project.id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать проект.'); setBusy(false) }
  }
  return <div className="m2-create">
    <header className="m2-intro"><span className="m2-eyebrow"><Icon name="sparkles" />{project ? 'Новая версия' : 'AI-генератор'}</span><h1>{project ? 'Обновите содержание презентации' : 'Создайте презентацию из вашего текста'}</h1><p>Добавьте содержание и выберите дизайн-систему — мы соберём слайды в вашем стиле.</p></header>
    <form onSubmit={e => { e.preventDefault(); void generate() }}>
      <div className="m2-form-grid"><section className="m2-form-card"><div className="m2-form-heading"><div><h2>Что нужно создать?</h2><p>Чем точнее вводные, тем сильнее получится первый вариант.</p></div><span className="m2-saved">● {draftSaved ? 'Черновик сохранён' : project ? 'Проект сохранён' : 'Новый черновик'}</span></div>
        {project && <label className="m2-name">Название<input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label>}
        <label className="m2-field-label" htmlFor="msp2-content">Задание <span>*</span></label>
        <div className="m2-text-area" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && e.dataTransfer.files[0]) void file(e.dataTransfer.files[0]) }}>
          <textarea id="msp2-content" style={{}} disabled={!draftReady} required value={text} onChange={e => { setText(e.target.value); setDraftSaved(false) }} maxLength={100000} placeholder="Добавьте заголовки слайдов, ключевые факты, пояснения и данные для графиков. Весь текст и числа сохранятся в презентации." />
          <p className="m2-tip"><Icon name="bulb" />Пустая строка разделяет слайды. Внутри слайда используйте обычный перенос.</p>
          <footer><button className="m2-button m2-outline" type="button" disabled={busy} onClick={() => input.current?.click()}><Icon name="clip" />Загрузить файл</button><span>{fileName || `${text.length.toLocaleString('ru-RU')} / 100 000`}<small>TXT, MD, CSV, TSV, JSON, XLSX · до 2 МБ</small></span><input ref={input} type="file" style={{}} hidden accept=".txt,.md,.csv,.tsv,.json,.xlsx" aria-label="Файл содержания" onChange={e => { if (e.target.files?.[0]) void file(e.target.files[0]) }} /></footer>
        </div><div className="m2-form-footer"><span>{count > 0 ? `${count} слайдов по вашим границам` : 'Содержание сохранится без переписывания'}</span></div>
      </section><section className="m2-form-card"><div className="m2-form-heading"><div><h2>Дизайн-система и параметры</h2><p>Выберите стиль и режим генерации презентации.</p></div></div>
        <div className="m2-style-options" role="radiogroup" aria-label="Дизайн-система">{bank.data?.styles.map(s => <StyleChoice key={s.id} style={s} selected={style?.id === s.id} onClick={() => setSelected(s.id)} />)}{!bank.data && !bank.error && <p role="status">Загружаем ваши дизайн-системы…</p>}{bank.data?.styles.length === 0 && <p>Сначала <Link href="/msp2/styles">добавьте дизайн-систему из презентации</Link>.</p>}</div>
        <div className="m2-settings"><h3><Icon name="settings" />Параметры</h3><label><span>Режим</span><select value={mode} onChange={e => setMode(e.target.value as Project['mode'])}><option value="local">Быстрый · без модели</option><option value="ai">Умный · Qwen</option></select></label><p>{mode === 'local' ? 'Сетка и иерархия рассчитываются по содержанию.' : 'Qwen выделяет смысловые блоки и выбирает компоненты. Сервис проверяет и рассчитывает вёрстку.'}</p></div>
        <div className="m2-form-footer"><span>Сначала проверяем, затем сохраняем</span><button className="m2-button m2-primary" disabled={busy || !style || !count || !!parseError} type="submit"><Icon name="generate" />{busy ? 'Создаём…' : 'Сгенерировать'}<Icon name="arrow" /></button></div>
      </section></div>{(error || parseError || bank.error) && <div className="m2-alert" role="alert">{error || parseError || bank.error}</div>}
    </form>
  </div>
}
