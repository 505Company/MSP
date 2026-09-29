import { cancellationKey, isUploadCancelled, UploadCancelledError } from './cancellation'

// The persistent marker is authoritative across workers/restarts. This registry
// only shortens cancellation latency for requests in the same worker (and HMR).
const runtime = globalThis as typeof globalThis & { __mspUploadControllers?: Map<string, Set<AbortController>> }
const controllers = runtime.__mspUploadControllers ??= new Map<string, Set<AbortController>>()
export async function uploadIsCancelled(bucket: R2Bucket, id: string) {
  return !!await bucket.head(cancellationKey(id))
}
export async function assertUploadActive(bucket: R2Bucket, id: string) {
  if (await uploadIsCancelled(bucket, id)) throw new UploadCancelledError()
}
export async function cancelUpload(bucket: R2Bucket, id: string) {
  await bucket.put(cancellationKey(id), JSON.stringify({ cancelledAt: new Date().toISOString() }), {
    httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' },
  })
  for (const controller of controllers.get(id) ?? []) controller.abort(new UploadCancelledError())
  // Fence scans started by older code too: they must own this lease before
  // sending another packet or publishing their catalog. Keep all source/cache.
  await bucket.delete(`semantic-scans/${id}/claim.json`)
}
export function uploadCancellationResponse(error: unknown): Response | undefined {
  if (isUploadCancelled(error)) return Response.json({ error: new UploadCancelledError().message, code: 'UPLOAD_CANCELLED' }, { status: 410 })
}
export async function withUploadCancellation<T>(bucket: R2Bucket, id: string, parent: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), signal = controller.signal
  const group = controllers.get(id) ?? new Set<AbortController>()
  group.add(controller); controllers.set(id, group)
  const onAbort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', onAbort, { once: true })
  if (parent?.aborted) onAbort()
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
  const check = async () => {
    await assertUploadActive(bucket, id)
    signal.throwIfAborted()
  }
  const poll = async () => {
    try { await check() } catch (error) { controller.abort(error) }
    if (!disposed && !signal.aborted) timer = setTimeout(poll, 2000)
  }
  try {
    await check()
    timer = setTimeout(poll, 2000)
    const result = await work(signal)
    await check() // A result racing with deletion must not be accepted.
    return result
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    disposed = true; clearTimeout(timer)
    parent?.removeEventListener('abort', onAbort)
    group.delete(controller); if (!group.size) controllers.delete(id)
  }
}
