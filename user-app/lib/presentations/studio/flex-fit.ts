import type {FlexNode} from './component-flex'
import type {Box,Candidate} from './contract'

export type SpaceNeeds=Record<string,{width?:number;height?:number}>
type Tree={node:FlexNode;box:Box;children:Tree[]}

/** Preserve Qwen's tree, order and components. Only redistribute free space,
 * with a hard +/-30% limit on each original leaf, then measure again. */
export function fitMeasuredFlex(nodes:FlexNode[],candidate:Candidate,needs:SpaceNeeds,free=false):Candidate|undefined{
  const root=nodes.find(n=>!n.parent);if(!root)return
  const build=(node:FlexNode):Tree=>{
    const children=nodes.filter(n=>n.parent===node.id).map(build)
    if(!children.length)return {node,children,box:candidate.slots.find(s=>s.region===node.id)!.rect}
    const x=Math.min(...children.map(c=>c.box.x)),y=Math.min(...children.map(c=>c.box.y))
    return {node,children,box:{x,y,w:Math.max(...children.map(c=>c.box.x+c.box.w))-x,h:Math.max(...children.map(c=>c.box.y+c.box.h))-y}}
  }
  const tree=build(root),boxes=new Map<string,Box>()
  function axis(size:'w'|'h',position:'x'|'y',dimension:'width'|'height'){
    const ranges=new Map<string,{min:number;max:number}>()
    function range(t:Tree):{min:number;max:number}{
      const split=t.node.direction===(size==='w'?'row':'column'),children=t.children.map(range),gap=t.node.gap*(children.length-1)
      const r=children.length?(split?{min:children.reduce((n,c)=>n+c.min,0)+gap,max:children.reduce((n,c)=>n+c.max,0)+gap}:{min:Math.max(...children.map(c=>c.min)),max:Math.min(...children.map(c=>c.max))}):{min:Math.max(free?(size==='w'?120:60):t.box[size]*.7,needs[t.node.block]?.[dimension]??0),max:free?tree.box[size]:t.box[size]*1.3}
      ranges.set(t.node.id,r);return r
    }
    range(tree)
    function place(t:Tree,start:number,available:number):boolean{
      const r=ranges.get(t.node.id)!
      if(r.min>r.max+.01||available<r.min-.01||available>r.max+.01)return false
      boxes.set(t.node.id,{...boxes.get(t.node.id)??t.box,[position]:start,[size]:available})
      if(!t.children.length)return true
      if(t.node.direction!==(size==='w'?'row':'column'))return t.children.every(c=>place(c,start,available))
      const space=available-t.node.gap*(t.children.length-1)
      const clamp=(c:Tree,ratio:number)=>{const r=ranges.get(c.node.id)!;return Math.max(r.min,Math.min(r.max,c.box[size]*ratio))}
      let low=0,high=100
      for(let i=0;i<50;i++){const ratio=(low+high)/2;if(t.children.reduce((n,c)=>n+clamp(c,ratio),0)<space)low=ratio;else high=ratio}
      let cursor=start
      return t.children.every(c=>{const length=clamp(c,(low+high)/2),ok=place(c,cursor,length);cursor+=length+t.node.gap;return ok})
    }
    return place(tree,tree.box[position],tree.box[size])
  }
  if(!axis('w','x','width')||!axis('h','y','height'))return
  return {...candidate,slots:candidate.slots.map(slot=>({...slot,rect:boxes.get(slot.region)!}))}
}
