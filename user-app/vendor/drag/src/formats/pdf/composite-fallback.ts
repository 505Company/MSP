import { OPS, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BoundsIR, ElementIR } from "../../core/model";
import { SECURITY_LIMITS } from "../../core/limits";
import { comparisonSize } from "../../core/visual-comparison";

const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
  OPS.paintSolidColorImageMask, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat,
  OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup]);
const hardOps = new Set<number>([OPS.beginGroup, OPS.setFillColorN, OPS.setStrokeColorN, OPS.shadingFill,
  OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup]);

export function needsComposite(fn: number[], args: unknown[][]): boolean {
  let clip = false;
  let clipped = false;
  const stack: boolean[] = [];
  return fn.some((op, i) => {
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) stack.push(clipped);
    if (op === OPS.restore || op === OPS.paintFormXObjectEnd) clipped = stack.pop() ?? clipped;
    if (op === OPS.showText && clipped) return true;
    if (hardOps.has(op)) return true;
    if (op === OPS.setTextRenderingMode && args[i]?.[0] !== 0 && args[i]?.[0] !== 3) return true;
    if (op === OPS.clip || op === OPS.eoClip) { clip = true; clipped = true; }
    if (op === OPS.constructPath && clip) { clip = false; if (args[i]?.[0] !== OPS.endPath) return true; }
    if (op === OPS.setGState) {
      const entries = args[i]?.[0];
      return !Array.isArray(entries) || entries.some((e) => !Array.isArray(e) ||
        (e[0] === "BM" && e[1] !== "source-over") || (e[0] === "SMask" && e[1] !== false) ||
        !["BM", "SMask", "ca", "CA", "LW", "LC", "LJ", "ML", "D"].includes(e[0]));
    }
    return false;
  });
}

/** Used only on pages that cannot use the isolated renderer. */
export function compositePaints(fn: number[], args: unknown[][], mapped: Set<number>): Set<number> {
  let state = { effects: false, clipped: false, textMode: 0, form: false };
  const stack: typeof state[] = [];
  const paints = new Set<number>();
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i]!, values = args[i] ?? [];
    if (op === OPS.save || op === OPS.paintFormXObjectBegin || op === OPS.beginGroup) {
      stack.push({ ...state });
      if (stack.length > 256) throw new Error("composite-state-limit");
      if (op !== OPS.save) state.form = true;
    }
    if (op === OPS.restore || op === OPS.paintFormXObjectEnd || op === OPS.endGroup) state = stack.pop() ?? state;
    if (op === OPS.clip || op === OPS.eoClip) state.clipped = true;
    if ([OPS.setGState, OPS.setDash, OPS.setLineCap, OPS.setLineJoin, OPS.setMiterLimit, OPS.setFillColorN, OPS.setStrokeColorN].includes(op)) state.effects = true;
    if (op === OPS.setTextRenderingMode) state.textMode = Number(values[0]);
    const path = op === OPS.constructPath && values[0] !== OPS.endPath;
    const text = op === OPS.showText;
    if (path || text || imageOps.has(op) || op === OPS.shadingFill) {
      if (state.effects || state.clipped || state.form || (text && state.textMode !== 0 && state.textMode !== 3) || (!text && !mapped.has(i))) paints.add(i);
      if (text && state.textMode >= 4) state.clipped = true;
    }
  }
  return paints;
}

interface BBoxReader {
  length: number; isEmpty(i: number): boolean;
  minX(i: number): number; minY(i: number): number; maxX(i: number): number; maxY(i: number): number;
}

/** getOperatorList disables PDF.js queue optimization; render does not. Never
 * apply source operation indexes to a shorter, grouped rendering list. */
export async function hasAlignedRenderOperations(page: PDFPageProxy, count: number, signal?: AbortSignal): Promise<boolean> {
  const viewport = page.getViewport({scale: 96 / 72});
  const size = comparisonSize(viewport.width, viewport.height);
  const canvas = document.createElement('canvas');
  try {
    canvas.width=size.width; canvas.height=size.height;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('canvas-unavailable');
    page.recordedBBoxes=null;
    await controlledRender(page,{canvas,canvasContext:context,viewport,transform:[size.width/viewport.width,0,0,size.height/viewport.height,0,0],recordOperations:true},signal);
    return page.recordedBBoxes !== null && (page.recordedBBoxes as BBoxReader).length===count;
  } finally {page.recordedBBoxes=null;canvas.width=0;canvas.height=0;}
}

