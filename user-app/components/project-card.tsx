"use client"
/* eslint-disable @next/next/no-img-element -- saved local presentation previews */
import { Icon } from './msp2/shell'
import Link from './site-link'
import type { ProjectSummary } from '@/lib/workspace/types'

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const labels = { draft: 'Содержание сохранено', working: 'Создаём слайды', ready: 'Готово', blocked: 'Нужно продолжить', changed: 'Содержание изменено', saved: 'Сохранённый слайд' }
  return <article className="msp-card-container ws-project-tile"><Link className="m2-card" href={`/projects/${project.id}`} aria-label={`Открыть проект ${project.name}`}>
    <div><span className={`m2-tag ws-project-state ws-project-state-${project.status}`}>{labels[project.status]}</span><h2>{project.name}</h2><p>{project.styleName}</p></div>
    <div className="m2-card-preview">{project.previewUrl ? <img loading="lazy" src={project.previewUrl} alt={`Первый слайд проекта «${project.name}»`} /> : <span className="m2-placeholder">{String(project.slideCount).padStart(2, '0')}<small>слайдов</small></span>}</div>
    <footer><span>{project.slideCount ? project.status === 'working' || project.status === 'blocked' ? `${project.readyCount} из ${project.slideCount} слайдов` : `Слайдов: ${project.slideCount}` : new Date(project.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span><i><Icon name="cardArrow" /></i></footer>
  </Link></article>
}
