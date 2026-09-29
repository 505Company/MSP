import {artDirectedCandidates} from './art-direction'
import type {SlideWork,StudioLibrary} from './contract'
import {componentBindings} from './bindings'
import {candidatesFor} from './recipes'
import {libraryCoverCandidates} from './visual-design'

/** Keep the model's exact component layout as a candidate, then compare it
 * with real recipes on the SAME frozen content. Creativity is not permission
 * to deliver a worse layout merely because it fits its rectangles. */
export function creativeRecipeChoices(work:SlideWork,library:StudioLibrary):SlideWork{
  if(!work.strictComponents||!work.plan)return work
  const proposal=work.candidates.find(c=>c.id===work.plan!.candidateId)!
  const candidates=[{...proposal,fixedComponents:work.plan.components,measuredFlow:work.flexNodes},...libraryCoverCandidates(work.content,library),...candidatesFor(work.content)]
  return {...work,strictComponents:undefined,candidates:artDirectedCandidates(work.content,candidates,library),bindings:Object.fromEntries(work.content.blocks.map(b=>{
    const all=[...work.bindings[b.id]??[],...componentBindings(b,library)]
    return [b.id,[...new Map(all.map(binding=>[binding.id,binding])).values()]]
  }))}
}
