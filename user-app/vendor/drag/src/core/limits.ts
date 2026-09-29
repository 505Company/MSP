export const SECURITY_LIMITS = Object.freeze({
  maxFileBytes: 400 * 1024 * 1024,
  maxPages: 300,
  maxNodesPerPage: 20_000,
  maxBatchPages: 25,
  maxPptxSourceImagePixels: 8_000_000,
  maxImagePixels: 4_000_000,
  maxImageDimension: 4096,
  maxPageAssetBytes: 16 * 1024 * 1024,
  maxRasterRegions: 64,
  maxRasterRenderMs: 15_000,
  maxElementDepth: 32,
  maxPageOperators: 200_000,
  maxPageDimension: 100_000,
});

export type LimitViolation = "file-bytes" | "pages" | "nodes-per-page";

export function findLimitViolation(input: {
  fileBytes: number;
  pages: number;
  nodesOnPage?: number;
}): LimitViolation | null {
  if (!Number.isSafeInteger(input.fileBytes) || input.fileBytes < 0 || input.fileBytes > SECURITY_LIMITS.maxFileBytes) {
    return "file-bytes";
  }
  if (!Number.isSafeInteger(input.pages) || input.pages < 1 || input.pages > SECURITY_LIMITS.maxPages) {
    return "pages";
  }
  if (
    input.nodesOnPage !== undefined &&
    (!Number.isSafeInteger(input.nodesOnPage) || input.nodesOnPage < 0 || input.nodesOnPage > SECURITY_LIMITS.maxNodesPerPage)
  ) {
    return "nodes-per-page";
  }
  return null;
}
