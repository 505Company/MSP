import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { loadConfigFromFile } from 'vite'

test('working app, browser tests and build cannot replace each other’s optimized modules', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const previous = process.env.MSP_TEST_STATE_PATH
  const cache = async (command: 'serve' | 'build', testState?: string) => {
    if (testState) process.env.MSP_TEST_STATE_PATH = testState
    else delete process.env.MSP_TEST_STATE_PATH
    const loaded = await loadConfigFromFile({ command, mode: command === 'build' ? 'production' : 'development' }, resolve(root, 'vite.config.ts'), root)
    assert.ok(loaded)
    return resolve(root, loaded.config.cacheDir ?? 'node_modules/.vite')
  }
  try {
    const working = await cache('serve')
    const browserTests = await cache('serve', '.wrangler/test-state')
    const build = await cache('build')
    assert.notEqual(working, browserTests, 'Playwright must not overwrite the running app’s module cache')
    assert.notEqual(working, build, 'production builds must not overwrite the running app’s module cache')
    assert.notEqual(browserTests, build)
  } finally {
    if (previous === undefined) delete process.env.MSP_TEST_STATE_PATH
    else process.env.MSP_TEST_STATE_PATH = previous
  }
})
