import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256 } from '../lib/uploads/pptx-profiler'

test('binary hashing uses the exact byte view without consulting an iterator', async () => {
  const buffer = Uint8Array.of(99, 1, 2, 3, 88)
  const bytes = buffer.subarray(1, 4)
  bytes[Symbol.iterator] = function* () { throw new Error('binary-input-was-expanded-to-an-array'); yield 0 }
  assert.equal(await sha256(bytes), createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'))
  assert.deepEqual(buffer, Uint8Array.of(99, 1, 2, 3, 88))
})

test('binary hashing accepts shared backing stores without iteration or source mutation', async () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(7), 2, 3)
  bytes.set([4, 5, 6])
  bytes[Symbol.iterator] = function* () { throw new Error('binary-input-was-expanded-to-an-array'); yield 0 }
  assert.equal(await sha256(bytes), createHash('sha256').update(Buffer.from([4, 5, 6])).digest('hex'))
  assert.equal(bytes[1], 5)
})
