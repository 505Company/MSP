"use client"
import { useParams, useSearchParams } from 'next/navigation'
import type { PresentationProject } from '@/lib/workspace/types'
import { useWorkspaceData } from './workspace-data'
import { PresentationInput } from './presentation-input'
import { ArrowLeft } from 'lucide-react'
import Link from './site-link'

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const { data, error, reload } = useWorkspaceData<{ project: PresentationProject }>(`/api/projects/${id}`)
  const project = data?.project
  return <div className="ws-page ws-project-page pw">
    {!project && <Link className="ws-back" href="/projects"><ArrowLeft size={15} />Все проекты</Link>}
    {error && <div className="ws-empty" role="alert"><p>{error}</p><button className="pw-outline" onClick={reload}>Повторить</button></div>}
    {!project && !error && <p role="status">Открываем проект…</p>}
    {project && <PresentationInput key={project.id} project={project} startGeneration={params.get('generate') === '1'} />}
  </div>
}
