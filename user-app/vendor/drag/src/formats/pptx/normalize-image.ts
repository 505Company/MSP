import {SECURITY_LIMITS} from '../../core/limits';
import {imageDimensions,pptxSourceDimensions} from '../../core/image-budget';
export async function normalizePptxImage(bytes:Uint8Array,signal?:AbortSignal):Promise<{bytes:Uint8Array;resized:boolean}>{
 const deadline=Date.now()+SECURITY_LIMITS.maxRasterRenderMs;
 const check=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(Date.now()>deadline)throw new Error('raster-render-timeout');};
 check();
 const size=pptxSourceDimensions(bytes);
 if(size.width*size.height<=SECURITY_LIMITS.maxImagePixels)return {bytes,resized:false};
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const scale=Math.sqrt(SECURITY_LIMITS.maxImagePixels/(size.width*size.height));
 const width=Math.max(1,Math.floor(size.width*scale)),height=Math.max(1,Math.floor(size.height*scale));
 let expired=false,bitmap:ImageBitmap|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let abort:(()=>void)|undefined;
 const canvas=document.createElement('canvas');
 try{
  const decode=createImageBitmap(new Blob([new Uint8Array(bytes)],{type:size.format==='jpeg'?'image/jpeg':'image/png'}),{resizeWidth:width,resizeHeight:height,resizeQuality:'high'}).then(value=>{if(expired){value.close();throw new Error('image-decode-expired');}return value;});
  bitmap=await Promise.race([decode,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('raster-render-timeout'));},SECURITY_LIMITS.maxRasterRenderMs);abort=()=>{expired=true;reject(new DOMException('Cancelled','AbortError'));};signal?.addEventListener('abort',abort,{once:true});})]);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('raster-render-unavailable');
  ctx.drawImage(bitmap,0,0,width,height);
  const encoded=canvas.toDataURL('image/png').split(',')[1];if(!encoded)throw new Error('image-decode-failed');
  check();
  const result=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));imageDimensions(result);
  return {bytes:result,resized:true};
 }finally{expired=true;clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);bitmap?.close();canvas.width=0;canvas.height=0;}
}
