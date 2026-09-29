import {imageDimensions} from "../../core/image-budget";
export interface ImageFallbackPlan {width:number;height:number;crop:{l:number;r:number;t:number;b:number};fillRect?:{l:number;r:number;t:number;b:number};mask?:string;ellipse?:boolean;grayscale?:boolean;threshold?:number;alpha?:number}
/** OOXML srcRect permits negative offsets (outsets) for stretched images.
 * Keep a finite positive source window; raster pixel budgets stay unchanged. */
export function validSourceCrop(c:ImageFallbackPlan['crop']):boolean{
  const width=1-c.l-c.r,height=1-c.t-c.b;
  return Object.values(c).every(n=>Number.isFinite(n)&&n<1)&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0;
}
export function fallbackSize(plan:ImageFallbackPlan):{width:number;height:number}{
  const width=Math.ceil(plan.width*2),height=Math.ceil(plan.height*2),c=plan.crop;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>4096||height>4096||width*height>4000000)throw new Error("image-pixel-limit");
  if(!validSourceCrop(c))throw new Error("invalid-image-crop");
  if(plan.fillRect&&!validSourceCrop(plan.fillRect))throw new Error("invalid-image-fill");
  if(plan.threshold!==undefined&&(!Number.isFinite(plan.threshold)||plan.threshold<0||plan.threshold>1)||plan.alpha!==undefined&&(!Number.isFinite(plan.alpha)||plan.alpha<0||plan.alpha>1))throw new Error("invalid-image-effect");
  return {width,height};
}
/** Local transparent 2× region: source pixels, crop, geometric mask and simple pixel effects. */
export async function rasterizeImage(bytes:Uint8Array,plan:ImageFallbackPlan,signal?:AbortSignal):Promise<Uint8Array>{
  imageDimensions(bytes);const size=fallbackSize(plan),deadline=Date.now()+15000;
  const check=()=>{if(signal?.aborted)throw new DOMException("Cancelled","AbortError");if(Date.now()>deadline)throw new Error("raster-render-timeout");};check();
  const canvas=document.createElement("canvas"),url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:bytes[0]===255?"image/jpeg":"image/png"}));
  let image:HTMLImageElement|undefined,timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{
    image=new Image();const loading=image;
    await new Promise<void>((resolve,reject)=>{
      abort=()=>finish(new DOMException("Cancelled","AbortError"));
      const finish=(error?:Error)=>{clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);loading.onload=null;loading.onerror=null;error?reject(error):resolve();};
      loading.onload=()=>finish();loading.onerror=()=>finish(new Error("image-decode-failed"));signal?.addEventListener("abort",abort,{once:true});timer=setTimeout(()=>finish(new Error("raster-render-timeout")),15000);loading.src=url;
    });check();canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("raster-render-unavailable");
    ctx.scale(size.width/plan.width,size.height/plan.height);
    if(plan.ellipse){ctx.beginPath();ctx.ellipse(plan.width/2,plan.height/2,plan.width/2,plan.height/2,0,0,Math.PI*2);ctx.clip();}
    else if(plan.mask)ctx.clip(new Path2D(plan.mask),"nonzero");
    const c=plan.crop,f=plan.fillRect??{l:0,r:0,t:0,b:0},iw=plan.width*(1-f.l-f.r)/(1-c.l-c.r),ih=plan.height*(1-f.t-f.b)/(1-c.t-c.b);ctx.drawImage(image,f.l*plan.width-c.l*iw,f.t*plan.height-c.t*ih,iw,ih);check();
    if(plan.grayscale||plan.threshold!==undefined||plan.alpha!==undefined){
      const pixels=ctx.getImageData(0,0,size.width,size.height),data=pixels.data;
      for(let i=0;i<data.length;i+=4){if(i%262144===0)check();const gray=.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!;if(plan.grayscale||plan.threshold!==undefined){const value=plan.threshold===undefined?gray:gray>=plan.threshold*255?255:0;data[i]=data[i+1]=data[i+2]=value;}if(plan.alpha!==undefined)data[i+3]=data[i+3]!*plan.alpha;}
      ctx.putImageData(pixels,0,0);
    }
    check();const data=canvas.toDataURL("image/png").split(",")[1];if(!data)throw new Error("raster-render-failed");const binary=atob(data),result=Uint8Array.from(binary,c=>c.charCodeAt(0));check();return result;
  }finally{clearTimeout(timer);if(abort)signal?.removeEventListener("abort",abort);if(image){image.onload=null;image.onerror=null;try{image.src="";}catch{/* Cleanup continues even when the decoder rejects resetting its source. */}}URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;}
}
