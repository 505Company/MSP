import { OPS, Util, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BoundsIR } from "../../core/model";
import { SECURITY_LIMITS } from "../../core/limits";

export interface PathFallback { operatorIndex: number; bounds: BoundsIR; clipOperations?: number[]; image?: boolean; mask?: boolean; operatorEnd?: number }
const maskOps = new Set<number>([OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask]);
const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, ...maskOps]);
const strokeOps = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const fillOps = new Set<number>([OPS.fill, OPS.eoFill]);
const stateOps = new Set<number>([OPS.save, OPS.restore, OPS.transform, OPS.setLineWidth, OPS.setLineCap, OPS.setLineJoin, OPS.setMiterLimit, OPS.setDash, OPS.setStrokeRGBColor, OPS.setFillRGBColor, OPS.setGState, OPS.paintFormXObjectBegin, OPS.paintFormXObjectEnd]);
const textStateOps = new Set<number>([OPS.setFont, OPS.setCharSpacing, OPS.setWordSpacing, OPS.setHScale, OPS.setLeading, OPS.setTextRenderingMode, OPS.setTextRise]);

export function planPathFallbacks(fn: number[], args: unknown[][], mapped: Set<number>, viewport: { transform: number[]; width: number; height: number }): PathFallback[] {
  const blocked = [OPS.beginGroup, OPS.setFillColorN, OPS.setStrokeColorN];
  if (fn.some((op) => blocked.includes(op))) return [];
  for (let index = 0; index < fn.length; index++) {
    if (fn[index] !== OPS.setGState) continue;
    const entries = args[index]?.[0];
    if (!Array.isArray(entries) || !entries.every(isIsolatedGraphicsState)) return [];
  }
  const clipOperations: number[] = [];
  let pendingClip = false;
  for (let index = 0; index < fn.length; index++) {
    if (fn[index] === OPS.clip || fn[index] === OPS.eoClip) { pendingClip = true; clipOperations.push(index); }
    if (fn[index] === OPS.constructPath && pendingClip) {
      // A simultaneously painted clipping path needs a separate dependency pass.
      if (args[index]?.[0] !== OPS.endPath) return [];
      clipOperations.push(index); pendingClip = false;
    }
  }
  if (pendingClip) return [];
  const clipEnds = new Set(clipOperations.filter((index) => fn[index] === OPS.constructPath));
  let state = { matrix: [1, 0, 0, 1, 0, 0], width: 1, miter: 10, specialStroke: false, clipped: false, fillAlpha: 1, strokeAlpha: 1 };
  const stack: typeof state[] = [];
  const result: PathFallback[] = [];
  const forms: { start: number; bounds: BoundsIR }[] = [];
  for (let index = 0; index < fn.length; index++) {
    const op = fn[index]; const values = args[index] ?? [];
    if (op === OPS.paintFormXObjectBegin) {
      stack.push({ ...state, matrix: [...state.matrix] });
      if (values[0]) state.matrix = Util.transform(state.matrix, values[0] as number[]);
      const box = values[1] as number[] | undefined;
      if (!box || box.length !== 4 || !box.every(Number.isFinite)) return [];
      const matrix = Util.transform(viewport.transform, state.matrix);
      const points = [[box[0]!, box[1]!], [box[2]!, box[1]!], [box[0]!, box[3]!], [box[2]!, box[3]!]]
        .map(([x, y]) => [matrix[0]! * x! + matrix[2]! * y! + matrix[4]!, matrix[1]! * x! + matrix[3]! * y! + matrix[5]!]);
      const x = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0]!))));
      const y = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]!))));
      const right = Math.min(viewport.width, Math.ceil(Math.max(...points.map((p) => p[0]!))));
      const bottom = Math.min(viewport.height, Math.ceil(Math.max(...points.map((p) => p[1]!))));
      if (![x, y, right, bottom].every(Number.isFinite)) return [];
      forms.push({ start: index, bounds: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) } });
      if (forms.length > SECURITY_LIMITS.maxElementDepth) throw new Error("raster-region-limit");
      continue;
    }
    if (op === OPS.paintFormXObjectEnd) {
      const form = forms.pop();
      if (!form) return [];
      state = stack.pop() ?? state;
      if (!forms.length && form.bounds.width > 0 && form.bounds.height > 0) {
        result.push({ operatorIndex: form.start, operatorEnd: index, bounds: form.bounds, clipOperations });
        if (result.length > SECURITY_LIMITS.maxRasterRegions) throw new Error("raster-region-limit");
      }
      continue;
    }
    if (op === OPS.save) stack.push({ ...state, matrix: [...state.matrix] });
    if (op === OPS.restore) state = stack.pop() ?? state;
    if (op === OPS.transform) state.matrix = Util.transform(state.matrix, values as number[]);
    if (op === OPS.setLineWidth) state.width = Number(values[0]);
    if (op === OPS.setMiterLimit) { state.miter = Number(values[0]); state.specialStroke = true; }
    if (op === OPS.setDash || op === OPS.setLineCap || op === OPS.setLineJoin) state.specialStroke = true;
    if (op === OPS.setGState) {
      for (const [key, value] of values[0] as [string, unknown][]) {
        if (key === "ca") state.fillAlpha = value as number;
        if (key === "CA") state.strokeAlpha = value as number;
        if (key === "LW") { state.width = value as number; state.specialStroke = true; }
        if (key === "ML") { state.miter = value as number; state.specialStroke = true; }
        if (key === "D" || key === "LC" || key === "LJ") state.specialStroke = true;
      }
    }
    if (clipEnds.has(index)) state.clipped = true;
    if (forms.length) continue;
    const stroked = strokeOps.has(Number(values[0]));
    const filled = fillOps.has(Number(values[0])) || (stroked && Number(values[0]) !== OPS.stroke && Number(values[0]) !== OPS.closeStroke);
    const complexPaint = state.clipped || (stroked && (state.specialStroke || state.strokeAlpha !== 1)) || (filled && state.fillAlpha !== 1);
    const image = imageOps.has(op!);
    // Mapped images already carry supported rectangular clips. Unmapped images
    // include arbitrary clips and transforms; opacity must also be baked in.
    if (image ? mapped.has(index) && state.fillAlpha === 1 : op !== OPS.constructPath || (!stroked && !filled) || (mapped.has(index) && !complexPaint)) continue;
    const box = (image ? [0, 0, 1, 1] : values[2]) as ArrayLike<number> | null;
    if (!box || box.length !== 4) continue;
    const m = Util.transform(viewport.transform, state.matrix);
    const points = [[box[0]!, box[1]!], [box[2]!, box[1]!], [box[0]!, box[3]!], [box[2]!, box[3]!]].map(([x, y]) => [m[0]! * x! + m[2]! * y! + m[4]!, m[1]! * x! + m[3]! * y! + m[5]!]);
    const pad = !image && stroked ? Math.max(1, state.width * Math.max(1, state.miter) * Math.hypot(...m.slice(0, 4))) + 2 : 2;
    const x = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0]!)) - pad));
    const y = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]!)) - pad));
    const right = Math.min(viewport.width, Math.ceil(Math.max(...points.map((p) => p[0]!)) + pad));
    const bottom = Math.min(viewport.height, Math.ceil(Math.max(...points.map((p) => p[1]!)) + pad));
    if ([x, y, right, bottom].every(Number.isFinite) && right > x && bottom > y) result.push({ operatorIndex: index, bounds: { x, y, width: right - x, height: bottom - y }, clipOperations, ...(image ? { image: true } : {}), ...(maskOps.has(op!) ? { mask: true } : {}) });
    if (result.length > SECURITY_LIMITS.maxRasterRegions) throw new Error("raster-region-limit");
  }
  return forms.length ? [] : result;
}

