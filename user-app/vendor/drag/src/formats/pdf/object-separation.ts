import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { BoundsIR, ElementIR } from '../../core/model';

export const pdfImagePaints = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask]);
export function isPdfPaint(op: number, args: unknown[] = []): boolean {
  return pdfImagePaints.has(op) || op === OPS.shadingFill || op === OPS.showText ||
    (op === OPS.constructPath && args[0] !== OPS.endPath) ||
    [OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup].includes(op);
}

/** Classify source paints, not container membership. A form is a coordinate and
 * clipping scope; only transparency groups and backdrop-dependent state force
 * its paints to stay composited. */
export function separatePdfObjects(fn: number[], args: unknown[][], elements: ElementIR[], viewport: { transform: number[] }) {
  let state = { matrix: [1,0,0,1,0,0], clip: undefined as BoundsIR | undefined, complexClip: false,
    blend: false, mask: false, group: false, unknown: false, fillAlpha: 1, strokeAlpha: 1,
    strokeStyle: false, fillPattern: false, strokePattern: false, textMode: 0 };
  const stack: typeof state[] = [];
  const native = new Map<number, { clipBounds?: BoundsIR; opacity: number }>();
  const isolated = new Set<number>(), dependent = new Set<number>(), clipOperations = new Set<number>();
  const mapped = new Map(elements.filter(e => e.kind !== 'text').map(e => [e.zIndex,e]));
  let pendingClip = false;
  const intersect = (a: BoundsIR | undefined,b: BoundsIR): BoundsIR => {
    if(!a)return b;
    const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
    return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
  };
  const addClip = (box: ArrayLike<number>) => {
    const m=Util.transform(viewport.transform,state.matrix);
    if(m[1]!==0||m[2]!==0){state.complexClip=true;return;}
    const x1=m[0]!*box[0]!+m[4]!,y1=m[3]!*box[1]!+m[5]!,x2=m[0]!*box[2]!+m[4]!,y2=m[3]!*box[3]!+m[5]!;
    state.clip=intersect(state.clip,{x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)});
  };
  for(let i=0;i<fn.length;i++){
    const op=fn[i]!,v=args[i]??[];
    if(op===OPS.save||op===OPS.paintFormXObjectBegin||op===OPS.beginGroup){
      stack.push({...state,matrix:[...state.matrix]});
      if(stack.length>256)throw new Error('composite-state-limit');
      if(op===OPS.paintFormXObjectBegin){if(v[0])state.matrix=Util.transform(state.matrix,v[0] as number[]);if(v[1])addClip(v[1] as ArrayLike<number>);}
      if(op===OPS.beginGroup)state.group=true;
    }
    if(op===OPS.restore||op===OPS.paintFormXObjectEnd||op===OPS.endGroup)state=stack.pop()??state;
    if(op===OPS.transform)state.matrix=Util.transform(state.matrix,v as number[]);
    if(op===OPS.clip||op===OPS.eoClip){pendingClip=true;clipOperations.add(i);}
    if(op===OPS.constructPath&&pendingClip){
      clipOperations.add(i);pendingClip=false;
      const p=(v[1] as ArrayLike<ArrayLike<number>>)?.[0];
      if(p?.length===13&&p[0]===0&&p[3]===1&&p[6]===1&&p[9]===1&&p[12]===4&&p[1]===p[10]&&p[2]===p[5]&&p[4]===p[7]&&p[8]===p[11])addClip(v[2] as ArrayLike<number>);
      else state.complexClip=true;
      // Painted clipping paths have coupled paint/clip semantics.
      if(v[0]!==OPS.endPath)state.unknown=true;
    }
    if(op===OPS.setTextRenderingMode)state.textMode=Number(v[0]);
    if([OPS.setDash,OPS.setLineCap,OPS.setLineJoin,OPS.setMiterLimit].includes(op))state.strokeStyle=true;
    if(op===OPS.setFillColorN)state.fillPattern=true;
    if(op===OPS.setStrokeColorN)state.strokePattern=true;
    if(op===OPS.setFillRGBColor)state.fillPattern=false;
    if(op===OPS.setStrokeRGBColor)state.strokePattern=false;
    if(op===OPS.setGState){
      if(!Array.isArray(v[0]))state.unknown=true;
      else for(const [key,value] of v[0] as [string,unknown][]){
        if(key==='BM')state.blend=value!=='source-over';
        else if(key==='SMask')state.mask=value!==false;
        else if(key==='ca')state.fillAlpha=Number(value);
        else if(key==='CA')state.strokeAlpha=Number(value);
        else if(['LW','LC','LJ','ML','D'].includes(key))state.strokeStyle=true;
        else state.unknown=true;
      }
    }
    if(!isPdfPaint(op,v))continue;
    if(state.blend||state.mask||state.group||state.unknown||(op===OPS.showText&&state.textMode!==0&&state.textMode!==3))dependent.add(i);
    else if(op!==OPS.showText){
      const e=mapped.get(i),shape=e&&e.kind!=='raster';
      const stroked=shape&&'stroke' in e&&!!e.stroke;
      const filled=shape&&'fill' in e&&!!e.fill;
      if(e&&!state.complexClip&&(!shape||(!state.fillPattern&&!state.strokePattern&&(!stroked||!state.strokeStyle)&&(!filled||!stroked||state.fillAlpha===state.strokeAlpha)))){
        native.set(i,{...(state.clip?{clipBounds:state.clip}:{}),opacity:stroked&&!filled?state.strokeAlpha:state.fillAlpha});
      }else isolated.add(i);
    }
    if(op===OPS.showText&&state.textMode>=4)state.unknown=true;
  }
  return {native,isolated,dependent,clipOperations};
}
