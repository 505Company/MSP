import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SECURITY_LIMITS } from "../../core/limits";

/** Preview dimensions are bounded on BOTH axes, including extreme page aspect ratios. */
export function previewSize(width: number, height: number, maxEdge = 180) {
  if (![width, height, maxEdge].every((n) => Number.isFinite(n) && n > 0) || maxEdge > 1024) {
    throw new Error("page-dimension-limit");
  }
  const scale = Math.min(1, maxEdge / width, maxEdge / height);
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
}

export async function renderPreviewPng(page: PDFPageProxy, maxEdge: number, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const viewport = page.getViewport({ scale: 96 / 72 });
  const size = previewSize(viewport.width, viewport.height, maxEdge);
  const canvas = document.createElement("canvas");
  let task: ReturnType<PDFPageProxy["render"]> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const cancel = () => task?.cancel();
  try {
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("canvas-unavailable");
    task = page.render({ canvas: null, canvasContext: context, viewport, background: "white",
      transform: [size.width / viewport.width, 0, 0, size.height / viewport.height, 0, 0] });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    timeout = setTimeout(() => { expired = true; cancel(); }, SECURITY_LIMITS.maxRasterRenderMs);
    await task.promise;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return canvas.toDataURL("image/png");
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (expired) throw new Error("raster-render-timeout");
    throw error;
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", cancel);
    canvas.width = 0; canvas.height = 0;
  }
}
