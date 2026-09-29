"use client"
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Presentation, Search } from 'lucide-react'
import { PresentationInput } from './presentation-input'
import { ProjectCard } from './project-card'
import { useWorkspaceData } from './workspace-data'
import type { ProjectSummary } from '@/lib/workspace/types'
import Link from './site-link'

export function ProjectList({ preview = false }: { preview?: boolean } = {}) {
  const { data, error, reload } = useWorkspaceData<{ projects: ProjectSummary[] }>('/api/projects')
  const [query, setQuery] = useState('')
  const projects = data?.projects.filter(p => `${p.name} ${p.styleName}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) ?? []
  useEffect(() => {
    const refresh = () => { if (!document.hidden) reload() }
    const timer = data?.projects.some(p => p.status === 'working') ? window.setInterval(refresh, 5000) : undefined
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [data, reload])
  return <>
    <header className="m2-section-heading"><h1>Проекты</h1>{preview && <Link className="m2-button m2-ghost" href="/projects">Смотреть все</Link>}</header>
    {error && <div className="m2-empty" role="alert"><p>{error}</p><button className="pw-outline" onClick={reload}>Повторить</button></div>}
    {!data && !error && <p className="m2-skeleton" role="status">Открываем проекты…</p>}
    {!preview && <div className="msp-project-tools">
      <label className="ws-search"><Search size={17} /><input type="search" aria-label="Найти проект" placeholder="Найти проект" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <Link className="m2-button m2-white" href="/projects?new=1"><Plus size={18} />Новый проект</Link>
    </div>}
    <div className="m2-card-grid" aria-label="Сохранённые проекты">{projects.slice(0, preview ? 6 : undefined).map(project => <ProjectCard key={project.id} project={project} />)}</div>
    {data && !data.projects.length && <div className="m2-empty"><Presentation size={30} /><h2>Создайте первую презентацию</h2><p>Добавьте содержание и выберите стиль. Готовые слайды появятся в проекте.</p><Link className="m2-button m2-primary" href="/create">Создать презентацию</Link></div>}
    {!!data?.projects.length && !projects.length && <p className="m2-empty">По этому запросу ничего не найдено.</p>}
  </>
}

export function ProjectsPage() {
  const params = useSearchParams()
  const creating = params.has('new') || params.has('template')
  return <div className="ws-page ws-project-page pw">
    {creating ? <><Link className="ws-back" href="/projects"><ArrowLeft size={15} />Все проекты</Link><header className="m2-intro"><h1>Новый проект</h1><p>Добавьте содержание и выберите дизайн-систему — мы соберём слайды в вашем стиле.</p></header><PresentationInput requestedStyle={params.get('template')} /></> : <ProjectList />}
  </div>
}
