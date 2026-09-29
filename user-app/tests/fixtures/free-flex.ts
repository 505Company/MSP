import { pixelFixture } from './pixel-layout'
import { FREE_FLEX_VERSION, type FreeFlexPlan } from '../../lib/presentations/free-flex'
export function freeFlexFixture(component = false, native = false) {
  const { env } = pixelFixture(!native)
  env.input.content = env.input.content.filter(f => f.id !== 'direction')
  const ref = (fragmentId: string) => ({ fragmentId, start: 0, end: null })
  const plan: FreeFlexPlan = { version: FREE_FLEX_VERSION, rationale: 'Synthetic flex fixture', emphasis: [{ fragmentId: 'value1', importance: 1, reason: 'Main fact' }], nodes: [
    { id: 'root', parent: null, kind: 'flex', css: 'flex-direction:column;gap:40px;padding:64px;background-color:#ffffff;font-family:font-1;font-size:32px;line-height:1.2;color:#000000;', refs: [], component: null },
    { id: 'title', parent: 'root', kind: 'text', css: 'font-size:64px;font-weight:700;', refs: [ref('title')], component: null },
    { id: 'row', parent: 'root', kind: 'flex', css: 'flex:1 1 0;gap:48px;align-items:flex-start;', refs: [], component: null },
    { id: 'left', parent: 'row', kind: 'flex', css: 'flex:2 1 0;flex-direction:column;gap:24px;', refs: [], component: null },
    { id: 'heading', parent: 'left', kind: 'text', css: 'font-size:42px;font-weight:700;', refs: [ref('heading')], component: null },
    { id: 'body', parent: 'left', kind: 'text', css: '', refs: [ref('body')], component: null },
    { id: 'metric', parent: 'row', kind: component ? 'component' : 'flex', css: `width:540px;flex-direction:column;gap:24px;${native ? '' : 'padding:28px;'}`, refs: [],
      component: component ? { id: 'native-metric', mode: native ? 'native' : 'free-flow', fields: [
        { path: 'value', refs: [ref('value1')], css: 'font-family:font-1;font-size:90px;line-height:1.1;font-weight:700;color:#000000;' },
        { path: 'text', refs: [ref('label1')], css: 'font-family:font-1;font-size:32px;line-height:1.2;color:#000000;' },
      ] } : null },
    ...component ? [] : [
      { id: 'value', parent: 'metric', kind: 'text' as const, css: 'font-size:100px;font-weight:700;', refs: [ref('value1')], component: null },
      { id: 'caption', parent: 'metric', kind: 'text' as const, css: '', refs: [ref('label1')], component: null },
    ],
  ] }
  return { env, plan, hash: 'a'.repeat(64) }
}
