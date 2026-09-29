import {volumeContour} from "./volume-contour";
import {effectProgram,applyPixelEffects,type EffectStep} from "./effect-program";
import {child,number} from "./appearance";
import {fallbackSize} from "./image-fallback";
import {renderGraphicRegion} from "./preview";
import type {GroupElementIR,PageIR} from "../../core/model";
export interface AppearanceEffects {softEdge:number;program?:EffectStep[]|undefined;reflection?:{opacity:number;end:number;distance:number;blur:number};volume?:{latitude:number;longitude:number;roll:number;depth:number;perspective?:number|undefined;contour?:[number,number][];outline?:"rect"|"ellipse"|"triangle"}}
export function appearanceEffects(props:Element|undefined,scale:number,warn:()=>void,source?:GroupElementIR):AppearanceEffects|undefined{
 const list=child(props,"effectLst"),soft=child(list,"softEdge"),reflection=child(list,"reflection"),scene=child(props,"scene3d"),solid=child(props,"sp3d"),camera=child(scene,"camera");
 const result:AppearanceEffects={program:effectProgram(props,warn),softEdge:number(soft,"rad",0)/9525*scale};
 if(result.softEdge<0||result.softEdge>100)throw new Error("security-limit");
 if(reflection){
   // Only vertical, unskewed reflection; all other variants retain the existing warning.
   if(number(reflection,"sx",100000)!==100000||number(reflection,"sy",100000)!==100000||number(reflection,"kx",0)||number(reflection,"ky",0)||number(reflection,"dir",5400000)!==5400000){warn();}
   else {const opacity=number(reflection,"stA",50000)/100000,end=number(reflection,"endPos",100000)/100000,distance=number(reflection,"dist",0)/9525*scale,blur=number(reflection,"blurRad",0)/9525*scale;if(opacity<0||opacity>1||end<=0||end>1||distance<0||distance>1000||blur<0||blur>100)throw new Error("security-limit");result.reflection={opacity,end,distance,blur};}
 }
 if(scene&&solid){
   if(["orthographicFront","perspectiveFront"].includes(camera?.getAttribute("prst")??"")){
     const rot=child(camera,"rot"),depth=number(solid,"extrusionH",0)/9525*scale;
     const latitude=number(rot,"lat",0)/60000,longitude=number(rot,"lon",0)/60000,roll=number(rot,"rev",0)/60000;
     if([latitude,longitude,roll].some(n=>Math.abs(n)>360)||depth<0||depth>1000)throw new Error("security-limit");
     const perspective=camera?.getAttribute("prst")==="perspectiveFront"?number(camera,"fov",2700000)/60000:undefined;if(perspective!==undefined&&(perspective<1||perspective>120))throw new Error("security-limit");
     const outline=child(props,"prstGeom")?.getAttribute("prst");if(outline==="rect"||outline==="ellipse"||outline==="triangle")result.volume={latitude,longitude,roll,depth,outline,perspective};else {const contour=source?volumeContour(source):undefined;if(contour)result.volume={latitude,longitude,roll,depth,perspective,contour};else warn();}
   }else warn();
 }
 return result.softEdge||result.reflection||result.volume||result.program?result:undefined;
}
export function appearanceBounds(w:number,h:number,e:AppearanceEffects){
 const v=e.volume,rad=Math.PI/180,ax=(v?.latitude??0)*rad,ay=(v?.longitude??0)*rad,az=(v?.roll??0)*rad;
 const project=(x:number,y:number,z:number)=>{x-=w/2;y-=h/2;const yy=y*Math.cos(ax)-z*Math.sin(ax),zz=y*Math.sin(ax)+z*Math.cos(ax),xx=x*Math.cos(ay)+zz*Math.sin(ay);const z2=-x*Math.sin(ay)+zz*Math.cos(ay),focal=v?.perspective?Math.max(w,h)/2/Math.tan(v.perspective*rad/2):0;if(focal&&focal+z2<focal*.1)throw new Error("security-limit");const k=focal?focal/(focal+z2):1;return {x:w/2+(xx*Math.cos(az)-yy*Math.sin(az))*k,y:h/2+(xx*Math.sin(az)+yy*Math.cos(az))*k};};
 const front=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>project(x!,y!,0)),back=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>project(x!,y!,v?.depth??0)),points=[...front,...back];
 const outline=v?.contour??(v?.outline==="ellipse"?Array.from({length:64},(_,i)=>[w/2+w/2*Math.cos(i*Math.PI/32),h/2+h/2*Math.sin(i*Math.PI/32)]):v?.outline==="triangle"?[[w/2,0],[w,h],[0,h]]:[[0,0],[w,0],[w,h],[0,h]]);
 const outlineFront=outline.map(([x,y])=>project(x!,y!,0)),outlineBack=outline.map(([x,y])=>project(x!,y!,v?.depth??0));
 const pad=Math.ceil(Math.max(e.softEdge,e.reflection?.blur??0)*3)+2,left=Math.floor(Math.min(...points.map(p=>p.x)))-pad,top=Math.floor(Math.min(...points.map(p=>p.y)))-pad,right=Math.ceil(Math.max(...points.map(p=>p.x)))+pad,bottom=Math.ceil(Math.max(...points.map(p=>p.y)))+pad;
 const height=bottom-top+(e.reflection?(bottom-top+e.reflection.distance):0),width=right-left;
 fallbackSize({width,height,crop:{l:0,r:0,t:0,b:0}});return {x:left,y:top,width,height,front,back,baseHeight:bottom-top,outlineFront,outlineBack,project};
}
/** Bounded local reconstruction, explicitly reported as approximate Office appearance. */
export async function renderAppearance(source:GroupElementIR,assets:PageIR["assets"],effects:AppearanceEffects,signal?:AbortSignal):Promise<{bytes:Uint8Array;bounds:ReturnType<typeof appearanceBounds>}>{
 const w=source.bounds.width,h=source.bounds.height,bounds=appearanceBounds(w,h,effects),deadline=Date.now()+15000;
 const check=()=>{if(signal?.aborted)throw new DOMException("Cancelled","AbortError");if(Date.now()>deadline)throw new Error("raster-render-timeout");};check();
 const url=await renderGraphicRegion({schemaVersion:1,id:"appearance",sourceIndex:0,width:w,height:h,elements:source.children,assets:assets??[],degradations:[]},signal);check();
 const texture=document.createElement("canvas"),canvas=document.createElement("canvas"),layer=document.createElement("canvas"),img=new Image();let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{const finish=(error?:Error)=>{clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);img.onload=null;img.onerror=null;error?reject(error):resolve();};abort=()=>finish(new DOMException("Cancelled","AbortError"));signal?.addEventListener("abort",abort,{once:true});img.onload=()=>finish();img.onerror=()=>finish(new Error("image-decode-failed"));timer=setTimeout(()=>finish(new Error("raster-render-timeout")),Math.max(1,deadline-Date.now()));img.src=url;});check();
  let drawable:CanvasImageSource=img;
  if(effects.program){fallbackSize({width:w,height:h,crop:{l:0,r:0,t:0,b:0}});texture.width=Math.ceil(w*2);texture.height=Math.ceil(h*2);const tc=texture.getContext("2d");if(!tc)throw new Error("raster-render-unavailable");tc.drawImage(img,0,0,texture.width,texture.height);const pixels=tc.getImageData(0,0,texture.width,texture.height);applyPixelEffects(pixels.data,effects.program);tc.putImageData(pixels,0,0);drawable=texture;check();}
  canvas.width=Math.ceil(bounds.width*2);canvas.height=Math.ceil(bounds.height*2);layer.width=canvas.width;layer.height=Math.ceil(bounds.baseHeight*2);
  const ctx=canvas.getContext("2d"),lc=layer.getContext("2d");if(!ctx||!lc)throw new Error("raster-render-unavailable");lc.scale(2,2);lc.translate(-bounds.x,-bounds.y);
  if(effects.volume){
    const {front:f,back:b}=bounds;
    const face=bounds.outlineFront,back=bounds.outlineBack;lc.beginPath();back.forEach((p,i)=>i?lc.lineTo(p.x,p.y):lc.moveTo(p.x,p.y));lc.closePath();lc.fillStyle="#67758b";lc.fill();
    for(let i=0;i<face.length;i++){const j=(i+1)%face.length;lc.beginPath();lc.moveTo(face[i]!.x,face[i]!.y);lc.lineTo(back[i]!.x,back[i]!.y);lc.lineTo(back[j]!.x,back[j]!.y);lc.lineTo(face[j]!.x,face[j]!.y);lc.closePath();const shade=Math.round(112+20*Math.cos(i*Math.PI*2/face.length));lc.fillStyle=`rgb(${shade},${shade+12},${shade+30})`;lc.fill();}
    if(effects.volume.perspective){
      // Piecewise affine texture projection, bounded to 512 triangles.
      for(let row=0;row<16;row++){check();for(let col=0;col<16;col++){
       const x=col*w/16,y=row*h/16,dx=w/16,dy=h/16;
       for(const tri of [[[x,y],[x+dx,y],[x,y+dy]],[[x+dx,y+dy],[x,y+dy],[x+dx,y]]]){
        const a=tri[0]!,b=tri[1]!,c=tri[2]!,pa=bounds.project(a[0]!,a[1]!,0),pb=bounds.project(b[0]!,b[1]!,0),pc=bounds.project(c[0]!,c[1]!,0);
        const sx=b[0]!-a[0]!,sy=c[1]!-a[1]!,aa=(pb.x-pa.x)/sx,bb=(pb.y-pa.y)/sx,cc=(pc.x-pa.x)/sy,dd=(pc.y-pa.y)/sy;
        lc.save();lc.beginPath();lc.moveTo(pa.x,pa.y);lc.lineTo(pb.x,pb.y);lc.lineTo(pc.x,pc.y);lc.closePath();lc.clip();lc.transform(aa,bb,cc,dd,pa.x-aa*a[0]!-cc*a[1]!,pa.y-bb*a[0]!-dd*a[1]!);lc.drawImage(drawable,0,0,w,h);lc.restore();
       }
      }}
    }else {lc.save();lc.transform((f[1]!.x-f[0]!.x)/w,(f[1]!.y-f[0]!.y)/w,(f[3]!.x-f[0]!.x)/h,(f[3]!.y-f[0]!.y)/h,f[0]!.x,f[0]!.y);lc.drawImage(drawable,0,0,w,h);lc.restore();}
  }else lc.drawImage(drawable,0,0,w,h);
  if(effects.softEdge){
    // Feather existing alpha inward; blur alone would incorrectly expand the silhouette.
    lc.save();lc.setTransform(1,0,0,1,0,0);lc.globalCompositeOperation="destination-in";lc.filter=`blur(${effects.softEdge*2}px)`;lc.drawImage(layer,0,0);lc.restore();
  }
  ctx.drawImage(layer,0,0);
  if(effects.reflection){const r=effects.reflection;ctx.save();ctx.translate(0,(bounds.baseHeight*2+r.distance)*2);ctx.scale(1,-1);ctx.globalAlpha=r.opacity;ctx.filter=`blur(${r.blur*2}px)`;ctx.drawImage(layer,0,0);ctx.restore();
    ctx.save();ctx.globalCompositeOperation="destination-in";const start=(bounds.baseHeight+r.distance)*2,gradient=ctx.createLinearGradient(0,start,0,start+bounds.baseHeight*2*r.end);gradient.addColorStop(0,"white");gradient.addColorStop(1,"transparent");ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();}
  check();const encoded=canvas.toDataURL("image/png").split(",")[1];if(!encoded)throw new Error("raster-render-failed");const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));check();return {bytes,bounds};
 }finally{clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);img.onload=null;img.onerror=null;try{img.src="";}catch{/* Release canvases even when a decoder rejects reset. */}texture.width=texture.height=canvas.width=canvas.height=layer.width=layer.height=0;}
}
