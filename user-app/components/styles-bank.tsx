"use client"
import { useEffect, useState } from 'react'
import { Layers3, Search } from 'lucide-react'
import { BankStyleCard } from './bank-style-card'
import { ImportStyle } from './import-style'
import { useWorkspaceData } from './workspace-data'
import type { BankStyle } from '@/lib/workspace/types'
import Link from './site-link'
import { subscribeUploadCancellation } from '@/lib/uploads/cancellation-client'
export function StylesBank({ preview = false }: { preview?: boolean } = {}) {
  const { data, error, reload } = useWorkspaceData<{ styles: BankStyle[] }>('/api/style-bank')
  const [query, setQuery] = useState('')
  useEffect(() => subscribeUploadCancellation(reload), [reload])
  const styles = data?.styles.filter(s => s.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))) ?? []
  return <div className={preview ? "msp-dashboard-section" : "ws-page pw"}>
    <header className="m2-section-heading"><h1>{preview ? 'Дизайн-системы' : 'Банк стилей'}</h1><div className="m2-heading-actions">{preview ? <Link className="m2-button m2-ghost" href="/styles">Смотреть все</Link> : <ImportStyle />}</div></header>
    {error && <div className="m2-empty" role="alert"><p>{error}</p><button className="pw-outline" onClick={reload}>Повторить</button></div>}
    {!data && !error && <p className="m2-skeleton" role="status">Открываем банк стилей…</p>}
    {!preview && data && data.styles.length > 1 && <label className="ws-search"><Search size={17} /><input type="search" aria-label="Найти дизайн-систему" placeholder="Найти дизайн-систему" value={query} onChange={e => setQuery(e.target.value)} /></label>}
    <div className="m2-card-grid">{styles.slice(0, preview ? 3 : undefined).map(style => <BankStyleCard key={style.id} style={style} onDeleted={reload} />)}</div>
    {data && !data.styles.length && <div className="m2-empty"><Layers3 size={30} /><h2>Добавьте первую дизайн-систему</h2><p>Импортируйте PPTX или PDF с оформлением. После разбора здесь появится его карточка.</p>{preview && <ImportStyle />}</div>}
    {!!data?.styles.length && !styles.length && <p className="m2-empty">По этому запросу ничего не найдено.</p>}
  </div>
}
