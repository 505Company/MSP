import { PPTX_GEOMETRY_LIMITS } from "./limits";
import { child, kids, number } from "./appearance";
import { graphicPath } from "./graphic-path";

export class UnsupportedGeometry extends Error {}
export interface CustomPath { pathData: string; bounds: {x:number;y:number;width:number;height:number}; filled: boolean; stroked: boolean }
/** Interpret DrawingML arithmetic; source formulas are never JavaScript. */
export function customGeometry(geometry: Element, width: number, height: number, scaleX = 1, scaleY = 1): CustomPath[] {
  const guides = new Map<string, number>();
  const w = width / scaleX * 9525, h = height / scaleY * 9525;
  for (const [key,value] of Object.entries({w,h,l:0,t:0,r:w,b:h,hc:w/2,vc:h/2,ss:Math.min(w,h),ls:Math.max(w,h),cd2:10800000,cd4:5400000,cd8:2700000})) guides.set(key,value);
  for (const n of [2,3,4,5,6,8,10,12,16,32]) { guides.set(`wd${n}`,w/n); guides.set(`hd${n}`,h/n); guides.set(`ssd${n}`,Math.min(w,h)/n); }
  const checked = (n:number) => { if(!Number.isFinite(n)||Math.abs(n)>1e12)throw new Error("security-limit");return n; };
  const arg = (s:string|null) => {
    if(s===null)throw new Error("invalid-file");
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return checked(Number(s));
    if(guides.has(s))return guides.get(s)!;
    throw new UnsupportedGeometry("Unsupported geometry guide");
  };
  const defs = [...kids(child(geometry,"avLst")),...kids(child(geometry,"gdLst"))];
  if(defs.length>PPTX_GEOMETRY_LIMITS.maxGuides)throw new Error("security-limit");
  for(const gd of defs){
    const name=gd.getAttribute("name"),formula=gd.getAttribute("fmla")??"";
    if(!name||name.length>128||formula.length>512)throw new Error("invalid-file");
    const [op,...words]=formula.trim().split(/\s+/);
    const arity:Record<string,number>={val:1,abs:1,sqrt:1,'*/':3,'+-':3,'+/':3,'?:':3,at2:2,cat2:3,cos:2,max:2,min:2,mod:3,pin:3,sat2:3,sin:2,tan:2};
    if(!op||!(op in arity)||words.length!==arity[op])throw new UnsupportedGeometry("Unsupported guide formula");
    const [a=0,b=0,c=0]=words.map(arg),angle=b/60000*Math.PI/180;
    let value:number;
    switch(op){
      case 'val':value=a;break; case 'abs':value=Math.abs(a);break;case 'sqrt':value=Math.sqrt(a);break;
      case '*/':value=a*b/c;break;case '+-':value=a+b-c;break;case '+/':value=(a+b)/c;break;case '?:':value=a>0?b:c;break;
      case 'at2':value=Math.atan2(b,a)*180/Math.PI*60000;break;
      case 'cat2':value=a*Math.cos(Math.atan2(c,b));break;case 'sat2':value=a*Math.sin(Math.atan2(c,b));break;
      case 'cos':value=a*Math.cos(angle);break;case 'sin':value=a*Math.sin(angle);break;case 'tan':value=a*Math.tan(angle);break;
      case 'max':value=Math.max(a,b);break;case 'min':value=Math.min(a,b);break;case 'mod':value=Math.hypot(a,b,c);break;case 'pin':value=Math.max(a,Math.min(b,c));break;
      default:throw new UnsupportedGeometry();
    }
    guides.set(name,checked(value));
  }
  const paths=kids(child(geometry,"pathLst"));
  if(paths.length>PPTX_GEOMETRY_LIMITS.maxPathsPerShape)throw new Error("security-limit");
  if(!paths.length)throw new UnsupportedGeometry();
  let commands=0;
  return paths.map(path=>{
    const pw=number(path,"w",w),ph=number(path,"h",h);
    if(pw<=0||ph<=0)throw new Error("invalid-file");
    const sx=width/pw,sy=height/ph;
    let x=0,y=0,startX=0,startY=0,started=false,data="";
    const point=(pt:Element)=>[arg(pt.getAttribute("x")),arg(pt.getAttribute("y"))];
    const pixel=(n:number)=>{checked(n);if(Math.abs(n)>1000000)throw new Error("security-limit");return n;};
    const write=(op:string,coords:number[])=>{data+=`${op} ${coords.map((n,i)=>pixel(n*(i%2?sy:sx))).join(" ")} `;if(data.length>500000)throw new Error("security-limit");};
    for(const command of kids(path)){
      if(++commands>PPTX_GEOMETRY_LIMITS.maxPathCommands)throw new Error("security-limit");
      const points=kids(command).map(point);
      if(!started&&command.localName!=="moveTo")throw new Error("invalid-file");
      if(command.localName==="moveTo"||command.localName==="lnTo"){
        if(points.length!==1)throw new Error("invalid-file");[x,y]=points[0] as [number,number];
        if(command.localName==="moveTo"){startX=x;startY=y;started=true;write("M",[x,y]);}else write("L",[x,y]);
      }else if(command.localName==="cubicBezTo"){
        if(points.length!==3)throw new Error("invalid-file");write("C",points.flat());[x,y]=points[2] as [number,number];
      }else if(command.localName==="quadBezTo"){
        if(points.length!==2)throw new Error("invalid-file");const [control,end]=points as [[number,number],[number,number]];
        write("C",[x+2/3*(control[0]-x),y+2/3*(control[1]-y),end[0]+2/3*(control[0]-end[0]),end[1]+2/3*(control[1]-end[1]),...end]);[x,y]=end;
      }else if(command.localName==="arcTo"){
        const rx=arg(command.getAttribute("wR")),ry=arg(command.getAttribute("hR")),start=arg(command.getAttribute("stAng"))/60000*Math.PI/180,sweep=arg(command.getAttribute("swAng"))/60000*Math.PI/180;
        if(rx<=0||ry<=0||Math.abs(sweep)>2*Math.PI+.000001)throw new UnsupportedGeometry("Unsupported arc");
        if(!sweep)continue;
        const param=(a:number)=>Math.atan2(rx*Math.sin(a),ry*Math.cos(a));
        const a=param(start);let end=param(start+sweep);
        if(Math.abs(sweep)>=2*Math.PI-.000001)end=a+Math.sign(sweep)*2*Math.PI;
        else if(sweep>0){while(end<a)end+=2*Math.PI;}else {while(end>a)end-=2*Math.PI;}
        const cx=x-rx*Math.cos(a),cy=y-ry*Math.sin(a),steps=Math.max(1,Math.ceil(Math.abs(end-a)/(Math.PI/2)));
        for(let i=0;i<steps;i++){
          const t=a+(end-a)*i/steps,u=a+(end-a)*(i+1)/steps,k=4/3*Math.tan((u-t)/4);
          write("C",[cx+rx*(Math.cos(t)-k*Math.sin(t)),cy+ry*(Math.sin(t)+k*Math.cos(t)),cx+rx*(Math.cos(u)+k*Math.sin(u)),cy+ry*(Math.sin(u)-k*Math.cos(u)),cx+rx*Math.cos(u),cy+ry*Math.sin(u)]);
        }
        x=cx+rx*Math.cos(end);y=cy+ry*Math.sin(end);
      }else if(command.localName==="close"){data+="Z ";x=startX;y=startY;}
      else throw new UnsupportedGeometry("Unsupported path command");
    }
    const fill=path.getAttribute("fill")??"norm";
    if(!["norm","none"].includes(fill))throw new UnsupportedGeometry("Unsupported path fill modulation");
    return {...graphicPath(data),filled:fill!=="none",stroked:!["0","false"].includes(path.getAttribute("stroke")??"1")};
  });
}
