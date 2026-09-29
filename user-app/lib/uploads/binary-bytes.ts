/** WebCrypto needs an ArrayBuffer-backed view. Keep the exact byte range and
 * never materialize an iterable of byte-sized numbers: TypedArray.from can
 * take that path in a browser and fatally allocate a huge intermediate array.
 * Shared/cross-realm backing stores use a bounded native copy instead. */
export function binaryView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', binaryView(bytes)))
  let hex = ''
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0')
  return hex
}
