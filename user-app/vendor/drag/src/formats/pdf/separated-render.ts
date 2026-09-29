import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { BoundsIR, ElementIR, PageIR } from '../../core/model';
import { SECURITY_LIMITS } from '../../core/limits';
import { compositeTiles, measureCompositeRegions, mergeRegions, renderCompositeTile } from './composite-fallback';
import { pdfImagePaints, separatePdfObjects } from './object-separation';

export async function renderSeparatedObjects(page: PDFPageProxy, ops: {fnArray:number[];argsArray:unknown[][]}, input: ElementIR[], assets: NonNullable<PageIR['assets']>, plan: ReturnType<typeof separatePdfObjects>, textPaints:Set<number>, textIds:Set<string>, signal?:AbortSignal) {
  let elements=input.filter(e=>e.kind==='text'||plan.native.has(e.zIndex));
  for(const e of elements){const appearance=plan.native.get(e.zIndex);if(appearance)Object.assign(e,appearance);}
  elements=elements.filter(e=>!('clipBounds' in e)||!e.clipBounds||(e.clipBounds.width>0&&e.clipBounds.height>0));
  const warnings: PageIR['degradations']=[];
  for(const i of textPaints)plan.dependent.delete(i);
  const boxes=new Map<number,BoundsIR>();
  const requested=new Set([...plan.dependent,...plan.isolated]);
  if(requested.size)await measureCompositeRegions(page,requested,[],signal,boxes);
  // A dependent paint must retain its backdrop. Independent paints after it
  // remain at their original positions in the stack, including inside forms.
  let last=-1; for(const index of plan.dependent)last=Math.max(last,index);
  const regions=mergeRegions([...plan.dependent].flatMap(i=>boxes.has(i)?[boxes.get(i)!]:[]));
  const contained=(b:BoundsIR,e:ElementIR)=>e.rotation===0&&e.bounds.x>=b.x&&e.bounds.y>=b.y&&e.bounds.x+e.bounds.width<=b.x+b.width&&e.bounds.y+e.bounds.height<=b.y+b.height;
  elements=elements.filter(e=>textIds.has(e.id)||!(e.zIndex<=last&&regions.some(b=>contained(b,e))));
  for(const e of elements)if(textIds.has(e.id)&&e.zIndex<=last)e.zIndex=last+1;
  const retained=new Set(elements.flatMap(e=>e.kind==='raster'?[e.assetId]:[]));
  for(let i=assets.length-1;i>=0;i--)if(!retained.has(assets[i]!.id))assets.splice(i,1);
  let rasterCount=0,assetBytes=assets.reduce((n,a)=>n+a.bytes.length,0),pixels=0;
  const started=Date.now();
  const add=async(bounds:BoundsIR,index:number,composite:boolean)=>{
    if(++rasterCount>SECURITY_LIMITS.maxRasterRegions)throw new Error('raster-region-limit');
    pixels+=Math.ceil(bounds.width*2)*Math.ceil(bounds.height*2);
    if(pixels>32_000_000)throw new Error('image-pixel-limit');
    if(Date.now()-started>60_000)throw new Error('raster-render-timeout');
    const bytes=await renderCompositeTile(page,bounds,signal,{fn:ops.fnArray,end:index,exclude:textPaints,...(!composite?{only:new Set([index]),clips:plan.clipOperations}:{})});
    if((assetBytes+=bytes.length)>SECURITY_LIMITS.maxPageAssetBytes)throw new Error('page-image-byte-limit');
    const id=`pdf-${composite?'composite':'object'}-${index}-${rasterCount}`;
    assets.push({id,bytes});
    const image=pdfImagePaints.has(ops.fnArray[index]!);
    const mask=ops.fnArray[index]===OPS.paintImageMaskXObject||ops.fnArray[index]===OPS.paintSolidColorImageMask;
    elements.push({id,name:composite?'Flattened appearance region':image?'Image':'Rasterized graphic',kind:'raster',assetId:id,reason:composite?'composite-effects':mask?'image-mask':image?'image-effects':'unsupported-path',bounds,rotation:0,opacity:1,visible:true,zIndex:index});
    warnings.push({code:composite?'pdf-composite-rasterized':mask?'pdf-image-mask-rasterized':image?'pdf-image-flattened':'pdf-path-rasterized',message:composite?'A backdrop-dependent effect was preserved with its local background. Mapped text remains editable; its overlap with this effect may differ.':image?'This image remains a separate layer. Its clipping, transform or effects are baked into the image.':'This graphic was preserved as a separate image; its internal geometry is not editable.',elementId:id});
    await new Promise(resolve=>setTimeout(resolve,0));
  };
  for(const index of plan.isolated){
    const bounds=boxes.get(index);if(!bounds)continue;
    if(index<=last&&regions.some(b=>contained(b,{bounds,rotation:0} as ElementIR)))continue;
    for(const tile of compositeTiles([bounds]))await add(tile,index,false);
  }
  for(const bounds of compositeTiles(regions))await add(bounds,last,true);
  return {elements,warnings};
}
