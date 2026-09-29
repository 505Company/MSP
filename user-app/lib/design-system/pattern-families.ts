import {primitiveContains} from './pattern-geometry'
import type {PatternDefinition,PatternPart} from './pattern-contract'

/** Rasterisation changes fitted corner radii slightly. Compare normalised
 * silhouettes, not floating point JSON; keep genuinely different alphabets. */
export function samePatternPart(a:PatternPart,b:PatternPart){
 if(!a.primitive||!b.primitive||Math.abs(Math.log(a.aspect/b.aspect))>.075)return false
 let intersection=0,union=0
 for(let y=0;y<40;y++)for(let x=0;x<40;x++){
  const inA=primitiveContains(a.primitive,(x+.5)*a.aspect,y+.5,40*a.aspect,40)
  const inB=primitiveContains(b.primitive,(x+.5)*b.aspect,y+.5,40*b.aspect,40)
  if(inA||inB)union++;if(inA&&inB)intersection++
 }
 return intersection/Math.max(1,union)>=.965
}
export function samePatternFamily(a:PatternDefinition,b:PatternDefinition){
 return a.parts.every(p=>b.parts.some(q=>samePatternPart(p,q)))&&b.parts.every(p=>a.parts.some(q=>samePatternPart(p,q)))
}
