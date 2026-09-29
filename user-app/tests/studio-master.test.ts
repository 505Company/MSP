import test from 'node:test'
import assert from 'node:assert/strict'
import {slideMasterFixture} from './fixtures/slide-master'
import {studioFixture} from './fixtures/studio'
import {buildBackgroundCatalog} from '../lib/design-system/backgrounds'
import {masterContentArea} from '../lib/design-system/slide-masters'
import {reserveMasterSpace} from '../lib/presentations/studio/master-layout'
import {backgroundDesigns,libraryCoverCandidates} from '../lib/presentations/studio/visual-design'

test('new slide layout reserves the footer before measurement, without changing fields or type rules',()=>{
 const run=studioFixture(),f=slideMasterFixture()
 run.library.backgrounds=buildBackgroundCatalog(f.snapshot,f.library,'source')
 const original=run.slides[0].candidates[0],before=JSON.stringify(original),adapted=reserveMasterSpace(original,run.library),area=masterContentArea(run.library.backgrounds.masters![0])
 assert.ok(adapted.slots.every(s=>s.rect.y>=area.y&&s.rect.y+s.rect.h<=area.y+area.h+.001))
 assert.deepEqual(adapted.slots.map(s=>[s.blocks,s.presentation]),original.slots.map(s=>[s.blocks,s.presentation]))
 assert.deepEqual(reserveMasterSpace(adapted,run.library),adapted,'idempotent after measured reflow')
 assert.equal(JSON.stringify(original),before)
 assert.equal(reserveMasterSpace(original,{...run.library,backgrounds:undefined}),original,'existing libraries keep their layout')
})

test('footer does not disqualify a cover with side artwork',()=>{
 const run=studioFixture('fast','# Title\n\nExplanation'),f=slideMasterFixture()
 run.library.backgrounds=buildBackgroundCatalog(f.snapshot,f.library,'source')
 const designs=backgroundDesigns(run.library),area=masterContentArea(run.library.backgrounds.masters![0])
 assert.ok(designs.length>0)
 assert.ok(designs.every(d=>d.area.y+d.area.h<=area.y+area.h))
 assert.ok(libraryCoverCandidates(run.slides[0].content,run.library).length>0)
})
