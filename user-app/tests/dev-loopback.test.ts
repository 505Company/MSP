import assert from 'node:assert/strict'
import { Agent, request } from 'node:http'
import type { Socket } from 'node:net'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { Miniflare } from 'miniflare'

// Regression for workers-sdk#14848: the module transport must survive an idle
// interval before the next SSR/HMR request. A closed pooled socket poisoned SSR.
test('local module transport keeps its connection after an idle interval', { timeout: 20000 }, async () => {
  const runtime = new Miniflare({
    port: 0, cf: false, liveReload: true, modules: true,
    script: `export default { fetch() {
      return new Response('<p>Ready</p>', { headers: { 'Content-Type': 'text/html' } });
    } }`,
  })
  const pool = new Agent({ keepAlive: true, maxSockets: 1 })
  try {
    const response = await runtime.dispatchFetch('http://localhost')
    const port = (await response.text()).match(/Miniflare Live Reload[\s\S]+?url\.port = (\d+)/)?.[1]
    assert.ok(port, 'live reload exposes the internal loopback address')
    const roundTrip = () => new Promise<Socket>((resolve, reject) => {
      let socket: Socket
      const req = request({ hostname: '127.0.0.1', port: Number(port), path: '/connection-check', agent: pool }, res => {
        res.resume()
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode !== 404) reject(new Error(`Unexpected status ${res.statusCode}`))
          else resolve(socket)
        })
      })
      req.on('socket', value => { socket = value })
      req.on('error', reject)
      req.end()
    })
    const first = await roundTrip()
    await setTimeout(6500)
    assert.equal(first.destroyed, false, 'the old five-second timeout must not close the transport')
    assert.equal(await roundTrip(), first, 'the pooled connection still serves requests')
  } finally {
    pool.destroy()
    await runtime.dispose()
  }
})
