import {UnsupportedSmartArt} from './smart-art-program';
import type {PlacedDiagram} from './smart-art-constraints';
import type {BaseElementIR,ElementIR,SolidPaintIR,TextElementIR} from '../../core/model';
import {graphicPath} from './graphic-path';
const fail=(s:string):never=>{throw new UnsupportedSmartArt(s);};
/** Reserve leaf spans before positioning ancestors; sibling order comes from diagramData. */
export function placeDiagramHierarchy(node:PlacedDiagram):void {
 const children=node.children,byPoint=new Map(children.map(c=>[c.layout.data,c]));
 if(byPoint.size!==children.length)fail('hierarchy repeated presentation points');
 const descendants=(c:PlacedDiagram):PlacedDiagram[]=>c.layout.data.children.map(p=>byPoint.get(p)).filter((p):p is PlacedDiagram=>Boolean(p));
 const roots=children.filter(c=>!c.layout.data.parent||!byPoint.has(c.layout.data.parent)),spans=new Map<PlacedDiagram,{left:number;count:number;depth:number}>();let cursor=0,maxDepth=0;
 const assign=(c:PlacedDiagram,depth:number):void=>{maxDepth=Math.max(maxDepth,depth);const left=cursor,list=descendants(c);if(list.length)list.forEach(n=>assign(n,depth+1));else cursor++;spans.set(c,{left,count:cursor-left,depth});};roots.forEach(c=>assign(c,0));
 const dir=node.layout.params.get('linDir')??'fromT',horizontal=dir==='fromL'||dir==='fromR',reverse=dir==='fromB'||dir==='fromR',along=horizontal?node.box.height:node.box.width,across=horizontal?node.box.width:node.box.height;
 for(const c of children){const span=spans.get(c)!;let width=Math.min(along/Math.max(1,cursor)*.8,along*.6),height=across/(maxDepth+1)*.65,x=along*(span.left+span.count/2)/Math.max(1,cursor)-width/2,y=across/(maxDepth+1)*span.depth;if(reverse)y=across-y-height;if(horizontal){[x,y]=[y,x];[width,height]=[height,width];}Object.assign(c.box,{x,y,width,height,font:Math.min(c.box.font,height/4)});}
}
export function diagramTextBox(node:PlacedDiagram):NonNullable<TextElementIR['textBox']> {
 const params=node.layout.params,align=params.get('parTxLTRAlign')??'ctr',vertical=params.get('txAnchorVert')??'mid';
 const map:Record<string,'LEFT'|'CENTER'|'RIGHT'>={l:'LEFT',ctr:'CENTER',r:'RIGHT'},v:Record<string,'TOP'|'CENTER'|'BOTTOM'>={t:'TOP',mid:'CENTER',b:'BOTTOM'};
 if(!map[align]||!v[vertical])fail('text alignment');return{align:map[align]!,vertical:v[vertical]!,wrap:true};
}
export function diagramConnector(node:PlacedDiagram,base:(name:string,w:number,h:number)=>BaseElementIR,paint:SolidPaintIR):ElementIR[] {
 const params=node.layout.params,route=params.get('connRout')??'stra',bend=params.get('bendPt')??'end';
 if(!['stra','bend','curve'].includes(route)||!['beg','def','end'].includes(bend))fail('connector route');
 let x1=0,y1=node.box.height/2,x2=node.box.width,y2=node.box.height/2;
 const named=(name:string):PlacedDiagram=>{const matches=node.parent?.children.filter(c=>c.layout.name===name)??[],same=matches.filter(c=>c.layout.data===node.layout.data);if(same.length===1)return same[0]!;if(matches.length===1)return matches[0]!;return fail('connector endpoint');};
 const src=params.get('srcNode'),dst=params.get('dstNode');
 if(src&&dst){const a=named(src).box,b=named(dst).box,vertical=Math.abs(b.y-a.y)>Math.abs(b.x-a.x);x1=a.x+a.width/2;y1=a.y+a.height/2;x2=b.x+b.width/2;y2=b.y+b.height/2;if(vertical){y1+=y2>=y1?a.height/2:-a.height/2;y2+=y2>=y1?-b.height/2:b.height/2;}else{x1+=x2>=x1?a.width/2:-a.width/2;x2+=x2>=x1?-b.width/2:b.width/2;}x1-=node.box.x;x2-=node.box.x;y1-=node.box.y;y2-=node.box.y;}
 else if(src||dst)fail('incomplete connector endpoints');
 const mid=bend==='beg'?x1:bend==='end'?x2:(x1+x2)/2;
 const path=route==='stra'?`M ${x1} ${y1} L ${x2} ${y2}`:route==='curve'?`M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`:`M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`;
 const out:ElementIR[]=[{...base('SmartArt connection',node.box.width,node.box.height),kind:'path',...graphicPath(path),windingRule:'NONZERO',stroke:{width:1.5,paint}}];
 for(const [key,x,y,otherX,otherY]of [['begSty',x1,y1,x2,y2],['endSty',x2,y2,x1,y1]] as const){const style=params.get(key)??'noArr';if(style==='noArr')continue;if(style!=='arr')fail('connector arrow');const angle=Math.atan2(y-otherY,x-otherX),s=6,bx=x-Math.cos(angle)*s,by=y-Math.sin(angle)*s;out.push({...base('SmartArt arrow',node.box.width,node.box.height),kind:'path',...graphicPath(`M ${x} ${y} L ${bx+Math.sin(angle)*s/2} ${by-Math.cos(angle)*s/2} L ${bx-Math.sin(angle)*s/2} ${by+Math.cos(angle)*s/2} Z`),windingRule:'NONZERO',fill:paint});}
 return out;
}
/** Diagram adjustments use fractional values; DrawingML preset guides use 100000 units. */
export function diagramGeometry(node:PlacedDiagram):Element|undefined {
 const shape=node.layout.shapeElement;if(!shape)return undefined;
 const D='http://schemas.openxmlformats.org/drawingml/2006/diagram',A='http://schemas.openxmlformats.org/drawingml/2006/main',list=Array.from(shape.children).find(e=>e.namespaceURI===D&&e.localName==='adjLst'),adjustments=Array.from(list?.children??[]);
 if(!adjustments.length)return undefined;if(adjustments.length>16)throw new Error('security-limit');
 const names=['rightArrow','leftArrow','upArrow','downArrow','leftRightArrow'].includes(node.layout.shape)?['adj1','adj2']:['roundRect','parallelogram','trapezoid','hexagon','octagon','chevron','plus'].includes(node.layout.shape)?['adj']:[];
 const geometry=shape.ownerDocument.createElementNS(A,'a:prstGeom'),av=shape.ownerDocument.createElementNS(A,'a:avLst'),seen=new Set<number>();geometry.appendChild(av);
 for(const e of adjustments){const index=Number(e.getAttribute('idx')),value=Number(e.getAttribute('val'));if(e.namespaceURI!==D||e.localName!=='adj'||!Number.isInteger(index)||index<1||!Number.isFinite(value)||Math.abs(value)>10||seen.has(index))throw new Error('invalid-file');seen.add(index);const name=names[index-1];if(!name)fail('shape adjustment index');const gd=shape.ownerDocument.createElementNS(A,'a:gd');gd.setAttribute('name',name!);gd.setAttribute('fmla',`val ${value*100000}`);av.appendChild(gd);}
 return geometry;
}
export function diagramHierarchyConnections(node:PlacedDiagram,base:(name:string,w:number,h:number)=>BaseElementIR,paint:SolidPaintIR):ElementIR[]{
 if(node.children.some(c=>c.layout.algorithm==='conn'))return[];
 const map=new Map(node.children.map(c=>[c.layout.data,c])),dir=node.layout.params.get('linDir')??'fromT',vertical=dir==='fromT'||dir==='fromB',reverse=dir==='fromB'||dir==='fromR',out:ElementIR[]=[];
 for(const child of node.children){const parent=child.layout.data.parent?map.get(child.layout.data.parent):undefined;if(!parent)continue;const a=parent.box,b=child.box;
  const x1=vertical?a.x+a.width/2:a.x+(reverse?0:a.width),y1=vertical?a.y+(reverse?0:a.height):a.y+a.height/2,x2=vertical?b.x+b.width/2:b.x+(reverse?b.width:0),y2=vertical?b.y+(reverse?b.height:0):b.y+b.height/2;
  const path=vertical?`M ${x1} ${y1} L ${x1} ${(y1+y2)/2} L ${x2} ${(y1+y2)/2} L ${x2} ${y2}`:`M ${x1} ${y1} L ${(x1+x2)/2} ${y1} L ${(x1+x2)/2} ${y2} L ${x2} ${y2}`;
  out.push({...base('SmartArt connection',node.box.width,node.box.height),kind:'path',...graphicPath(path),windingRule:'NONZERO',stroke:{width:1.5,paint}});
 }return out;
}
