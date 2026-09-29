import type { BoundsIR } from "../../core/model";

/** Normalize our generated absolute M/L/C/Z paths to Figma's vector-local origin. */
export function graphicPath(data: string): { bounds: BoundsIR; pathData: string } {
  const tokens = data.match(/[MLCZ]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const commands: { op: string; points: number[] }[] = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (px: number, py: number) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error("invalid-file");
    minX = Math.min(minX, px); minY = Math.min(minY, py);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  };
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i++]!, count = op === "C" ? 6 : op === "Z" ? 0 : op === "M" || op === "L" ? 2 : -1;
    if (count < 0 || i + count > tokens.length) throw new Error("invalid-file");
    const points = tokens.slice(i, i + count).map(Number); i += count;
    commands.push({ op, points });
    if (op === "Z") { x = startX; y = startY; continue; }
    if (op === "C") {
      const [x1, y1, x2, y2, x3, y3] = points as [number, number, number, number, number, number];
      for (const t of [...extrema(x,x1,x2,x3), ...extrema(y,y1,y2,y3)]) include(cubic(x,x1,x2,x3,t), cubic(y,y1,y2,y3,t));
      x = x3; y = y3;
    } else { x = points[0]!; y = points[1]!; if (op === "M") { startX = x; startY = y; } }
    include(x, y);
  }
  if (!Number.isFinite(minX)) throw new Error("invalid-file");
  return {
    bounds: { x: minX, y: minY, width: maxX-minX, height: maxY-minY },
    pathData: commands.map(({ op, points }) => `${op}${points.length ? " " + points.map((n,i) => n - (i%2 ? minY : minX)).join(" ") : ""}`).join(" "),
  };
}
function cubic(a:number,b:number,c:number,d:number,t:number):number { const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d; }
function extrema(a:number,b:number,c:number,d:number):number[] {
  const q=-a+3*b-3*c+d, r=2*(a-2*b+c), s=b-a;
  if (Math.abs(q)<1e-12) return Math.abs(r)<1e-12?[]:[-s/r].filter(t=>t>0&&t<1);
  const discriminant=r*r-4*q*s;
  if(discriminant<0)return [];
  return [(-r+Math.sqrt(discriminant))/(2*q),(-r-Math.sqrt(discriminant))/(2*q)].filter(t=>t>0&&t<1);
}
