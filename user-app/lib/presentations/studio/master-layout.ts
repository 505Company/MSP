import {masterContentArea} from '../../design-system/slide-masters'
import type {Box,Candidate,StudioLibrary} from './contract'

/** The source footer owns a fixed margin band. Allocate content above it;
 * fonts and source graphics are still measured at their real sizes. */
export function reserveMasterSpace(candidate:Candidate,library:StudioLibrary):Candidate{
 const master=library.backgrounds?.masters?.[0]
 if(!master||!candidate.slots.length)return candidate
 const area=masterContentArea(master),top=Math.min(...candidate.slots.map(s=>s.rect.y)),bottom=Math.max(...candidate.slots.map(s=>s.rect.y+s.rect.h))
 if(top>=area.y&&bottom<=area.y+area.h)return candidate
 const targetTop=Math.max(top,area.y),targetBottom=Math.min(bottom,area.y+area.h),ratio=Math.max(0,targetBottom-targetTop)/Math.max(1,bottom-top)
 const rect=(b:Box):Box=>({...b,y:targetTop+(b.y-top)*ratio,h:b.h*ratio})
 return {...candidate,slots:candidate.slots.map(s=>({...s,rect:rect(s.rect)})),
  ...(candidate.decorations?{decorations:candidate.decorations.map(d=>({...d,rect:rect(d.rect)}))}:{}),
  ...(candidate.authored?{authored:{...candidate.authored,regions:Object.fromEntries(Object.entries(candidate.authored.regions).map(([id,b])=>[id,rect(b)])),layers:candidate.authored.layers.map(l=>({...l,rect:rect(l.rect)}))}}:{})}
}
