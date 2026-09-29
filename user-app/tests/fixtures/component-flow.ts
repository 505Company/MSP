import { adaptiveComponentFixture } from './adaptive-layout'
export function flowFixture(){const {input}=adaptiveComponentFixture(),t=input.components[0]
 t.sourceLayout!.graphic='<svg viewBox="0 0 500 240" width="100%" height="100%"><rect width="500" height="240" rx="8" fill="#EAF5F0"/><rect width="12" height="240" fill="#00784D"/></svg>'
 t.sourceLayout!.structure={panels:1,orientation:'vertical',inline:false}
 t.sourceLayout!.text.forEach(s=>{s.element.fontFamily='Play';s.element.styleRuns=s.element.styleRuns?.map(r=>({...r,fontFamily:'Play'}))})
 return t
}
