"use client"
/* Source scene previews are rendered locally from the original assets. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react'
import type { ElementIR } from '@/vendor/drag/src/core/model'
import { assembleBackground, type BackgroundCatalog, type BackgroundSelection } from '@/lib/design-system/backgrounds'
import styles from './graphics-workbench.module.css'

function BackgroundPreview({ uploadId, scene, label }: { uploadId: string; scene: { width: number; height: number; elements: ElementIR[] }; label: string }) {
  const [result, setResult] = useState<{ scene: typeof scene; url?: string; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void import('@/lib/design-system/reconstruction-browser').then(m => m.scenePreview(scene.elements, scene.width, scene.height, uploadId, controller.signal, 1024)).then(url => {
      if (!controller.signal.aborted) setResult({ scene, url })
    }).catch(e => { if (!controller.signal.aborted) setResult({ scene, error: e instanceof Error ? e.message : 'Не удалось показать фон' }) })
    return () => controller.abort()
  }, [scene, uploadId])
  const current = result?.scene === scene ? result : null
  return <div className={styles.preview} style={{ aspectRatio: `${scene.width}/${scene.height}` }} aria-busy={!current}>
    {current?.url ? <img src={current.url} alt={label} /> : <span role={current?.error ? 'alert' : 'status'}>{current?.error ?? 'Готовим фон…'}</span>}
  </div>
}

function BackgroundEditor({ catalog, uploadId }: { catalog: BackgroundCatalog; uploadId: string }) {
  const first = catalog.presets[0]
  const [presetId, setPresetId] = useState(first?.id ?? '')
  const [selection, setSelection] = useState<BackgroundSelection>(first?.selection ?? { fillId: null, layers: [] })
  const [format, setFormat] = useState('source')
  const preset = catalog.presets.find(p => p.id === presetId) ?? first
  const size = format === 'square' ? { width: 900, height: 900 } : format === 'portrait' ? { width: 720, height: 1280 } : { width: preset?.width ?? 1280, height: preset?.height ?? 720 }
  const scene = useMemo(() => assembleBackground(catalog, selection, size), [catalog, selection, size.width, size.height]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!first) return <p>В исходнике пока не найдены самостоятельные фоны.</p>
  function choosePreset(id: string) {
    const next = catalog.presets.find(p => p.id === id)!
    setPresetId(id); setSelection(next.selection)
  }
  const patternValue = selection.layers.length > 1 ? 'source' : selection.layers[0]?.artworkId ?? ''
  return <section className={styles.workbench} aria-label="Фоны слайдов">
    <p className={styles.intro}>Заливка и графика образуют фон.{catalog.masters?.length?' Фирменный подвал сохраняется на слайдах.':''} Выберите исходный вариант или проверьте новое сочетание.</p>
    <div className={styles.controls}>
      <label>Вариант из исходника<select aria-label="Вариант из исходника" value={presetId} onChange={e => choosePreset(e.target.value)}>{catalog.presets.map(p => <option key={p.id} value={p.id}>{p.slides.length === 1 ? 'Слайд' : 'Слайды'} {p.slides.join(', ')}</option>)}</select></label>
      <label>Заливка<select aria-label="Заливка" value={selection.fillId ?? ''} onChange={e => setSelection({ ...selection, fillId: e.target.value || null })}><option value="">Без заливки</option>{catalog.fills.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>Графика поверх фона<select aria-label="Графика поверх фона" value={patternValue} onChange={e => {
        const art = catalog.artworks.find(a => a.id === e.target.value)
        setSelection({ ...selection, layers: e.target.value === 'source' ? preset.selection.layers : art ? [{ artworkId: art.id, placementId: art.placements[0].id }] : [] })
      }}><option value="">Без графики</option>{preset.selection.layers.length > 1 && <option value="source">Все слои исходного фона</option>}{catalog.artworks.map((a, i) => <option key={a.id} value={a.id}>{a.kind === 'panel' ? 'Панель' : a.kind === 'pattern' ? 'Паттерн' : 'Графика'} {i + 1} · слайд {a.placements[0].slide}</option>)}</select></label>
      <label>Формат<select aria-label="Формат" value={format} onChange={e => setFormat(e.target.value)}><option value="source">Как в исходнике</option><option value="square">Квадрат</option><option value="portrait">Вертикальный</option></select></label>
    </div>
    <BackgroundPreview uploadId={uploadId} scene={scene} label="Предпросмотр фона" />
    <div className={styles.caption}><span>Графика сохраняет пропорции и положение у края. Цвета внутри исходной картинки сохраняются.</span><button type="button" className="pw-outline" onClick={() => { setSelection(preset.selection); setFormat('source') }}>Вернуть исходный вариант</button></div>
    <small>Это предпросмотр сочетания. Исходные фоны остаются в библиотеке и доступны через общий каталог фонов.</small>
    {catalog.notes.map(note => <p key={note}>{note}</p>)}
  </section>
}

export function BackgroundWorkbench({ uploadId }: { uploadId: string }) {
  const [state, setState] = useState<{ catalog?: BackgroundCatalog; error?: string }>({})
  useEffect(() => {
    const c = new AbortController()
    void fetch(`/api/uploads/${uploadId}/backgrounds`, { signal: c.signal }).then(async response => {
      const data = await response.json() as BackgroundCatalog & { error?: string }; if (!response.ok) throw Error(data.error || 'Фоны недоступны'); return data
    }).then(catalog => setState({ catalog })).catch(e => { if (!c.signal.aborted) setState({ error: e instanceof Error ? e.message : 'Не удалось прочитать фоны' }) })
    return () => c.abort()
  }, [uploadId])
  if (!state.catalog) return <p role={state.error ? 'alert' : 'status'}>{state.error ?? 'Собираем фоны из исходных слоёв…'}</p>
  return <BackgroundEditor key={state.catalog.sourceCatalogId} uploadId={uploadId} catalog={state.catalog} />
}
