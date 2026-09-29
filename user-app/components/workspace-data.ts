"use client"
import { useCallback, useEffect, useState } from 'react'
export class WorkspaceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
export async function workspaceRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init), data = await response.json() as T & { error?: string }
  if (!response.ok) throw new WorkspaceRequestError(data.error ?? 'Не удалось выполнить запрос', response.status)
  return data
}
export function useWorkspaceData<T>(url: string) {
  const [state, setState] = useState<{ url: string; data: T | null; error: string }>({ url: '', data: null, error: '' })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    workspaceRequest<T>(url, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ url, data, error: '' })
    }).catch(e => { if (!controller.signal.aborted) setState({ url, data: null, error: e.message }) })
    return () => controller.abort()
  }, [url, version])
  return { ...(state.url === url ? state : { data: null, error: '' }), reload }
}
