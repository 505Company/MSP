import { parseSceneElements } from '../../vendor/drag/src/core/page-ir'
import type { BoundsIR, ElementIR, GroupElementIR } from '../../vendor/drag/src/core/model'
import type { SourceElement, SourceSnapshot } from '../digital-designer/source-types'

type Matrix = [number, number, number, number, number, number]
const identity: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
function transform(e: ElementIR): Matrix {
  const b=e.bounds, r=e.rotation*Math.PI/180, rotation:Matrix=[Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0]
  return e.centeredTransform
    ? multiply(multiply(multiply(translate(b.x+b.width/2,b.y+b.height/2),rotation),[e.centeredTransform.flipH?-1:1,0,0,e.centeredTransform.flipV?-1:1,0,0]),translate(-b.width/2,-b.height/2))
    : multiply(translate(b.x,b.y),rotation)
}
function absoluteBounds(e:ElementIR,m:Matrix):BoundsIR {
  const points=[[0,0],[e.bounds.width,0],[0,e.bounds.height],[e.bounds.width,e.bounds.height]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]])
  const x=Math.min(...points.map(p=>p[0])), y=Math.min(...points.map(p=>p[1]))
  return {x,y,width:Math.max(...points.map(p=>p[0]))-x,height:Math.max(...points.map(p=>p[1]))-y}
}
const intersects=(a:BoundsIR,b:BoundsIR)=>a.x+a.width>=b.x&&a.y+a.height>=b.y&&a.x<=b.x+b.width&&a.y<=b.y+b.height

export type SceneRecord = {
  element: ElementIR; source: SourceElement; ancestors: string[]; bounds: BoundsIR; matrix: Matrix
  disposition: 'visible'|'hidden'|'outside-slide'; tableId?: string
}
export type SourceScene = ReturnType<typeof readSourceScene>

/** The IR parser verifies table-grid references as well as geometry. A broken
 * subtree remains in the ledger as invalid; it is never partially blessed. */
export function readSourceScene(snapshot:SourceSnapshot) {
  const sources=new Map(snapshot.elements.map(e=>[e.id,e])), children=new Map<string,SourceElement[]>()
  if(sources.size!==snapshot.elements.length)throw new Error('Повторяющиеся ID исходных объектов')
  for(const e of snapshot.elements){
    if(e.parentId&&(!sources.has(e.parentId)||sources.get(e.parentId)!.slide!==e.slide))throw new Error('Некорректная связь исходных объектов')
    const seen=new Set([e.id]);let parent=e.parentId
    while(parent){if(seen.has(parent)||seen.size>64)throw new Error('Цикл или слишком глубокая вложенность');seen.add(parent);parent=sources.get(parent)?.parentId}
    const list=children.get(e.parentId??'')??[];list.push(e);children.set(e.parentId??'',list)
  }
  const records=new Map<string,SceneRecord>(),invalid=new Map<string,string>(),roots:ElementIR[]=[]
  const raw=(e:SourceElement):unknown=>({...e.properties,id:e.id,name:e.name,kind:e.kind,...(['group','table','chart'].includes(e.kind)?{children:(children.get(e.id)??[]).filter(c=>c.kind!=='source-picture').map(raw)}:{})})
  const markInvalid=(id:string,reason:string)=>{invalid.set(id,reason);for(const e of children.get(id)??[])if(e.kind!=='source-picture')markInvalid(e.id,reason)}
  for(const top of children.get('')??[]){
    if(top.kind==='source-picture')continue
    try{
      const root=parseSceneElements([raw(top)])[0], slide=snapshot.slides.find(s=>s.number===top.slide)
      if(!slide)throw new Error('Исходный слайд не найден')
      roots.push(root)
      const walk=(e:ElementIR,parent:Matrix,ancestors:string[],hidden:boolean,clips:BoundsIR[],tableId?:string)=>{
        const matrix=multiply(parent,transform(e)), bounds=absoluteBounds(e,matrix)
        const concealed=hidden||!e.visible||e.opacity===0
        const outside=!intersects(bounds,{x:0,y:0,width:slide.width,height:slide.height})||clips.some(clip=>!intersects(bounds,clip))
        const table='tableGrid' in e&&e.tableGrid?e.id:tableId
        records.set(e.id,{element:e,source:sources.get(e.id)!,ancestors,bounds,matrix,disposition:concealed?'hidden':outside?'outside-slide':'visible',...(table?{tableId:table}:{})})
        if('children' in e)for(const c of e.children)walk(c,matrix,[...ancestors,e.id],concealed,e.clipsContent?[...clips,bounds]:clips,table)
      }
      walk(root,identity,[],false,[])
    }catch(error){markInvalid(top.id,error instanceof Error?error.message:'Некорректная сцена')}
  }
  return {sources,children,records,invalid,roots,slides:snapshot.slides}
}

/** Adapted from canvas-structure: only non-painting, non-transforming wrappers
 * may leave a semantic payload. Their complete source tree stays unchanged. */
export function neutralContainer(e:ElementIR):e is GroupElementIR {
  return e.kind==='group'&&e.children.length>0&&e.opacity===1&&!e.rotation&&!e.centeredTransform?.flipH&&!e.centeredTransform?.flipV&&!e.clipsContent&&!e.layout&&!e.tableGrid&&!e.blur&&!e.effects?.length
}

export function nativeListMarker(record:SceneRecord,scene:SourceScene) {
  const e=record.element
  if(e.kind!=='text'||!/^List marker \d+$/.test(e.name)||!/^[•◦▪‣⁃]$/u.test(e.text)||record.disposition!=='visible')return false
  const number=e.name.match(/\d+$/)![0]
  return (scene.children.get(record.source.parentId??'')??[]).some(s=>{
    const p=scene.records.get(s.id)?.element
    return p?.kind==='text'&&p.name===`Paragraph ${number}`&&p.visible&&p.text.trim().length>1&&p.bounds.x>=e.bounds.x+e.bounds.width-1&&Math.abs(p.bounds.y-e.bounds.y)<Math.max(2,e.bounds.height*.3)
  })
}
