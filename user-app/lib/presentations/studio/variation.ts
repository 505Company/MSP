import type { Candidate, SlideWork } from './contract'
import {semanticCandidatePriority} from './design-quality'

export type PreviousDesign = { signature: string; recipe: string; label: string; background?: string; components: string[]; regions: { x: number; y: number; w: number; h: number }[] }
export type GenerationVariation = { seed: string; mode: 'fast' | 'balanced' | 'creative'; sourceKey: string }
/** Stable within one saved run, fresh after an explicit new generation. */
export function variationRank(seed: string, value: string) {
  let n = 2166136261
  for (const c of `${seed}/${value}`) n = Math.imul(n ^ c.charCodeAt(0), 16777619)
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15
  return (n >>> 0) / 4294967296
}
export function recipeFamily(id: string) {
  return id.startsWith('composition/') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]
}
export function orderedCandidates(work: SlideWork): Candidate[] {
  const seed = `${work.variation?.seed}/${work.variation?.mode}/${work.content.id}`, previous = work.previousDesigns ?? []
  const cover = (c: Candidate) => c.recipeId === 'composition/library-cover'
  const display = (c: Candidate) => work.content.blocks.every(b=>b.kind==='text')&&work.content.blocks.filter(b=>b.role==='body').length<=5&&work.content.blocks.reduce((n,b)=>n+b.source.length,0)<900&&c.slots.some(s=>s.presentation?.typographyRole==='display')
  const count = (c: Candidate) => previous.slice(-6).filter(p => p.recipe === c.recipeId && (!cover(c) || p.background === c.backgroundId)).length
  // Keep all admissible candidates. History breaks repetitions; seeded ties
  // explore layouts, without prescribing one recipe to a generation mode.
  const direction=(c:Candidate)=>Number(c.artDirection!==(work.variation?.mode==='fast'?undefined:work.variation?.mode))
  const quality = (c: Candidate) => c.id.startsWith('composition/') ? 0 : c.authored ? .4 : .7
  return [...work.candidates].sort((a, b) => direction(a)-direction(b)||Number(cover(b)) - Number(cover(a)) || semanticCandidatePriority(work.content,a)-semanticCandidatePriority(work.content,b) || Number(display(b))-Number(display(a)) || count(a) - count(b) || (work.variation?quality(a) + variationRank(seed, a.id) - quality(b) - variationRank(seed, b.id):b.score-a.score))
}
