"use client"
/* eslint-disable @next/next/no-img-element -- previews are rendered from the original component scene */
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { componentSettingsPath } from '@/lib/component-lab/links'
import { Blocks, Atom, ExternalLink, X, ImageOff } from 'lucide-react'
import type { CatalogItem, CatalogPage } from '@/lib/design-system/catalog-types'
import { componentTagLabels, componentPreviewOnDark } from '@/lib/design-system/component-curation'
import { componentLabel, componentIssueText } from '@/lib/design-system/display'
import { createComponentPreviews, type ComponentPreview, type ComponentPreviews } from './component-previews'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

function ComponentTags({ item }: { item: CatalogItem }) {
  return <span className="cw-tags">{item.usage?.tags.map(tag => <span key={tag}>{componentTagLabels[tag]}</span>)}</span>
}

function ComponentCard({ item, previews, onOpen, dialog = false }: { item: CatalogItem; previews: ComponentPreviews; onOpen: (element: HTMLButtonElement) => void; dialog?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<ComponentPreview | null>(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false, started = false
    const load = () => {
      if (started) return
      started = true
      previews.get(item.id).then(value => { if (!cancelled) setPreview(value) }).catch(() => { if (!cancelled) setFailed(true) })
    }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer.disconnect() } }, { rootMargin: '240px' })
    if (ref.current) observer.observe(ref.current)
    return () => { cancelled = true; observer.disconnect() }
  }, [item.id, previews])
  const label = componentLabel(item), unavailable = failed || preview && !preview.report.dataUrl
  return <button ref={ref} className="cw-card" type="button" data-component-id={item.id} aria-label={'Открыть компонент «' + label + '»'} aria-haspopup={dialog ? 'dialog' : undefined} onClick={event => onOpen(event.currentTarget)}>
    <span className="cw-card-preview" data-tone={(preview ? componentPreviewOnDark(preview.definition.component, item.usage?.previewOnDark) : item.usage?.previewOnDark) ? 'dark' : 'light'}>
      <span className="cw-type-badge" title={item.kind === 'compound' ? 'Молекула' : 'Атом'} aria-label={item.kind === 'compound' ? 'Молекула' : 'Атом'}>{item.kind === 'compound' ? <Blocks size={16} strokeWidth={1.8} /> : <Atom size={17} strokeWidth={1.8} />}</span>
      {preview?.report.dataUrl ? <img src={preview.report.dataUrl} alt="" /> : unavailable ? <span className="cw-preview-empty"><ImageOff size={22} strokeWidth={1.5} /><span>Открыть подробности</span></span> : <span className="cw-preview-skeleton" aria-label="Готовим превью" />}
    </span>
    <span className="cw-card-body"><strong>{label}</strong><span className="cw-card-description">{item.sourceOnly && item.usage?.tags.includes('chart') ? 'Диаграмма из исходника. Значения встроены в изображение.' : item.usage?.description ?? 'Компонент из вашей дизайн-системы'}</span><ComponentTags item={item} />{item.sourceOnly && <span className="cw-variant-count">Исходная графика</span>}</span>
  </button>
}

function ComponentDetail({ item, previews, uploadId }: { item: CatalogItem; previews: ComponentPreviews; uploadId: string }) {
  const variant = item.family?.variants[0]
  return <VariantDetail key={variant?.id ?? item.id} item={{...item,id:variant?.id??item.id,usage:item.usage?{...item.usage,previewOnDark:variant?.previewOnDark??item.usage.previewOnDark}:undefined}} previews={previews} uploadId={uploadId} />
}
function VariantDetail({ item, previews, uploadId }: { item: CatalogItem; previews: ComponentPreviews; uploadId: string }) {
  const [preview, setPreview] = useState<ComponentPreview | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    previews.get(item.id).then(value => { if (!cancelled) { setPreview(value); setError('') } }).catch(() => { if (!cancelled) setError('Не удалось открыть компонент. Попробуйте ещё раз.') })
    return () => { cancelled = true }
  }, [item.id, previews, attempt])
  return <div className="cw-detail" data-component-id={item.id}>
    <div className="cw-title"><span className="cw-kind-label">{item.kind === 'compound' ? 'Молекула' : 'Атом'} · слайд {preview?.definition.component.source.slide ?? item.slide}</span><DialogTitle asChild><h3>{componentLabel(item)}</h3></DialogTitle><DialogDescription>{item.usage?.description ?? 'Компонент из вашей дизайн-системы'}</DialogDescription><ComponentTags item={item} /></div>
    <div className="cw-preview" data-tone={(preview ? componentPreviewOnDark(preview.definition.component, item.usage?.previewOnDark) : item.usage?.previewOnDark) ? 'dark' : 'light'} aria-busy={!preview && !error}>
      {preview?.report.dataUrl ? <img src={preview.report.dataUrl} alt={'Воспроизведённый компонент «' + componentLabel(item) + '»'} /> : <p role="status">{error || (preview ? 'Превью этого компонента пока недоступно.' : 'Готовим превью…')}</p>}
    </div>
    <p className="ds-note">{item.sourceOnly ? item.usage?.tags.includes('chart') ? 'Диаграмма сохранена как изображение. Её можно масштабировать пропорционально; для изменения значений нужны исходные данные.' : 'Исходная графика сохранена. Её можно масштабировать пропорционально; редактируемые поля не создавались.' : 'Система подбирает этот компонент и заполняет его данными при сборке презентации.'}</p>
    {error && <p className="pw-error" role="alert">{error}</p>}
    {error && <button className="pw-outline" onClick={() => setAttempt(n => n + 1)}>Повторить загрузку</button>}
    {preview && <div className="cw-check" aria-live="polite">{preview.report.fits && <p className="cw-ok">{item.family?"Компонент прошёл калибровку.":"Исходный вид воспроизведён."}</p>}{[...new Set(preview.report.issues.map(componentIssueText))].map(message => <p className="cw-issue" key={message}>{message}</p>)}</div>}
    <div className="cw-detail-source"><a href={'/api/uploads/' + uploadId + '/assets/preview-s' + String(preview?.definition.component.source.slide ?? item.slide).padStart(2, '0')} target="_blank" rel="noreferrer">Исходный слайд <ExternalLink size={13} /></a>{item.repeatCount > 1 && <span>Повторяется в шаблоне: {item.repeatCount}</span>}</div>
  </div>
}

