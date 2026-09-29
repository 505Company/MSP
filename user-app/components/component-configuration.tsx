"use client"

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { EditableTemplate } from '@/lib/design-system/editable-contract'
import { LAB_VERSION } from '@/lib/component-lab/contract'
import { componentSettingsPath } from '@/lib/component-lab/links'
import { sourceCandidate, type SourceCandidate } from '@/lib/component-lab/source'
import type { RuleHistory, RuleRevision } from '@/lib/component-lab/storage'
import Link from './site-link'
import './component-configuration.css'

function ConfiguredPreview({ uploadId, candidate, revision }: { uploadId: string; candidate: SourceCandidate; revision: RuleRevision }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('Готовим настроенный компонент…')
  useEffect(() => {
    const controller = new AbortController(), host = inner.current!, viewport = outer.current!
    const fit = () => {
      const child = host.firstElementChild as HTMLElement | null
      if (!child) return
      const scale = Math.min(1, Math.max(1, viewport.clientWidth - 32) / child.offsetWidth, 400 / child.offsetHeight)
      child.style.transformOrigin = 'top left'; child.style.transform = `scale(${scale})`
      host.style.width = `${child.offsetWidth * scale}px`; host.style.height = `${child.offsetHeight * scale}px`
    }
    const observer = new ResizeObserver(fit); observer.observe(viewport)
    void (async () => {
      const [{ applyRules }, { sourceFonts }, { measureComponent }] = await Promise.all([
        import('@/lib/component-lab/rules'), import('@/browser/component-lab/fonts'), import('@/browser/component-lab/measure'),
      ])
      const profile = await applyRules(candidate.profile!, revision.rules)
      if (profile.fingerprint !== revision.profile.fingerprint) throw Error('Сохранённые правила требуют повторной проверки.')
      const fonts = await sourceFonts(uploadId, profile)
      controller.signal.throwIfAborted()
      const result = await measureComponent(profile, candidate.content!, { width: 600, maxHeight: 400, widthMode: 'fill', heightMode: 'fill' }, fonts, { signal: controller.signal, target: host })
      controller.signal.throwIfAborted()
      setMessage(result.status === 'fits' ? '' : 'В этой форме компонент не помещается или недоступен шрифт. Откройте настройки, чтобы выбрать подходящий вид.')
      fit()
    })().catch(() => { if (!controller.signal.aborted) setMessage('Не удалось показать сохранённые правила. Откройте настройки для повторной проверки.') })
    return () => { controller.abort(); observer.disconnect() }
  }, [uploadId, candidate, revision])
  return <>
    <div ref={outer} className="component-configured-preview" aria-label="Компонент с сохранёнными правилами">
      <div ref={inner} />{message && <p role="status">{message}</p>}
    </div>
    {!!revision.rules.fontReplacements?.length && <p className="component-font-note">Шрифт заменён: {revision.rules.fontReplacements.map(r => `${r.source} → ${r.family} (Google Fonts)`).join('; ')}.</p>}
  </>
}

/** Opening a library card reads settings; it never starts a quality run or saves. */
export function ComponentConfiguration({ uploadId, catalogId, template, children }: { uploadId: string; catalogId?: string; template: EditableTemplate; children: ReactNode }) {
  const [state, setState] = useState<{ candidate: SourceCandidate; revision?: RuleRevision; error?: string } | null>(null)
  useEffect(() => {
    if (!catalogId) return
    const controller = new AbortController()
    void (async () => {
      const candidate = await sourceCandidate(template, catalogId)
      if (!candidate.profile) { if (!controller.signal.aborted) setState({ candidate }); return }
      try {
        const r = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/component-profiles?component=${encodeURIComponent(template.id)}`, { signal: controller.signal, cache: 'no-store' })
        if (!r.ok) throw Error('Не удалось загрузить сохранённые настройки.')
        const history = await r.json() as RuleHistory
        if (!controller.signal.aborted) setState({ candidate, revision: history.versions[0] })
      } catch { if (!controller.signal.aborted) setState({ candidate, error: 'Сохранённые настройки временно недоступны.' }) }
    })().catch(() => { /* The source preview remains available for unsupported input. */ })
    return () => controller.abort()
  }, [uploadId, catalogId, template])
  const revision = state?.revision
  const status = revision?.proof?.version !== LAB_VERSION ? 'нужна новая проверка' : revision?.technical === 'passed' ? 'техническая проверка пройдена' : 'черновик с замечаниями'
  return <>
    {revision && state ? <><ConfiguredPreview uploadId={uploadId} candidate={state.candidate} revision={revision} /><details className="component-original"><summary>Исходный образец</summary>{children}</details></> : children}
    {state?.candidate.profile && <div className="component-settings-entry">
      <div><strong>{revision ? `Настроено · версия ${revision.number}` : 'Адаптация компонента'}</strong><p>{state.error ?? (revision ? status : 'Выравнивание, отступы и проверка с разными текстами.')}</p></div>
      <Link className="pw-outline" href={componentSettingsPath(uploadId, template.id)}><SlidersHorizontal size={16} aria-hidden="true" />Настроить компонент</Link>
    </div>}
  </>
}
