import {child,kids} from "./appearance";
/** Common planar presets. Unknown adjustment formulas are explicitly disclosed. */
export function presetPath(name:string,w:number,h:number,geometry:Element|undefined,warn:()=>void):string|undefined {
  const guides=new Map<string,number>();
  for(const gd of kids(child(geometry,"avLst"))){const f=gd.getAttribute("fmla")??"";if(!/^val [+-]?\d+(?:\.\d+)?$/.test(f)){warn();continue;}const n=Number(f.slice(4));if(!Number.isFinite(n)||Math.abs(n)>1000000)throw new Error("security-limit");guides.set(gd.getAttribute("name")??"",n);}
  const val=(key:string,def:number,max=100000)=>Math.max(0,Math.min(max,guides.get(key)??def))/100000;
  const polygon=(points:number[][])=>points.map((p,i)=>`${i?"L":"M"} ${p[0]} ${p[1]}`).join(" ")+" Z";
  const regular=(n:number,star=false)=>{const points=Array.from({length:star?n*2:n},(_,i)=>{const a=-Math.PI/2+i*Math.PI*2/(star?n*2:n),r=star&&i%2?.4:1;return [Math.cos(a)*r,Math.sin(a)*r];});const xs=points.map(p=>p[0]!),ys=points.map(p=>p[1]!),l=Math.min(...xs),t=Math.min(...ys),rw=Math.max(...xs)-l,rh=Math.max(...ys)-t;return polygon(points.map(p=>[(p[0]!-l)/rw*w,(p[1]!-t)/rh*h]));};
  const stars=/^star(4|6|7|8|10|12|16|24|32)$/.exec(name);
  if(stars){warn();return regular(Number(stars[1]),true);}
  if(name==="heptagon"||name==="decagon"||name==="dodecagon"){if(guides.size)warn();return regular(name==="heptagon"?7:name==="decagon"?10:12);}
  if(name==="triangle")return polygon([[w/2,0],[w,h],[0,h]]);
  if(name==="roundRect"||name==="flowChartAlternateProcess"){
    // The alternate-process preset uses a fixed short-side / 6 radius.
    const r=name==="flowChartAlternateProcess"?Math.min(w,h)/6:Math.min(w,h)*val("adj",16667,50000),k=.55228475;
    return `M ${r} 0 L ${w-r} 0 C ${w-r+k*r} 0 ${w} ${r-k*r} ${w} ${r} L ${w} ${h-r} C ${w} ${h-r+k*r} ${w-r+k*r} ${h} ${w-r} ${h} L ${r} ${h} C ${r-k*r} ${h} 0 ${h-r+k*r} 0 ${h-r} L 0 ${r} C 0 ${r-k*r} ${r-k*r} 0 ${r} 0 Z`;
  }
  if(name==="round2SameRect"){
    // Independent radii for the top and bottom corner pairs (DrawingML adj1/adj2).
    const top=Math.min(w,h)*val("adj1",16667,50000),bottom=Math.min(w,h)*val("adj2",0,50000),k=.55228475;
    return `M ${top} 0 L ${w-top} 0 C ${w-top+k*top} 0 ${w} ${top-k*top} ${w} ${top} L ${w} ${h-bottom} C ${w} ${h-bottom+k*bottom} ${w-bottom+k*bottom} ${h} ${w-bottom} ${h} L ${bottom} ${h} C ${bottom-k*bottom} ${h} 0 ${h-bottom+k*bottom} 0 ${h-bottom} L 0 ${top} C 0 ${top-k*top} ${top-k*top} 0 ${top} 0 Z`;
  }
  if(name==="rtTriangle")return polygon([[0,0],[w,h],[0,h]]);
  if(name==="bentConnector2")return `M 0 0 L ${w} 0 L ${w} ${h}`;
  if(name==="bentConnector3"){const mid=w*val("adj1",50000);return `M 0 0 L ${mid} 0 L ${mid} ${h} L ${w} ${h}`;}
  if(name==="curvedConnector2")return `M 0 0 C ${w} 0 ${w} 0 ${w} ${h}`;
  if(name==="curvedConnector3")return `M 0 0 C ${w/2} 0 ${w/2} ${h} ${w} ${h}`;
  if(name==="flowChartDecision")return polygon([[w/2,0],[w,h/2],[w/2,h],[0,h/2]]);
  if(name==="flowChartInputOutput"){const x=w/5;return polygon([[x,0],[w,0],[w-x,h],[0,h]]);}
  if(name==="flowChartPreparation")return polygon([[w/5,0],[w*4/5,0],[w,h/2],[w*4/5,h],[w/5,h],[0,h/2]]);
  if(name==="flowChartMerge")return polygon([[0,0],[w,0],[w/2,h]]);
  if(name==="flowChartExtract")return polygon([[w/2,0],[w,h],[0,h]]);
  if(name==="flowChartProcess")return polygon([[0,0],[w,0],[w,h],[0,h]]);
  if(["pentagon","star5"].includes(name)){if(guides.size)warn();return regular(5,name==="star5");}
  if(name==="diamond")return polygon([[w/2,0],[w,h/2],[w/2,h],[0,h/2]]);
  const s=Math.min(w,h);
  if(name==="parallelogram"){const x=s*val("adj",25000,50000);return polygon([[x,0],[w,0],[w-x,h],[0,h]]);}
  if(name==="trapezoid"){const x=s*val("adj",25000,50000);return polygon([[x,0],[w-x,0],[w,h],[0,h]]);}
  if(name==="hexagon"){const x=s*val("adj",25000,50000);return polygon([[x,0],[w-x,0],[w,h/2],[w-x,h],[x,h],[0,h/2]]);}
  if(name==="octagon"){const x=s*val("adj",29289,50000);return polygon([[x,0],[w-x,0],[w,x],[w,h-x],[w-x,h],[x,h],[0,h-x],[0,x]]);}
  if(name==="chevron"){const x=Math.min(w/2,s*val("adj",50000));return polygon([[0,0],[w-x,0],[w,h/2],[w-x,h],[0,h],[x,h/2]]);}
  if(["rightArrow","leftArrow","upArrow","downArrow","leftRightArrow"].includes(name)){
    const vertical=name==="upArrow"||name==="downArrow",width=vertical?h:w,height=vertical?w:h,head=Math.min(width/(name==="leftRightArrow"?2:1),Math.min(width,height)*val("adj2",50000)),half=height*val("adj1",50000)/2;
    let pts=name==="leftRightArrow"?[[0,height/2],[head,0],[head,height/2-half],[width-head,height/2-half],[width-head,0],[width,height/2],[width-head,height],[width-head,height/2+half],[head,height/2+half],[head,height]]:[[0,height/2-half],[width-head,height/2-half],[width-head,0],[width,height/2],[width-head,height],[width-head,height/2+half],[0,height/2+half]];
    if(name==="leftArrow")pts=pts.map(p=>[width-p[0]!,p[1]!]);
    if(vertical)pts=pts.map(p=>[p[1]!,name==="upArrow"?width-p[0]!:p[0]!]);return polygon(pts);
  }
  if(name==="plus"){const a=s*val("adj",25000,50000);return polygon([[a,0],[w-a,0],[w-a,a],[w,a],[w,h-a],[w-a,h-a],[w-a,h],[a,h],[a,h-a],[0,h-a],[0,a],[a,a]]);}
  if(name==="heart"){if(guides.size)warn();return `M ${w/2} ${h} C ${-w*.2} ${h*.45} 0 ${-h*.25} ${w/2} ${h*.2} C ${w} ${-h*.25} ${w*1.2} ${h*.45} ${w/2} ${h} Z`;}
  return undefined;
}
