import type { BaseElementIR } from "../../core/model";
import { child, kids, number, color, type SlideAppearance } from "./appearance";

/** Editable native shadows only. Unsupported scale/skew/3D effects are explicitly disclosed. */
export function readEffects(properties: Element | undefined, context: SlideAppearance, sx: number, sy: number, warn: (code: string) => void): BaseElementIR["effects"] {
  if (!properties) return undefined;
  if (kids(properties).some(e => ["effectDag", "scene3d", "sp3d"].includes(e.localName) && (e.children.length || e.attributes.length))) warn("pptx-effect");
  const result: NonNullable<BaseElementIR["effects"]> = [];
  for (const effect of kids(child(properties, "effectLst"))) {
    if(effect.localName==="blur")continue;
    if(effect.localName==="glow"){const paint=color(kids(effect)[0],context,()=>warn("pptx-effect")),radius=number(effect,"rad",0)/9525*sy;if(radius<0||radius>1000)throw new Error("security-limit");if(paint)result.push({type:"DROP_SHADOW",color:paint.color,offset:{x:0,y:0},radius});warn("pptx-effect");continue;}
    if (!["outerShdw", "innerShdw"].includes(effect.localName)) { warn("pptx-effect"); continue; }
    if (number(effect, "sx", 100000) !== 100000 || number(effect, "sy", 100000) !== 100000 || number(effect, "kx", 0) || number(effect, "ky", 0) || ["0", "false"].includes(effect.getAttribute("rotWithShape") ?? "1") || Math.abs(sx-sy) > .00001) { warn("pptx-effect"); continue; }
    const paint = color(kids(effect).find(e => e.localName.endsWith("Clr")), context, () => warn("pptx-effect"));
    if (!paint) { warn("pptx-effect"); continue; }
    const angle = number(effect, "dir", 0) / 60000 * Math.PI / 180;
    const distance = number(effect, "dist", 0) / 9525;
    const radius = number(effect, "blurRad", 0) / 9525 * sy;
    const x = Math.cos(angle) * distance * sx, y = Math.sin(angle) * distance * sy;
    if (distance < 0 || radius < 0 || radius > 1000 || Math.abs(x) > 10000 || Math.abs(y) > 10000) throw new Error("security-limit");
    result.push({ type: effect.localName === "outerShdw" ? "DROP_SHADOW" : "INNER_SHADOW", color: paint.color, offset: { x, y }, radius });
    if (result.length > 4) throw new Error("security-limit");
  }
  if(result.length>4)throw new Error("security-limit");
  return result.length ? result : undefined;
}
