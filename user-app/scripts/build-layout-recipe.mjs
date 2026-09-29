import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../lib/presentations/recipes/layout-engine-v1/', import.meta.url)
const bytes = await readFile(new URL('SOURCE.txt', root))
await writeFile(new URL('source.json', root), JSON.stringify({
  version: 'layout-engine-v1', sourceSha256: createHash('sha256').update(bytes).digest('hex'), text: bytes.toString('utf8'),
}, null, 2) + '\n')