function isIsolatedGraphicsState(entry: unknown): boolean {
  if (!Array.isArray(entry) || entry.length !== 2) return false;
  const [key, value] = entry;
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  switch (key) {
    case "ca": case "CA": return finite(value) && value >= 0 && value <= 1;
    case "LW": return finite(value) && value >= 0;
    case "ML": return finite(value) && value >= 1;
    case "LC": case "LJ": return Number.isInteger(value) && value >= 0 && value <= 2;
    case "D": return Array.isArray(value) && value.length === 2 && Array.isArray(value[0]) && value[0].length <= 1024 && value[0].every((n: unknown) => finite(n) && n >= 0) && (value[0].length === 0 || value[0].some((n: number) => n > 0)) && finite(value[1]);
    // PDF.js normalizes /Normal and /None to these values. Neither depends on a backdrop.
    case "BM": return value === "source-over";
    case "SMask": return value === false;
    default: return false;
  }
}

export async function renderPathFallback(page: PDFPageProxy, fn: number[], plan: PathFallback, signal?: AbortSignal, exclude?: Set<number>): Promise<Uint8Array> {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
  const scale = 2;
  const width = Math.ceil(plan.bounds.width * scale), height = Math.ceil(plan.bounds.height * scale);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > SECURITY_LIMITS.maxImageDimension || height > SECURITY_LIMITS.maxImageDimension || width * height > SECURITY_LIMITS.maxImagePixels) throw new Error("image-pixel-limit");
  const canvas = document.createElement("canvas");
  let task: ReturnType<PDFPageProxy["render"]> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const cancel = () => task?.cancel();
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");
    const clips = new Set(plan.clipOperations ?? []);
    task = page.render({ canvas: null, canvasContext: context, viewport: page.getViewport({ scale: 96 / 72 * scale }),
    transform: [1, 0, 0, 1, -plan.bounds.x * scale, -plan.bounds.y * scale], background: "rgba(0,0,0,0)",
    operationsFilter: (index) => !exclude?.has(index) && ((index >= plan.operatorIndex && index <= (plan.operatorEnd ?? plan.operatorIndex)) || fn[index] === OPS.dependency || stateOps.has(fn[index]!) || (plan.operatorEnd !== undefined && textStateOps.has(fn[index]!)) || clips.has(index)),
    });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    timeout = setTimeout(() => { expired = true; cancel(); }, SECURITY_LIMITS.maxRasterRenderMs);
    await task.promise;
    if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
    const encoded = canvas.toDataURL("image/png").split(",")[1]!;
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
    if (expired) throw new Error("raster-render-timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    canvas.width = 0; canvas.height = 0;
  }
}
