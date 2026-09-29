import {child} from "./appearance";
import {graphicPath} from "./graphic-path";
export function arrowheads(line:Element|undefined,w:number,h:number,weight:number,warn:()=>void){
  const length=Math.hypot(w,h);if(!length)return [];
  const results=[];
  for(const [name,end] of [["headEnd",false],["tailEnd",true]] as const){
    const node=child(line,name),type=node?.getAttribute("type")??"none";if(type==="none")continue;
    if(!["triangle","stealth","arrow","diamond","oval"].includes(type)){warn();continue;}
    const dimension=(key:string)=>{const value=node?.getAttribute(key)??"med";if(!["sm","med","lg"].includes(value))warn();return weight*(value==="sm"?2:value==="lg"?5:3);};
    const l=dimension("len"),half=dimension("w")/2,dx=w/length*(end?-1:1),dy=h/length*(end?-1:1),x=end?w:0,y=end?h:0;
    const pt=(u:number,v:number)=>`${x+dx*u-dy*v} ${y+dy*u+dx*v}`;
    let data=type==="diamond"?`M ${pt(0,0)} L ${pt(l/2,half)} L ${pt(l,0)} L ${pt(l/2,-half)} Z`:type==="stealth"?`M ${pt(0,0)} L ${pt(l,half)} L ${pt(l*.7,0)} L ${pt(l,-half)} Z`:`M ${pt(l,half)} L ${pt(0,0)} L ${pt(l,-half)}${type==="arrow"?"":" Z"}`;
    if(type==="oval"){const k=.55228475;data=`M ${pt(0,0)} C ${pt(0,half*k)} ${pt(l/2*(1-k),half)} ${pt(l/2,half)} C ${pt(l/2*(1+k),half)} ${pt(l,half*k)} ${pt(l,0)} C ${pt(l,-half*k)} ${pt(l/2*(1+k),-half)} ${pt(l/2,-half)} C ${pt(l/2*(1-k),-half)} ${pt(0,-half*k)} ${pt(0,0)} Z`;}
    results.push({...graphicPath(data),open:type==="arrow",end});warn(); // Source renderer endpoint sizing is approximate.
  }
  return results;
}

/** Endpoint tangents of an observed orthogonal connector, including its bends. */
export function pathArrowheads(line:Element|undefined,data:string,weight:number,warn:()=>void){
 if(!/^M\s*[\d.e+\-]+[ ,]+[\d.e+\-]+(?:\s*L\s*[\d.e+\-]+[ ,]+[\d.e+\-]+)+\s*$/.test(data))return [];
 const values=data.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)!.map(Number),points=Array.from({length:values.length/2},(_,i)=>({x:values[i*2],y:values[i*2+1]})).filter((p,i,a)=>!i||p.x!==a[i-1].x||p.y!==a[i-1].y);
 if(points.length<2)return [];
 return [false,true].flatMap(end=>{const a=end?points.at(-2)!:points[0],b=end?points.at(-1)!:points[1];return arrowheads(line,b.x-a.x,b.y-a.y,weight,warn).filter(h=>h.end===end).map(h=>({...h,bounds:{...h.bounds,x:h.bounds.x+a.x,y:h.bounds.y+a.y}}));});
}
