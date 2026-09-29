import type { BaseElementIR, SolidPaintIR, TextElementIR } from "../../core/model";
import type { PptxCatalogReader } from "./catalog";
import type { SlideAppearance } from "./appearance";
export interface GraphicContext {
  reader: PptxCatalogReader;
  appearance: SlideAppearance;
  base(name: string, width: number, height: number): BaseElementIR;
  warn(code: string): void;
  check(): void;
  width: number; height: number; scaleX: number; scaleY: number;
}
export const solid = (r: number, g: number, b: number, a = 1): SolidPaintIR => ({ type:"solid", color:{r,g,b,a} });
export function label(ctx: GraphicContext, text: string, x: number, y: number, width: number, height: number, size: number, paint: SolidPaintIR, fontFamily: string, align: "LEFT" | "CENTER" | "RIGHT" = "LEFT"): TextElementIR {
  if (!Number.isFinite(size) || size <= 0 || size > 10000 || text.length > 1000000) throw new Error("security-limit");
  return { ...ctx.base("Chart label", Math.max(.01,width), Math.max(.01,height)), kind:"text", text: text || " ", fontFamily, fontSize:size, fontStyle:"Regular", bounds:{x,y,width:Math.max(.01,width),height:Math.max(.01,height)}, textBox:{align,vertical:"CENTER",wrap:true}, colorRuns:[{start:0,end:(text || " ").length,fill:paint}] };
}
