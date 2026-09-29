"use client"
/* eslint-disable @next/next/no-img-element -- imported presentation previews */
import Link from '../site-link'
import { useWorkspaceData } from '../workspace-data'
import { ImportStyle } from '../import-style'
import type { BankStyle } from '@/lib/workspace/types'
import type { Project } from '@/lib/msp2/types'
import { Icon } from './shell'
import { Palette } from '../style-palette'
export { Palette } from '../style-palette'

type Summary = Omit<Project, 'text'> & { readyCount: number; slideCount: number; errorCount: number; previewUrl: string | null }
export function StyleChoice({ style, selected, onClick }: { style: BankStyle; selected: boolean; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={`m2-style-choice${selected ? ' is-selected' : ''}`}><Palette style={style} /><span><strong>{style.name}</strong><small>{style.componentCount} компонентов · {style.fonts[0] ?? 'Шрифты из шаблона'}</small></span><i className="m2-radio">{selected && <Icon name="check" />}</i></button>
}
export function Dashboard({ section = 'all' }: { section?: 'all' | 'styles' | 'projects' }) {
  const bank = useWorkspaceData<{ styles: BankStyle[] }>('/api/style-bank'), projects = useWorkspaceData<{ projects: Summary[] }>('/api/msp2/projects')
  return <div className="m2-dashboard">
    {section !== 'projects' && <section><div className="m2-section-heading"><h1>Дизайн-системы</h1><div className="m2-heading-actions">{section === 'all' ? <Link className="m2-button m2-ghost" href="/msp2/styles">Смотреть все</Link> : <ImportStyle destinationBase="/msp2/styles" />}</div></div>
      {bank.error ? <div className="m2-alert" role="alert">{bank.error}<button onClick={bank.reload}>Повторить</button></div> : !bank.data ? <div className="m2-skeleton" role="status">Загружаем дизайн-системы…</div> : !bank.data.styles.length ? <div className="m2-empty"><h2>Начните с вашей презентации</h2><p>Загрузите PPTX или PDF. MSP извлечёт оформление и создаст библиотеку компонентов.</p><ImportStyle destinationBase="/msp2/styles" /></div> : <div className="m2-card-grid">{bank.data.styles.slice(0, section === 'all' ? 3 : undefined).map(style => <Link key={style.id} className="m2-card" href={`/msp2/styles/${style.id}`}><div><span className="m2-tag">Дизайн-система</span><h2>{style.name}</h2><p>{style.slideCount} исходных слайдов. Цвета, типографика и компоненты вашей презентации.</p></div><div className="m2-card-preview">{style.previewId ? <img src={`/api/uploads/${style.id}/assets/preview-${style.previewId}`} alt={`Оформление ${style.name}`} /> : <Palette style={style} />}</div><footer><span>{style.componentCount} компонентов</span><i><Icon name="cardArrow" /></i></footer></Link>)}</div>}
    </section>}
    {section !== 'styles' && <section><div className="m2-section-heading"><h1>Проекты</h1>{section === 'all' && <Link className="m2-button m2-ghost" href="/msp2/projects">Смотреть все</Link>}</div>
      {projects.error ? <div role="alert" className="m2-alert">{projects.error}<button onClick={projects.reload}>Повторить</button></div> : !projects.data ? <div className="m2-skeleton" role="status">Загружаем проекты…</div> : !projects.data.projects.length ? <div className="m2-empty"><h2>Ваша следующая презентация — здесь</h2><p>Добавьте содержание, выберите дизайн-систему и создайте первые слайды в MSP 2.</p><Link className="m2-button m2-primary" href="/msp2/create"><Icon name="generate" />Создать презентацию</Link></div> : <div className="m2-card-grid">{projects.data.projects.slice(0, section === 'all' ? 6 : undefined).map(project => <Link key={project.id} className="m2-card" href={`/msp2/projects/${project.id}`}><div><span className="m2-tag">{project.readyCount === project.slideCount ? 'Готово' : project.errorCount ? 'Нужна проверка' : 'В работе'}</span><h2>{project.name}</h2><p>{project.styleName}</p></div><div className="m2-card-preview">{project.previewUrl ? <img src={project.previewUrl} alt={project.name} /> : <span className="m2-placeholder">{String(project.slideCount).padStart(2, '0')}<small>слайдов</small></span>}</div><footer><span>{project.readyCount} из {project.slideCount} слайдов</span><i><Icon name="cardArrow" /></i></footer></Link>)}</div>}
    </section>}
  </div>
}
