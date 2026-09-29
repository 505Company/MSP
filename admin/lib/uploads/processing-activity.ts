let active = 0
const listeners = new Set<() => void>()
export const processingCount = () => active
export const processingServerSnapshot = () => 0
export function subscribeProcessing(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function beginProcessing() {
  active += 1
  for (const notify of listeners) notify()
  let ended = false
  return () => {
    if (ended) return
    ended = true; active -= 1
    for (const notify of listeners) notify()
  }
}
