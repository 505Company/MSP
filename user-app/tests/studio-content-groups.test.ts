import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateCompact} from '../lib/presentations/studio/compact-content'
import {groupedReplies} from './fixtures/studio-content-groups'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {respectsPlacement} from '../lib/presentations/studio/recipe-variants'

test('all sixteen valid KPI splits retain four source groups and executable grouped layouts',()=>{
 const {packet,replies}=groupedReplies()
 for(const [mask,reply] of replies.entries()){
  const {content,proof}=validateCompact(reply,packet),body=content.blocks.filter(b=>b.role==='body')
  assert.equal(new Set(body.map(b=>b.sourceGroup?.id)).size,4,`source groups for split ${mask}`)
  assert.ok(body.every(b=>b.sourceGroup),`unbound source section for split ${mask}`)
  assert.deepEqual([...proof.atoms].sort(),packet.atoms.map(a=>a.id).sort())
  const layouts=candidatesFor(content).filter(c=>c.recipeId==='composition/source-groups')
  assert.ok(layouts.length,`layout for split ${mask}`)
  assert.ok(layouts.every(c=>respectsPlacement(c,content)))
  for(const layout of layouts)assert.deepEqual(layout.slots.flatMap(s=>s.blocks).sort(),content.blocks.map(b=>b.id).sort())
 }
})
