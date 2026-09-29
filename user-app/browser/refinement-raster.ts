import type { RasterRegionEvidence, RasterRegionSource, RasterRegionImage } from '@/lib/design-system/refinement-raster'
import type { EditableCatalog } from '@/lib/design-system/editable-contract'
import type { HtmlQualification } from '@/lib/design-system/editable-qualification'
import { compareGraphicPixels, graphicPixels, scenePreview } from '@/lib/design-system/reconstruction-browser'

async function crop(uploadId: string, source: RasterRegionEvidence, width: number, height: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const image=new Image(); image.src=`/api/uploads/${uploadId}/assets/${source.assetId}`; await image.decode(); signal?.throwIfAborted()
  const canvas=document.createElement('canvas'); canvas.width=Math.max(8,Math.round(width)); canvas.height=Math.max(8,Math.round(height))
  const r=source.region,ctx=canvas.getContext('2d')!
  ctx.drawImage(image,r.x*image.naturalWidth,r.y*image.naturalHeight,r.width*image.naturalWidth,r.height*image.naturalHeight,0,0,canvas.width,canvas.height)
  return canvas
}
export async function prepareRasterRegion(uploadId: string, source: RasterRegionSource, signal?: AbortSignal): Promise<RasterRegionImage> {
  const scale=Math.min(1,1280/Math.max(source.width,source.height)), canvas=await crop(uploadId,source,source.width*scale,source.height*scale,signal)
  const result={width:canvas.width,height:canvas.height,dataUrl:canvas.toDataURL('image/png')};canvas.width=canvas.height=0;return result
}
/** Raster reconstruction must also match its source pixels, especially each
 * text field. A rendered paragraph alone never certifies the transcription. */
export async function qualifyRasterRegions(uploadId: string, catalog: EditableCatalog, report: HtmlQualification, signal?: AbortSignal) {
  for(const t of catalog.families.flatMap(f=>f.variants)) {
    const source=t.sourceRegion,check=report.checks.find(c=>c.id===t.id)
    if(!source?.elements||!check||!check.passed)continue
    try {
      const original=await crop(uploadId,source,t.width,t.height,signal),ctx=original.getContext('2d')!,a=ctx.getImageData(0,0,original.width,original.height)
      const url=await scenePreview(source.elements,t.width,t.height,uploadId,signal),b=await graphicPixels(url,a.width,a.height,signal),whole=compareGraphicPixels(a,b)
      let textRecall=1
      for(const field of source.elements.filter(e=>e.kind==='text')) {
        const r=field.bounds,x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y)),width=Math.max(1,Math.min(a.width-x,Math.ceil(r.width))),height=Math.max(1,Math.min(a.height-y,Math.ceil(r.height)))
        const extract=(image:ImageData)=>{const values=new Uint8ClampedArray(width*height*4);for(let row=0;row<height;row++)values.set(image.data.subarray(((y+row)*image.width+x)*4,((y+row)*image.width+x+width)*4),row*width*4);return new ImageData(values,width,height)}
        textRecall=Math.min(textRecall,compareGraphicPixels(extract(a),extract(b)).foregroundRecall)
      }
      check.visual={...whole,textRecall}
      if(whole.pixelError>.025||whole.foregroundRecall<.97||textRecall<.97) {check.passed=false;check.source=false;check.issues.push('Восстановление текста или оформления отличается от исходной картинки. Исходный фрагмент сохранён.')} 
      original.width=original.height=0
    } catch(error) { signal?.throwIfAborted();check.passed=false;check.source=false;check.issues.push(error instanceof Error?error.message:'Не удалось сравнить восстановление с исходником') }
  }
}
