import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export async function loadJson(path: string) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
}
export async function saveJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(temp, path)
}
export function inventory() {
  const db = new DatabaseSync('.wrangler/state/v3/r2/miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite', { readOnly: true })
  try { return db.prepare('SELECT key,blob_id FROM _mf_objects ORDER BY key').all() as { key: string; blob_id: string }[] }
  finally { db.close() }
}
export function applicationSnapshot() {
  const rows = inventory()
  const read = async (key: string) => {
    const row = rows.find(r => r.key === key)
    return row ? loadJson(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`) : null
  }
  const bucket = {
    async get(key: string) { const value = await read(key); return value === null ? null : { json: async () => value } },
    async list(options: R2ListOptions) { return { objects: rows.filter(r => r.key.startsWith(options.prefix ?? '')), truncated: false } },
    async put() { throw Error('Pixel pilot cannot write application storage') },
  } as unknown as R2Bucket
  return { rows, read, bucket }
}
export function diagnosticBucket(output: string) {
  const path = (key: string) => {
    if (!/^[a-zA-Z0-9_/.-]+$/.test(key) || key.includes('..')) throw Error('Invalid diagnostic key')
    return `${output}/model/${key}`
  }
  return {
    async get(key: string) { const value = await loadJson(path(key)); return value === null ? null : { json: async () => value, etag: digest(value) } },
    async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      const old = await loadJson(path(key)), condition = options?.onlyIf
      if (condition?.etagDoesNotMatch === '*' && old !== null || condition?.etagMatches && condition.etagMatches !== digest(old)) return null
      const parsed = JSON.parse(value); await saveJson(path(key), parsed)
      return { key, etag: digest(parsed) }
    },
  } as unknown as R2Bucket
}
