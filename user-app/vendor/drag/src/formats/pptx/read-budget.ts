import {fallbackSize,type ImageFallbackPlan} from "./image-fallback";
/** Cooperative page budget; synchronous XML/native decoding cannot be preempted. */
export class PptxReadBudget {
  private readonly deadline=Date.now()+60000;
  private pixels=0;
  private regions=0;
  constructor(private readonly signal?:AbortSignal){}
  check():void {
    if(this.signal?.aborted)throw new DOMException("Cancelled","AbortError");
    if(Date.now()>this.deadline)throw new Error("pptx-page-timeout");
  }
  reserveRaster(plan:ImageFallbackPlan):void {
    this.check();const {width,height}=fallbackSize(plan);
    if(this.regions+1>64||this.pixels+width*height>32000000)throw new Error("pptx-raster-budget");
    this.regions++;this.pixels+=width*height;
  }
}
