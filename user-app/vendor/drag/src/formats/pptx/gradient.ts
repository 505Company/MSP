import type { LinearGradientIR, SolidPaintIR } from "../../core/model";
import { child, kids, number, color, enabled, type SlideAppearance } from "./appearance";

// DrawingML ST_Percentage accepts thousandths of a percent or a percent string.
function ratio(element:Element|undefined,key:string,fallback:number):number {
  const raw=element?.getAttribute(key);if(raw===null||raw===undefined)return fallback;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(raw))throw new Error("invalid-file");
  const value=raw.endsWith("%")?Number(raw.slice(0,-1))/100:Number(raw)/100000;
  if(!Number.isFinite(value)||Math.abs(value)>10)throw new Error("security-limit");return value;
}
export function readGradient(paint: Element | undefined, context: SlideAppearance, width: number, height: number, warn: () => void, phColor?: SolidPaintIR): LinearGradientIR | undefined {
  if (!paint || paint.localName !== "gradFill") return undefined;
  const linear = child(paint,"lin");
  const radial=child(paint,"path");
  if((!linear&&!radial)||paint.getAttribute("flip")&&paint.getAttribute("flip")!=="none"||!enabled(paint,"rotWithShape",true)){warn();return undefined;}
  const tile=child(paint,"tileRect");
  const tl=ratio(tile,"l",0),tt=ratio(tile,"t",0),tr=1-ratio(tile,"r",0),tb=1-ratio(tile,"b",0);
  if(tr<=tl||tb<=tt)throw new Error("invalid-file");
  // A tile covering the shape needs no repetition and maps to a native gradient.
  if(tl>0||tt>0||tr<1||tb<1){warn();return undefined;}
  const map=(x:number,y:number)=>({x:tl+x*(tr-tl),y:tt+y*(tb-tt)});
  const values=kids(child(paint,"gsLst"));
  if(values.length>64)throw new Error("security-limit");
  if(values.length<2)throw new Error("invalid-file");
  let previous=-1;
  let unresolved=false;
  const stops=values.map(stop=>{
    const position=ratio(stop,"pos",-1);
    if(position<previous||position<0||position>1)throw new Error("invalid-file");previous=position;
    const resolved=color(kids(stop)[0],context,warn,phColor);
    if(!resolved)unresolved=true;
    return {position,color:resolved?.color??{r:0,g:0,b:0,a:0}};
  });
  if(unresolved)return undefined;
  if(width<=0||height<=0)return undefined;
  if(radial){
    if(radial.getAttribute("path")!=="circle"){warn();return undefined;}
    const rect=child(radial,"fillToRect"),l=ratio(rect,"l",.5),t=ratio(rect,"t",.5),r=1-ratio(rect,"r",.5),b=1-ratio(rect,"b",.5);
    if([l,t,r,b].some(n=>n<0||n>1))throw new Error("security-limit");
    const cx=(l+r)/2,cy=(t+b)/2,rx=Math.max(cx,1-cx),ry=Math.max(cy,1-cy);warn();
    return {type:"radial",start:map(cx-rx,cy-ry),end:map(cx+rx,cy+ry),stops:[...stops].reverse().map(s=>({...s,position:1-s.position}))};
  }
  width*=tr-tl;height*=tb-tt;
  const angle=number(linear,"ang",0)/60000*Math.PI/180;
  let dx=Math.cos(angle),dy=Math.sin(angle);
  if(enabled(linear,"scaled",true)){dx*=width;dy*=height;}
  const length=Math.hypot(dx,dy);dx/=length;dy/=length;
  const span=width*Math.abs(dx)+height*Math.abs(dy);
  const vx=dx*span/width,vy=dy*span/height;
  return {type:"linear",stops,start:map(.5-vx/2,.5-vy/2),end:map(.5+vx/2,.5+vy/2)};
}
