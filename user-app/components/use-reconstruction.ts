"use client"
import { useEffect, useState } from 'react'
import type { ReconstructionState } from '@/lib/design-system/reconstruction-contract'

export function useReconstruction(uploadId: string, prepareNative = false) {
  const [result, setResult] = useState<{ state?: ReconstructionState; error?: string; preparing?: boolean }>({})
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      void fetch(`/api/uploads/${uploadId}/reconstruction`, { signal: controller.signal }).then(async response => {
        const data = await response.json() as ReconstructionState & { error?: string }; if (!response.ok) throw Error(data.error || 'Графика недоступна'); return data
      }).then(async state => {
        if (controller.signal.aborted) return
        setResult({ state, preparing: prepareNative })
        if (prepareNative) {
          const { prepareNativeDiagrams } = await import('@/lib/design-system/reconstruction-browser')
          const ready = await prepareNativeDiagrams(uploadId, state, controller.signal)
          if (!controller.signal.aborted) setResult({ state: ready })
        }
      }).catch(e => { if (!controller.signal.aborted) setResult(previous => ({ state: previous.state, error: e instanceof Error ? e.message : 'Не удалось прочитать графику' })) })
    }
    load(); window.addEventListener('design-system:ready', load)
    return () => { controller.abort(); window.removeEventListener('design-system:ready', load) }
  }, [uploadId, prepareNative])
  return result
}