export function ComponentWorkbench({ uploadId, section='components' }: { uploadId: string; section?:'components'|'graphics' }) {
  const router = useRouter()
  const routePrefix = usePathname().startsWith('/msp2/') ? '/msp2' : ''
  const focusId = useSearchParams().get('component') ?? ''
  const [catalog, setCatalog] = useState<CatalogPage | null>(null), [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null), focusOpened = useRef('')
  const previews = useMemo(() => createComponentPreviews(uploadId, catalog?.catalogId), [uploadId, catalog?.catalogId])
  useEffect(() => previews.retain(), [previews])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams(page ? { page: String(page) } : { component: focusId })
    query.set('section',section)
    fetch('/api/uploads/' + uploadId + '/catalog?' + query, { method: 'POST', signal: controller.signal }).then(async response => {
      const data = await response.json() as CatalogPage & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Не удалось открыть каталог')
      if (controller.signal.aborted) return
      setCatalog(data); setLoading(false); setError('')
      if (focusId && focusOpened.current !== focusId) {
        focusOpened.current = focusId
        const focused = data.items.find(item => item.id === (data.focusedId ?? focusId))
        if (focused && section === 'components') router.replace(routePrefix + componentSettingsPath(uploadId, focused.family?.variants[0]?.id ?? focused.id))
        else setSelected(focused ?? null)
      }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Не удалось открыть каталог'); setLoading(false) } })
    return () => controller.abort()
  }, [uploadId, page, focusId, attempt,section,router,routePrefix])
  useEffect(()=>{const refresh=()=>setAttempt(n=>n+1);window.addEventListener('design-system:ready',refresh);return()=>window.removeEventListener('design-system:ready',refresh)},[])
  function turnPage(next: number) { setLoading(true); setPage(next) }
  const pagination = catalog && catalog.pages > 1 && <div className="cw-pagination" aria-label="Страницы компонентов"><span role="status">{loading ? 'Загружаем…' : 'Страница ' + catalog.page + ' из ' + catalog.pages}</span><div><button className="pw-outline" disabled={loading || catalog.page <= 1} onClick={() => turnPage(catalog.page - 1)}>Назад</button><button className="pw-outline" disabled={loading || catalog.page >= catalog.pages} onClick={() => turnPage(catalog.page + 1)}>Дальше</button></div></div>
  if(section==='components'&&catalog&&!catalog.items.length&&!error)return null
  return <div className="cw cw-gallery" aria-label="Каталог компонентов">
    {error && <div className="pw-error" role="alert">{error} <button className="pw-text-button" onClick={() => setAttempt(n => n + 1)}>Повторить загрузку</button></div>}
    {!catalog && !error && <p role="status">Собираем компоненты…</p>}
    {catalog && <>{(section==='graphics'||pagination)&&<div className="cw-gallery-toolbar">{section==='graphics'&&<div><p>{catalog.total} графических компонентов</p></div>}{pagination}</div>}
      {!catalog.items.length && <p className="ds-note">В этом шаблоне пока нет доступных компонентов.</p>}
      <div className="cw-list cw-grid" aria-label="Атомы и молекулы" aria-busy={loading}>{catalog.items.map(item => <ComponentCard key={catalog.catalogId + ':' + item.id} item={item} previews={previews} dialog={section === 'graphics'} onOpen={element => { if (section === 'components') router.push(routePrefix + componentSettingsPath(uploadId, item.family?.variants[0]?.id ?? item.id)); else { trigger.current = element; setSelected(item) } }} />)}</div>
      {catalog.pages > 1 && <div className="cw-bottom-pagination">{pagination}</div>}
    </>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
      <DialogContent className="cw cw-dialog pw" showCloseButton={false} onCloseAutoFocus={event => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus() } }}>
        <DialogClose className="cw-dialog-close" aria-label="Закрыть компонент"><X size={20} /></DialogClose>
        {selected && <ComponentDetail key={selected.id} item={selected} previews={previews} uploadId={uploadId} />}
      </DialogContent>
    </Dialog>
  </div>
}