export async function measureCompositeRegions(page: PDFPageProxy, indexes: Set<number>, elements: ElementIR[], signal?: AbortSignal, byPaint?: Map<number, BoundsIR>): Promise<BoundsIR[]> {
  const viewport = page.getViewport({ scale: 96 / 72 });
  const size = comparisonSize(viewport.width, viewport.height);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");
    page.recordedBBoxes = null;
    await controlledRender(page, { canvas, canvasContext: context, viewport,
      transform: [size.width / viewport.width, 0, 0, size.height / viewport.height, 0, 0], recordOperations: true }, signal);
    const boxes = page.recordedBBoxes as BBoxReader | null;
    if (!boxes || typeof boxes.isEmpty !== "function" || typeof boxes.minX !== "function") throw new Error("composite-bounds-unavailable");
    const regions: BoundsIR[] = [];
    for (const i of indexes) {
      if (i >= boxes.length) throw new Error("composite-bounds-unavailable");
      if (boxes.isEmpty(i)) continue;
      // PDF.js 6 records conservative normalized bounds quantized to 1/256.
      // Add another bin and one render pixel on every side for edge coverage.
      const padX = viewport.width / 256 + viewport.width / size.width;
      const padY = viewport.height / 256 + viewport.height / size.height;
      const x = Math.max(0, Math.floor(boxes.minX(i) * viewport.width - padX));
      const y = Math.max(0, Math.floor(boxes.minY(i) * viewport.height - padY));
      const right = Math.min(viewport.width, Math.ceil(boxes.maxX(i) * viewport.width + padX));
      const bottom = Math.min(viewport.height, Math.ceil(boxes.maxY(i) * viewport.height + padY));
      if (![x, y, right, bottom].every(Number.isFinite)) throw new Error("composite-bounds-unavailable");
      if (right > x && bottom > y) { const bounds = { x, y, width: right - x, height: bottom - y }; regions.push(bounds); byPaint?.set(i, bounds); }
    }
    // Also cover any erroneous reconstruction that will be removed, including
    // rotated text. This prevents stale fragments outside the source paint box.
    for (const element of elements) if (indexes.has(element.zIndex)) {
      const a = element.rotation * Math.PI / 180, b = element.bounds;
      const points = [[0, 0], [b.width, 0], [0, b.height], [b.width, b.height]].map(([x, y]) => [b.x + x! * Math.cos(a) - y! * Math.sin(a), b.y + x! * Math.sin(a) + y! * Math.cos(a)]);
      const x = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0]!))));
      const y = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]!))));
      const right = Math.min(viewport.width, Math.ceil(Math.max(...points.map((p) => p[0]!))));
      const bottom = Math.min(viewport.height, Math.ceil(Math.max(...points.map((p) => p[1]!))));
      if (right > x && bottom > y) regions.push({ x, y, width: right - x, height: bottom - y });
    }
    return byPaint ? regions : mergeRegions(regions);
  } finally { page.recordedBBoxes = null; canvas.width = 0; canvas.height = 0; }
}

export function mergeRegions(input: BoundsIR[]): BoundsIR[] {
  const regions: BoundsIR[] = [];
  for (const candidate of input) {
    let box = { ...candidate };
    for (let i = 0; i < regions.length;) {
      const other = regions[i]!;
      if (box.x <= other.x + other.width && other.x <= box.x + box.width && box.y <= other.y + other.height && other.y <= box.y + box.height) {
        const x = Math.min(box.x, other.x), y = Math.min(box.y, other.y);
        box = { x, y, width: Math.max(box.x + box.width, other.x + other.width) - x, height: Math.max(box.y + box.height, other.y + other.height) - y };
        regions.splice(i, 1); i = 0;
      } else i++;
    }
    regions.push(box);
    if (regions.length > SECURITY_LIMITS.maxRasterRegions) throw new Error("raster-region-limit");
  }
  return regions;
}

export function compositeTiles(regions: BoundsIR[]): BoundsIR[] {
  const tiles: BoundsIR[] = [];
  for (const b of regions) {
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) throw new Error("composite-bounds-unavailable");
    const width=Math.ceil(b.width*2),height=Math.ceil(b.height*2);
    if(width<=SECURITY_LIMITS.maxImageDimension&&height<=SECURITY_LIMITS.maxImageDimension&&width*height<=SECURITY_LIMITS.maxImagePixels){
      tiles.push({...b});if(tiles.length>SECURITY_LIMITS.maxRasterRegions)throw new Error('raster-region-limit');continue;
    }
    for (let y = b.y; y < b.y + b.height; y += 1000) for (let x = b.x; x < b.x + b.width; x += 1000) {
      tiles.push({ x, y, width: Math.min(1000, b.x + b.width - x), height: Math.min(1000, b.y + b.height - y) });
      if (tiles.length > SECURITY_LIMITS.maxRasterRegions) throw new Error("raster-region-limit");
    }
  }
  return tiles;
}

export async function renderCompositeTile(page: PDFPageProxy, bounds: BoundsIR, signal?: AbortSignal, prefix?: { fn: number[]; end: number; exclude?: Set<number>; only?: Set<number>; clips?: Set<number> }): Promise<Uint8Array> {
  const width = Math.ceil(bounds.width * 2), height = Math.ceil(bounds.height * 2);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > SECURITY_LIMITS.maxImagePixels || Math.max(width, height) > SECURITY_LIMITS.maxImageDimension) throw new Error("image-pixel-limit");
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");
    // Replay the complete source backdrop up to the last affected paint. Keep
    // closing state/group operations, but leave later paints editable above it.
    await controlledRender(page, { canvas: null, canvasContext: context, viewport: page.getViewport({ scale: 96 / 72 * 2 }),
      transform: [1, 0, 0, 1, -bounds.x * 2, -bounds.y * 2], background: prefix?.only ? "rgba(0,0,0,0)" : "white",
      ...(prefix ? { operationsFilter: (index: number) => !prefix.exclude?.has(index) && (prefix.only ? (prefix.only.has(index) || prefix.clips?.has(index) || !isPaint(prefix.fn[index]!)) : (index <= prefix.end || !isPaint(prefix.fn[index]!))) } : {}) }, signal);
    return Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]!), (c) => c.charCodeAt(0));
  } finally { canvas.width = 0; canvas.height = 0; }
}

function isPaint(op: number): boolean {
  return imageOps.has(op) || op === OPS.constructPath || op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText || op === OPS.shadingFill;
}

async function controlledRender(page: PDFPageProxy, options: Parameters<PDFPageProxy["render"]>[0], signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const task = page.render(options);
  const cancel = () => task.cancel();
  let expired = false;
  const timer = setTimeout(() => { expired = true; cancel(); }, SECURITY_LIMITS.maxRasterRenderMs);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try { await task.promise; if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); }
  catch (error) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (expired) throw new Error("raster-render-timeout");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}
