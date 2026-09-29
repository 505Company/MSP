import test from 'node:test'
import assert from 'node:assert/strict'
import { freeFlexFixture } from './fixtures/free-flex'
import { validateFreeFlex, flexDeclarations, freeFlexTask } from '../lib/presentations/free-flex'
test('free flex retains model structure, individual emphasis and optional real components', () => {
  for (const useComponent of [false, true]) {
    const { env, plan } = freeFlexFixture(useComponent), before = JSON.stringify(plan)
    assert.deepEqual(validateFreeFlex(plan, env), plan)
    assert.equal(JSON.stringify(plan), before)
    const broken = structuredClone(plan); broken.nodes.find(n => n.id === 'body')!.refs = []
    assert.throws(() => validateFreeFlex(broken, env))
  }
})
test('cycles, duplicate content and non-flex positioning cannot bypass the contract', () => {
  const { env, plan } = freeFlexFixture()
  const cycle = structuredClone(plan); cycle.nodes[0].parent = 'left'
  assert.throws(() => validateFreeFlex(cycle, env))
  const duplicate = structuredClone(plan); duplicate.nodes.find(n => n.id === 'body')!.refs.push({ fragmentId: 'title', start: 0, end: null })
  assert.throws(() => validateFreeFlex(duplicate, env))
  for (const css of ['position:absolute;left:20px', 'display:grid', 'background-color:url(https://example.com)', 'font-size:30px!important', 'padding:-5px']) assert.throws(() => flexDeclarations(css))
  assert.doesNotThrow(() => flexDeclarations('flex:3 1 0;gap:25px;font-size:121px;margin-top:auto;'))
})
test('splitting source ranges can emphasize a number without deleting or duplicating words', () => {
  const { env, plan } = freeFlexFixture()
  env.input.content.find(f => f.id === 'body')!.text = '68% пользователей'
  const body = plan.nodes.find(n => n.id === 'body')!
  body.refs = [{ fragmentId: 'body', start: 0, end: 4 }, { fragmentId: 'body', start: 4, end: null }]
  assert.doesNotThrow(() => validateFreeFlex(plan, env))
  body.refs[1].start = 5
  assert.throws(() => validateFreeFlex(plan, env))
})
test('low and medium tasks differ only in the requested reasoning effort', () => {
  const { env } = freeFlexFixture()
  const low = freeFlexTask(env, 'data:image/png;base64,AA==', [], 'low'), medium = freeFlexTask(env, 'data:image/png;base64,AA==', [], 'medium')
  assert.deepEqual({ ...low, reasoningEffort: 'medium' }, medium)
  assert.equal(low.thinking, true)
  assert.equal(low.maxTokens, medium.maxTokens)
})
test('creative flex freedom still enforces library colours, fonts and native component ink', () => {
  const { env, plan } = freeFlexFixture(true)
  assert.throws(() => flexDeclarations('color:#abcdef;', env))
  assert.throws(() => flexDeclarations('font-family:Arial;', env))
  const c = plan.nodes.find(n => n.component)!
  c.component!.fields[0].css = 'color:#ffffff;'
  assert.throws(() => validateFreeFlex(plan, env))
  c.component!.fields[0].css = 'font-family:font-1;font-size:118px;'
  assert.doesNotThrow(() => validateFreeFlex(plan, env))
})
