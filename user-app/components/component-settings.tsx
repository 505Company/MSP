"use client"

import { useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { componentSettingsPath } from '@/lib/component-lab/links'
import '@/component-lab/style.css'

/** Same editor and rule store as the development lab, in the normal app shell. */
export function ComponentSettings({ routePrefix = '' }: { routePrefix?: string } = {}) {
  const { id, componentId } = useParams<{ id: string; componentId: string }>()
  const router = useRouter(), root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true, dispose: (() => void) | undefined
    const host = root.current!
    void import('@/component-lab/editor').then(({ mountComponentEditor }) => {
      if (!active) return
      const editor = mountComponentEditor(host, {
        uploadId: id, componentId, workspace: true,
        onSelect: next => { if (next !== componentId) router.replace(routePrefix + componentSettingsPath(id, next)) },
        onBack: href => router.push(routePrefix + href),
      })
      dispose = editor.dispose
    }).catch(() => { if (active) host.textContent = 'Не удалось открыть настройки. Обновите страницу, чтобы повторить.' })
    return () => { active = false; dispose?.() }
  }, [id, componentId, router, routePrefix])
  return <div ref={root} className="component-editor component-editor-workspace" aria-label="Настройки компонента" />
}
