import { UploadCancelledError } from './cancellation'

type Listener = (id: string) => void
type Store = { ids: Set<string>; listeners: Set<Listener>; initialized?: boolean; channel?: BroadcastChannel }
declare global { interface Window { __mspCancelledUploads?: Store } }
const store: Store = typeof window === 'undefined' ? { ids: new Set(), listeners: new Set() }
  : window.__mspCancelledUploads ??= { ids: new Set(), listeners: new Set() }
const prefix = 'msp:cancelled-upload:'
const valid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)
function initialize() {
  if (typeof window === 'undefined' || store.initialized) return
  store.initialized = true
  window.addEventListener('storage', event => {
    if (event.key?.startsWith(prefix) && event.newValue === '1') cancelDesignSystem(event.key.slice(prefix.length), false)
  })
  if (typeof BroadcastChannel !== 'undefined') {
    store.channel = new BroadcastChannel('msp-design-cancellation')
    store.channel.onmessage = event => { if (valid(event.data?.uploadId)) cancelDesignSystem(event.data.uploadId, false) }
  }
}
export function designSystemIsCancelled(id: string) {
  initialize()
  if (store.ids.has(id)) return true
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(prefix + id) === '1' } catch { return false }
}
export function assertDesignSystemActive(id: string) {
  if (designSystemIsCancelled(id)) throw new UploadCancelledError()
}
export function cancelDesignSystem(id: string, broadcast = true) {
  if (!valid(id)) return
  initialize()
  const first = !store.ids.has(id)
  store.ids.add(id)
  try {
    localStorage.setItem(prefix + id, '1')
    for (const key of Object.keys(localStorage)) if (key.startsWith(`msp:auto-recovery:${id}:`)) localStorage.removeItem(key)
  } catch { /* Server marker remains authoritative. */ }
  for (const listener of store.listeners) listener(id)
  if (broadcast && first) store.channel?.postMessage({ uploadId: id })
}
export function subscribeUploadCancellation(listener: Listener) {
  initialize(); store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}
