"use client"
import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useReconstruction } from './use-reconstruction'
import { EditableMarkup } from './editable-markup'
import { buildGraphicSystem, composeDiagram, type DiagramContent } from '@/lib/design-system/graphic-components'
import { diagramHtml, graphElements, type DiagramGraph } from '@/lib/design-system/diagram-graph'
import { flatten } from '@/lib/design-system/compiler'
import type { ReconstructionState } from '@/lib/design-system/reconstruction-contract'
import styles from './graphics-workbench.module.css'

function DiagramEditor({ uploadId, state }: { uploadId: string; state: ReconstructionState }) {
  const originals = state.results.filter(r => r.status === 'ready' && r.diagram)
  const system = useMemo(() => buildGraphicSystem(state), [state])
  const [sourceId, setSourceId] = useState(originals[0]?.id ?? '')
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [data, setData] = useState<DiagramContent>({ nodes: [{ id: 'n1', text: '' }, { id: 'n2', text: '' }], edges: [] })
  const [composed, setComposed] = useState<DiagramGraph | null>(null), nextId = useRef(3)
  const source = originals.find(r => r.id === sourceId) ?? originals[0], graph = editing ? composed : source?.diagram
  const html = graph ? diagramHtml(graph, uploadId) : ''
  const canCompose = system.components.some(c => c.role === 'block' && c.slots.length === 1 && !c.source.assetIds.length) && system.components.some(c => c.role === 'connector')
  function change(next: DiagramContent) { setData(next); setComposed(null); setError('') }
  async function build() {
    setBusy(true); setError(''); setComposed(null)
    try {
      if (data.nodes.some(n => !n.text.trim())) throw Error('Заполните текст каждого блока')
      const candidate = composeDiagram(system, data)
      const [{ ensureUploadFonts }, { hydrateEditableHtml }] = await Promise.all([import('@/browser/fonts'), import('@/lib/design-system/editable-hydrate')])
      await ensureUploadFonts(uploadId)
      const host = document.createElement('div'); host.innerHTML = diagramHtml(candidate, uploadId)
      const issues = await hydrateEditableHtml(host)
      if (issues.length) throw Error(issues[0])
      if (host.querySelector('[data-native-overflow="true"]')) throw Error('Текст не помещается. Сократите подпись или разделите её на несколько блоков.')
      setComposed(candidate)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось построить схему') }
    finally { setBusy(false) }
  }
  async function download() {
    if (!graph) return
    setBusy(true); setError('')
    try {
      const { writeEditablePptx } = await import('@/lib/slides/pptx'), elements = graphElements(graph)
      const ids = [...new Set(flatten(elements).flatMap(e => e.kind === 'raster' ? [e.assetId] : []))]
      const assets = await Promise.all(ids.map(async id => { const response = await fetch(`/api/uploads/${uploadId}/assets/${id}`); if (!response.ok) throw Error('Не удалось загрузить графику схемы'); return { id, bytes: new Uint8Array(await response.arrayBuffer()) } }))
      const bytes = await writeEditablePptx({ id: 'diagram', name: 'Схема', kind: 'compound', scene: { width: graph.width, height: graph.height, elements }, source: { slide: source?.candidate.slides[0] ?? 1, rootId: 'diagram', elementIds: graph.sourceIds, ancestorIds: [], assetIds: ids }, slots: [], fixedTextIds: [], semantics: [], issues: [] }, assets)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })), link = document.createElement('a')
      link.href = url; link.download = 'diagram.pptx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось скачать схему') }
    finally { setBusy(false) }
  }
  return <section className={styles.workbench} aria-label="Построение схем">
    <p className={styles.intro}>Исходные схемы сохраняют блоки и направления связей.{canCompose && ' Для новой схемы задайте текст блоков и соедините их — оформление берётся из этой дизайн-системы.'}</p>
    <div className={styles.controls}>
      {!!originals.length && <label>Схема из исходника<select aria-label="Схема из исходника" value={source?.id ?? ''} disabled={busy} onChange={e => { setSourceId(e.target.value); setEditing(false); setError('') }}>{originals.map(r => <option key={r.id} value={r.id}>{r.name} · слайд {r.candidate.slides.join(', ')}</option>)}</select></label>}
      {canCompose && <button type="button" className="pw-outline" disabled={busy} aria-pressed={editing} onClick={() => { setEditing(v => !v); setError('') }}>{editing ? 'Вернуться к исходной схеме' : 'Новая схема'}</button>}
    </div>
    {!originals.length && !canCompose && <p>{state.pending.length ? 'Схемы ещё обрабатываются. Уже готовые результаты сохраняются.' : 'В этой дизайн-системе пока нет проверенных блоков и связей для построения схем.'}</p>}
    {!!originals.length && !canCompose && <p>Исходные схемы доступны для просмотра и скачивания. Сборка новой схемы из этих блоков пока недоступна.</p>}
    {editing && <>
      <div className={styles.editor}>
        <div><h3>Блоки</h3><div className={styles.rows}>{data.nodes.map((n, i) => <div className={styles.row} key={n.id}>
          <label>Блок {i + 1}<textarea aria-label={`Блок ${i + 1}`} maxLength={1000} value={n.text} disabled={busy} placeholder="Текст блока" onChange={e => change({ ...data, nodes: data.nodes.map(node => node.id === n.id ? { ...node, text: e.target.value } : node) })} /></label>
          <button type="button" className={styles.remove} disabled={busy || data.nodes.length < 2} aria-label={`Удалить блок ${i + 1}`} onClick={() => change({ nodes: data.nodes.filter(node => node.id !== n.id), edges: data.edges.filter(e => e.from !== n.id && e.to !== n.id) })}><X size={16} /></button>
        </div>)}</div><button type="button" className="pw-outline" disabled={busy || data.nodes.length >= 32} onClick={() => change({ ...data, nodes: [...data.nodes, { id: `n${nextId.current++}`, text: '' }] })}>Добавить блок</button></div>
        <div><h3>Связи</h3><div className={styles.rows}>{data.edges.map((edge, i) => <div className={styles.row} key={i}>
          {(['from', 'to'] as const).map(end => <label key={end}>{end === 'from' ? 'Из блока' : 'В блок'}<select aria-label={`${end === 'from' ? 'Начало' : 'Конец'} связи ${i + 1}`} value={edge[end]} disabled={busy} onChange={e => change({ ...data, edges: data.edges.map((item, j) => i === j ? { ...item, [end]: e.target.value } : item) })}>{data.nodes.map((n, j) => <option key={n.id} value={n.id}>{j + 1}. {n.text.slice(0, 32) || 'Блок'}</option>)}</select></label>)}
          <button type="button" className={styles.remove} disabled={busy} aria-label={`Удалить связь ${i + 1}`} onClick={() => change({ ...data, edges: data.edges.filter((_, j) => i !== j) })}><X size={16} /></button>
        </div>)}</div>{!data.edges.length && <p>Пока без связей. Можно добавить ветвления и обратные связи.</p>}<button type="button" className="pw-outline" disabled={busy || data.nodes.length < 2 || data.edges.length >= 96} onClick={() => change({ ...data, edges: [...data.edges, { from: data.nodes[0].id, to: data.nodes[1].id }] })}>Добавить связь</button></div>
      </div>
      <div className={styles.actions}><button type="button" className="pw-primary" disabled={busy} onClick={() => void build()}>{busy ? 'Проверяем…' : 'Построить схему'}</button><small>Проверяем, что все подписи помещаются.</small></div>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {graph && <><div className={styles.diagramPreview} style={{background:graph.sourceSurface??graph.background}} aria-label={editing ? 'Новая схема' : 'Исходная схема'}><EditableMarkup html={html} uploadId={uploadId} /></div><div className={styles.caption}><span>{graph.nodes.filter(n => n.kind === 'block').length} блоков · {graph.edges.length} связей{editing ? ' · Новая композиция' : ` · Слайд ${source?.candidate.slides.join(', ')}`}</span><button className="pw-outline" type="button" disabled={busy} onClick={() => void download()}>Скачать редактируемую схему</button></div></>}
  </section>
}

export function DiagramWorkbench({ uploadId }: { uploadId: string }) {
  const { state, error, preparing } = useReconstruction(uploadId, true)
  if (!state) return <p role={error ? 'alert' : 'status'}>{error ?? 'Читаем схемы и связи…'}</p>
  return <>{preparing && <p role="status">Проверяем исходные блоки и связи…</p>}{error && <p role="alert">{error}</p>}<DiagramEditor key={state.revision} uploadId={uploadId} state={state} /></>
}
