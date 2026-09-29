import {placeDiagramHierarchy,diagramConnector,diagramTextBox,diagramGeometry,diagramHierarchyConnections} from "./smart-art-algorithms";
import {smartArtStyle,type SmartArtStyleContext} from "./smart-art-style";
import {compileSmartArt,UnsupportedSmartArt,type LayoutInstance} from './smart-art-program';
import {presetPath} from './preset-geometry';
import {graphicPath} from './graphic-path';
import type {BaseElementIR,BoundsIR,ElementIR} from '../../core/model';
import {solveDiagramConstraints,diagramNumber as numeric,type PlacedDiagram as Placed} from './smart-art-constraints';
const fail=(s:string):never=>{throw new UnsupportedSmartArt(s);};
function arrange(layout:LayoutInstance,w:number,h:number):Placed {
 const root:Placed={layout,box:{x:0,y:0,width:w,height:h,font:Math.min(20,h/4),rotation:0},children:[],locked:new Set()};
 const build=(node:Placed,depth:number):void=>{
  if(depth>32)throw new Error('security-limit');
  const {layout,box}=node,n=layout.children.length,alg=layout.algorithm;
  if(!['composite','lin','snake','cycle','pyra','hierRoot','hierChild','sp','tx','conn'].includes(alg))fail(`algorithm:${alg}`);
  const params=layout.params,allowed:Record<string,string[]>={composite:[],lin:['linDir'],snake:['flowDir','grDir'],cycle:['stAng','spanAng','rotPath'],pyra:[],hierRoot:['linDir'],hierChild:['linDir'],sp:[],tx:['parTxLTRAlign','txAnchorVert'],conn:['connRout','bendPt','srcNode','dstNode','begSty','endSty']};
  for(const key of params.keys())if(!allowed[alg]!.includes(key))fail(`parameter:${key}`);
  const gap=Math.min(12,box.width/20,box.height/20),direction=params.get('linDir')??'fromL',vertical=['fromT','fromB'].includes(direction),reverse=['fromR','fromB'].includes(direction);
  if(!['fromL','fromR','fromT','fromB'].includes(direction))fail('linear direction');
  node.children=layout.children.map((child,i)=>{
   let x=0,y=0,width=box.width,height=box.height,rotation=0;
   if(['lin','hierRoot','hierChild'].includes(alg)){
    const k=reverse?n-1-i:i;width=vertical?box.width:(box.width-gap*(n-1))/n;height=vertical?(box.height-gap*(n-1))/n:box.height;x=vertical?0:k*(width+gap);y=vertical?k*(height+gap):0;
   }else if(alg==='snake'){
    const flow=params.get('flowDir')??'row',grow=params.get('grDir')??'tL';if(!['row','col'].includes(flow)||!['tL','tR','bL','bR'].includes(grow))fail('snake direction');
    const cols=Math.max(1,Math.ceil(Math.sqrt(n*box.width/box.height))),rows=Math.ceil(n/cols);let row:number,col:number;
    if(flow==='row'){row=Math.floor(i/cols);col=row%2?cols-1-i%cols:i%cols;}else{col=Math.floor(i/rows);row=col%2?rows-1-i%rows:i%rows;}
    if(grow.endsWith('R'))col=cols-1-col;if(grow.startsWith('b'))row=rows-1-row;
    width=(box.width-gap*(cols-1))/cols;height=(box.height-gap*(rows-1))/rows;x=col*(width+gap);y=row*(height+gap);

   }else if(alg==='cycle'){
    const start=numeric(params.get('stAng')??null,0),span=numeric(params.get('spanAng')??null,360),angle=(start+span*i/n)*Math.PI/180;
    width=box.width/Math.max(3,Math.ceil(n/2));height=box.height/Math.max(3,Math.ceil(n/2));x=box.width/2+Math.cos(angle)*(box.width-width)/2-width/2;y=box.height/2+Math.sin(angle)*(box.height-height)/2-height/2;
    const rotate=params.get('rotPath')??'none';if(!['none','alongPath'].includes(rotate))fail('cycle rotation');if(rotate==='alongPath')rotation=(angle*180/Math.PI+90)%360;
   }else if(alg==='pyra'){height=box.height/n;width=box.width*(i+1)/n;x=(box.width-width)/2;y=i*height;}
   return {layout:child,box:{x,y,width,height,font:Math.min(box.font,height/4),rotation},children:[],parent:node,locked:new Set<string>()};
  });
  if(alg==='hierRoot'||alg==='hierChild')placeDiagramHierarchy(node);
  // The complete instance tree is allocated before constraint solving.

  for(const c of node.children){const {width,height,font,x,y}=c.box;if(![width,height,font,x,y].every(Number.isFinite)||width<=0||height<=0||width>1e6||height>1e6)fail('unsatisfiable dimensions');build(c,depth+1);}
 };
 build(root,0);
 const all=(node:Placed):Placed[]=>[node,...node.children.flatMap(all)];
 const nodes=all(root),movementOrigin=new Map(nodes.map(n=>[n,{...n.box}]));let original=movementOrigin;
 const reflow=(node:Placed):void=>{
  const before=original.get(node)!,sx=node.box.width/before.width,sy=node.box.height/before.height;
  for(const c of node.children){if(!c.locked.has('w'))c.box.width*=sx;if(!c.locked.has('h'))c.box.height*=sy;if(!c.locked.has('l'))c.box.x*=sx;if(!c.locked.has('t'))c.box.y*=sy;}
  if(node.layout.algorithm==='lin'){
   const dir=node.layout.params.get('linDir')??'fromL',vertical=dir==='fromT'||dir==='fromB',reverse=dir==='fromR'||dir==='fromB',gap=Math.min(12,node.box.width/20,node.box.height/20);
   let cursor=reverse?(vertical?node.box.height:node.box.width):0;
   for(const c of node.children){const extent=vertical?c.box.height:c.box.width,key=vertical?'t':'l';if(reverse)cursor-=extent;
    if(!c.locked.has(key)){if(vertical)c.box.y=cursor;else c.box.x=cursor;}else cursor=vertical?c.box.y:c.box.x;
    cursor+=reverse?-gap:extent+gap;
   }
  }
  node.children.forEach(reflow);
 };
 let stable=false;
 for(let pass=0;pass<8;pass++){
  original=new Map(nodes.map(n=>[n,{...n.box}]));solveDiagramConstraints(root);reflow(root);
  stable=nodes.every(n=>{const b=original.get(n)!;return ['x','y','width','height','font'].every(k=>Math.abs(n.box[k as keyof typeof b]-b[k as keyof typeof b])<1e-5);});if(stable)break;
 }
 if(!stable)fail('layout constraints did not converge');
 const moved=new Set<Placed>(),moving=new Set<Placed>();
 const move=(node:Placed):void=>{if(moved.has(node)||!node.layout.moveWith)return;if(moving.has(node))fail('cyclic moveWith');moving.add(node);
  const matches=node.parent?.children.filter(c=>c.layout.name===node.layout.moveWith)??[],same=matches.filter(c=>c.layout.data===node.layout.data),target=same.length===1?same[0]:matches.length===1?matches[0]:undefined;if(!target)fail('moveWith target');move(target!);
  const before=movementOrigin.get(target!)!;node.box.x+=target!.box.x-before.x;node.box.y+=target!.box.y-before.y;moving.delete(node);moved.add(node);
 };
 nodes.forEach(move);return root;
}
export function renderSmartArtProgram(layout:Element,model:Element,w:number,h:number,base:(name:string,w:number,h:number)=>BaseElementIR,styleContext?:SmartArtStyleContext):ElementIR[]|undefined {
 try{
  const root=arrange(compileSmartArt(layout,model),w,h),paint={type:'solid' as const,color:{r:.15,g:.36,b:.7,a:1}};
  const counts=new Map<string,number>();
  const render=(node:Placed):ElementIR[]=>{
   const {box,layout}=node,out:ElementIR[]=[];const index=counts.get(layout.styleLabel)??0;if(layout.shape!=='none'||layout.points.length)counts.set(layout.styleLabel,index+1);const styled=styleContext?smartArtStyle(layout,index,box.width,box.height,box.font,styleContext):undefined;
   if(layout.shape!=='none'){
    const common={...base('SmartArt node',box.width,box.height),...(styled?styled.shape:{fill:paint})};
    if(layout.shape==='rect')out.push({...common,kind:'rectangle'});
    else if(layout.shape==='ellipse')out.push({...common,kind:'ellipse'});
    else {const path=presetPath(layout.shape,box.width,box.height,diagramGeometry(node),()=>{});if(!path)fail(`shape:${layout.shape}`);out.push({...common,kind:'path',pathData:path!,windingRule:'NONZERO'});}
   }
   const text=layout.points.map(p=>p.text).filter(Boolean).join('\n');
   if(styled?.text)out.push({...base('SmartArt label',box.width,box.height),...styled.text,...(layout.algorithm==='tx'?{textBox:diagramTextBox(node)}:{})});
   else if(text)out.push({...base('SmartArt label',box.width,box.height),kind:'text',text,fontFamily:'Arial',fontSize:Math.max(1,Math.min(400,box.font)),textBox:diagramTextBox(node),colorRuns:[{start:0,end:text.length,fill:layout.shape==='none'?{type:'solid',color:{r:0,g:0,b:0,a:1}}: {type:'solid',color:{r:1,g:1,b:1,a:1}}}]});
   if(layout.algorithm==='conn')out.push(...diagramConnector(node,base,paint));
   if(layout.algorithm==='hierRoot'||layout.algorithm==='hierChild')out.push(...diagramHierarchyConnections(node,base,paint));
   for(const c of node.children)out.push({...base(c.layout.name,c.box.width,c.box.height),kind:'group',rotation:c.box.rotation,centeredTransform:{flipH:false,flipV:false},bounds:{x:c.box.x,y:c.box.y,width:c.box.width,height:c.box.height},children:render(c)});
   return out;
  };
  const result=render(root);return result.length?result:undefined;
 }catch(error){if(error instanceof UnsupportedSmartArt)return undefined;throw error;}
}
