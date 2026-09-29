import type {SmartArtStyleContext} from "./smart-art-style";
import {renderSmartArtProgram} from "./smart-art-engine";
import {graphicPath} from "./graphic-path";
import {PptxCatalogReader,OFFICE_REL,DRAWING as A} from "./catalog";
import {DIAGRAM as D} from "./smart-art";
import {child,number} from "./appearance";
import type {BaseElementIR,ElementIR} from "../../core/model";
/** Bounded reconstruction of declared algorithm families; never evaluate source rules. */
export function layoutSmartArt(reader:PptxCatalogReader,data:Element|undefined,part:string,w:number,h:number,base:(name:string,w:number,h:number)=>BaseElementIR,styleContext?:SmartArtStyleContext):ElementIR[]|undefined {
 const ids=child(data,"relIds",D),rels=reader.relationships(part);
 const dm=rels.get(ids?.getAttributeNS(OFFICE_REL,"dm")??""),ld=rels.get(ids?.getAttributeNS(OFFICE_REL,"lo")??"");
 if(!dm||dm.external||dm.type!==`${OFFICE_REL}/diagramData`||!ld||ld.external||ld.type!==`${OFFICE_REL}/diagramLayout`)return undefined;
 const layout=reader.xml(ld.target,D,"layoutDef");
 // Structured definitions execute in scope; never flatten their active/inactive algorithms.
 if(["forEach","choose","presOf","constr","rule"].some(tag=>layout.getElementsByTagNameNS(D,tag).length)||layout.getElementsByTagNameNS(D,"layoutNode").length>1)return renderSmartArtProgram(layout,reader.xml(dm.target,D,"dataModel"),w,h,base,styleContext?{...styleContext,...(() => {
  const result:{quickStyle?:Element;colors?:Element}={};
  for(const [key,kind,root,property]of [["qs","diagramQuickStyle","styleDef","quickStyle"],["cs","diagramColors","colorsDef","colors"]] as const){
   const id=ids?.getAttributeNS(OFFICE_REL,key);if(!id)continue;const rel=rels.get(id);if(!rel||rel.external||rel.type!==`${OFFICE_REL}/${kind}`)throw new Error("invalid-file");result[property]=reader.xml(rel.target,D,root);
  }return result;
 })()}:undefined);
 const algorithms=Array.from(layout.getElementsByTagNameNS(D,"alg")).map(e=>e.getAttribute("type"));
 if(!algorithms.length||algorithms.some(a=>!["lin","snake","pyra","cycle","hierRoot","hierChild","composite","sp","tx","conn"].includes(a??"")))return undefined;
 const mode=algorithms.includes("pyra")?"pyramid":algorithms.includes("hierRoot")?"tree":algorithms.includes("cycle")?"cycle":algorithms.includes("snake")?"snake":algorithms.includes("lin")?"linear":undefined;if(!mode)return undefined;
 const model=reader.xml(dm.target,D,"dataModel"),points=Array.from(child(model,"ptLst",D)?.children??[]).filter(e=>e.namespaceURI===D&&e.localName==="pt");
 if(points.length>256)throw new Error("security-limit");
 const all=new Set<string>(),nodes:{id:string;text:string}[]=[];
 for(const point of points){const id=point.getAttribute("modelId");if(!id||all.has(id))throw new Error("invalid-file");all.add(id);if(!point.hasAttribute("type")||point.getAttribute("type")==="node")nodes.push({id,text:Array.from(point.getElementsByTagNameNS(A,"p")).map(p=>Array.from(p.getElementsByTagNameNS(A,"t")).map(t=>t.textContent??"").join("")).join("\n")});}
 if(!nodes.length)return undefined;if(nodes.map(n=>n.text).join("").length>100000)throw new Error("security-limit");
 const nodeIds=new Set(nodes.map(n=>n.id)),parents=new Map<string,string>(),edges:{from:string;to:string;order:number}[]=[];
 for(const cxn of Array.from(child(model,"cxnLst",D)?.children??[])){
   if(cxn.namespaceURI!==D||cxn.getAttribute("type")!=="parOf")continue;
   const from=cxn.getAttribute("srcId")??"",to=cxn.getAttribute("destId")??"";
   if(!all.has(from)||!all.has(to)||from===to||parents.has(to))throw new Error("invalid-file");parents.set(to,from);
   if(nodeIds.has(from)&&nodeIds.has(to)){const order=number(cxn,"srcOrd",0);if(!Number.isInteger(order)||order<0||order>1000000)throw new Error("invalid-file");edges.push({from,to,order});}
 }
 const level=(id:string):number=>{const seen=new Set<string>();let at:string|undefined=id,depth=0;while(at&&parents.has(at)){if(seen.has(at))throw new Error("invalid-file");seen.add(at);at=parents.get(at);if(at&&nodeIds.has(at))depth++;if(depth>32)throw new Error("security-limit");}return depth;};
 // Validate every parent chain, including non-visible document nodes.
 for(const id of all)level(id);
 const vertical=Array.from(layout.getElementsByTagNameNS(D,"param")).some(p=>p.getAttribute("type")==="linDir"&&["fromT","fromB"].includes(p.getAttribute("val")??""));
 const reverse=Array.from(layout.getElementsByTagNameNS(D,"param")).some(p=>p.getAttribute("type")==="linDir"&&["fromR","fromB"].includes(p.getAttribute("val")??""));
 const boxes=new Map<string,{x:number;y:number;width:number;height:number}>(),pad=Math.min(12,w/20,h/20),gap=Math.min(16,w/20,h/20);
 const children=new Map<string,string[]>();for(const e of [...edges].sort((a,b)=>a.order-b.order)){const list=children.get(e.from)??[];list.push(e.to);children.set(e.from,list);}
 const slots=new Map<string,{left:number;count:number}>();let cursor=0;
 const assign=(id:string):void=>{const left=cursor,list=children.get(id)??[];if(list.length)list.forEach(assign);else cursor++;slots.set(id,{left,count:cursor-left});};
 for(const node of nodes)if(!edges.some(e=>e.to===node.id))assign(node.id);
 const levels=nodes.map(n=>level(n.id)),rows=Math.max(...levels)+1;
 nodes.forEach((node,index)=>{
  let x:number,y:number,bw:number,bh:number;
  if(mode==="pyramid"){bh=(h-2*pad)/nodes.length;bw=(w-2*pad)*.55*(index+1)/nodes.length;x=pad+(w-2*pad)*.55/2-bw/2;y=pad+index*bh;}
  else if(mode==="tree"){const row=levels[index]!,slot=slots.get(node.id)!;bw=Math.min((w-2*pad)/Math.max(1,cursor)*.8,(w-2*pad)*.6);bh=(h-2*pad)/rows*.65;x=pad+(w-2*pad)*(slot.left+slot.count/2)/Math.max(1,cursor)-bw/2;y=pad+(h-2*pad)/rows*row;}
  else if(mode==="snake"){const cols=Math.max(1,Math.ceil(Math.sqrt(nodes.length*w/h))),rows=Math.ceil(nodes.length/cols),row=Math.floor(index/cols),column=row%2?cols-1-index%cols:index%cols;bw=(w-2*pad-gap*(cols-1))/cols;bh=(h-2*pad-gap*(rows-1))/rows;x=pad+column*(bw+gap);y=pad+row*(bh+gap);}
  else if(mode==="cycle"){bw=(w-2*pad)/(nodes.length>4?4:3);bh=(h-2*pad)/4;const angle=-Math.PI/2+index*2*Math.PI/nodes.length;x=w/2+Math.cos(angle)*(w/2-bw/2-pad)-bw/2;y=h/2+Math.sin(angle)*(h/2-bh/2-pad)-bh/2;}
  else {const i=reverse?nodes.length-index-1:index;bw=vertical?w-2*pad:(w-2*pad-gap*(nodes.length-1))/nodes.length;bh=vertical?(h-2*pad-gap*(nodes.length-1))/nodes.length:h-2*pad;x=pad+(vertical?0:i*(bw+gap));y=pad+(vertical?i*(bh+gap):0);}
  if(bw<8||bh<8)return;boxes.set(node.id,{x,y,width:bw,height:bh});
 });
 if(boxes.size!==nodes.length||mode==="cycle"&&nodes.length>12)return undefined;
 const result:ElementIR[]=[],paint={type:"solid" as const,color:{r:.15,g:.36,b:.7,a:1}};
 if(mode==="tree")for(const edge of edges){const a=boxes.get(edge.from)!,b=boxes.get(edge.to)!;result.push({...base("SmartArt connection",w,h),kind:"path",...graphicPath(`M ${a.x+a.width/2} ${a.y+a.height} L ${a.x+a.width/2} ${(a.y+a.height+b.y)/2} L ${b.x+b.width/2} ${(a.y+a.height+b.y)/2} L ${b.x+b.width/2} ${b.y}`),windingRule:"NONZERO",stroke:{width:1.5,paint}});}
 for(const node of nodes){const bounds=boxes.get(node.id)!;if(mode==="pyramid"){const inset=(w-2*pad)*.55/nodes.length/2;result.push({...base("SmartArt node",bounds.width,bounds.height),bounds,kind:"path",pathData:`M ${inset} 0 L ${bounds.width-inset} 0 L ${bounds.width} ${bounds.height} L 0 ${bounds.height} Z`,windingRule:"NONZERO",fill:paint});}else result.push({...base("SmartArt node",bounds.width,bounds.height),bounds,kind:"rectangle",fill:paint});const labelBounds=mode==="pyramid"?{...bounds,x:pad+(w-2*pad)*.62,width:(w-2*pad)*.38}:bounds;
 if(mode==="pyramid")result.push({...base("SmartArt label leader",w,h),kind:"path",...graphicPath(`M ${bounds.x+bounds.width-(w-2*pad)*.55/nodes.length/4} ${bounds.y+bounds.height/2} L ${labelBounds.x-3} ${bounds.y+bounds.height/2}`),windingRule:"NONZERO",stroke:{width:1,paint}});
 result.push({...base("SmartArt label",labelBounds.width,labelBounds.height),bounds:labelBounds,kind:"text",text:node.text,fontFamily:"Arial",fontSize:Math.max(6,Math.min(20,bounds.height/4)),textBox:{align:"CENTER",vertical:"CENTER",wrap:true},colorRuns:node.text?[{start:0,end:node.text.length,fill:{type:"solid",color:mode==="pyramid"?{r:.1,g:.15,b:.2,a:1}:{r:1,g:1,b:1,a:1}}}]:[]});}
 return result;
}
