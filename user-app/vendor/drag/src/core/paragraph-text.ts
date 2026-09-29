import type { ParagraphIR, TextElementIR } from "./model";
/** Slice UTF-16 ranges without losing fonts, colors or hyperlinks at paragraph boundaries. */
export function paragraphText(source:TextElementIR,p:ParagraphIR,index:number):TextElementIR {
  const { paragraphs, flow, centeredTransform, effects, ...base }=source;
  const slice=<T extends {start:number;end:number}>(runs:T[]|undefined):T[]=> (runs??[]).filter(r=>r.end>p.start&&r.start<p.end).map(r=>({...r,start:Math.max(r.start,p.start)-p.start,end:Math.min(r.end,p.end)-p.start}));
  const styles=slice(source.styleRuns), first=styles[0];
  return {...base,id:`${source.id}-p${index}`,name:`Paragraph ${index+1}`,rotation:0,opacity:1,visible:true,
    text:source.text.slice(p.start,p.end),fontFamily:first?.fontFamily??source.fontFamily,fontStyle:first?.fontStyle??source.fontStyle??"Regular",fontSize:p.fontSize,
    styleRuns:styles,colorRuns:slice(source.colorRuns),linkRuns:slice(source.linkRuns),
    bounds:{x:p.left,y:0,width:source.bounds.width-p.left-p.right,height:source.bounds.height},
    textBox:{align:p.align,vertical:"TOP",wrap:source.textBox?.wrap??true}};
}
export function paragraphLineHeight(p:ParagraphIR):number {return p.lineHeight?.unit==="PIXELS"?p.lineHeight.value:p.fontSize*(p.lineHeight?.value??120)/100;}
