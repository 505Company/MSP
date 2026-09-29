"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ImportIssueView } from '@/lib/design-system/import-issues'

export function ImportIssues({ uploadId }: { uploadId: string }) {
  const [{ omissions, accounted }, setIssues] = useState<ImportIssueView>({ omissions: [], accounted: [] })
  useEffect(() => {
    const controller = new AbortController()
    const read = () => void fetch(`/api/uploads/${uploadId}/import-issues`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) return
      const data = await response.json() as ImportIssueView
      if (!controller.signal.aborted) setIssues({ omissions: data.omissions, accounted: data.accounted ?? [] })
    }).catch(() => { /* The primary import status still reports unavailable storage. */ })
    read(); window.addEventListener('design-system:ready', read); window.addEventListener('processing-jobs:changed', read)
    return () => { controller.abort(); window.removeEventListener('design-system:ready', read); window.removeEventListener('processing-jobs:changed', read) }
  }, [uploadId])
  if (!omissions.length && !accounted.length) return null
  return <details className="ss-warning" aria-label="Пропущенные элементы импорта">
    <summary>{omissions.length ? `Требуют внимания: ${omissions.length}` : 'Пропуски импорта учтены'}{accounted.length ? ` · учтено в компонентах: ${accounted.length}` : ''}</summary>
    {omissions.length > 0 && <><p>Эти элементы пока не добавлены. Остальные компоненты продолжают создаваться; исходные объекты сохранены.</p>
      <ul>{omissions.map((item, index) => <li key={index}><strong>{item.name}</strong>{item.slides.length ? ` · слайды ${item.slides.join(', ')}` : ''}<p>{item.reason}</p></li>)}</ul></>}
    {accounted.length > 0 && <details><summary>Учтено в компонентах: {accounted.length}</summary><p>Эти исходные объекты уже вошли в компоненты и прошли проверку отображения. Поддержка адаптивных состояний проверяется отдельно.</p>
      <ul>{accounted.map((item, index) => <li key={index}><Link href={`/styles/${uploadId}/components/${encodeURIComponent(item.componentId)}`}>{item.componentName}</Link>{` · слайд ${item.slides[0]}`}</li>)}</ul>
    </details>}
    <Link href={`/styles/${uploadId}?section=source`}>Посмотреть исходные слайды</Link>
  </details>
}
