export const COMPARISON_MAX_EDGE = 1024;
export const COMPARISON_MAX_BYTES = 8 * 1024 * 1024;
export interface ComparisonMetrics {
  algorithm: "rgba-white-v1";
  width: number;
  height: number;
  threshold: 16;
  changedPixelPercent: number;
  meanChannelError: number;
}
export interface PixelBuffer { width: number; height: number; data: Uint8ClampedArray }

export function comparisonSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) throw new Error("comparison-dimensions");
  const scale = Math.min(1, COMPARISON_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function comparePixels(source: PixelBuffer, imported: PixelBuffer): ComparisonMetrics {
  const { width, height } = source;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= COMPARISON_MAX_EDGE) || imported.width !== width || imported.height !== height || source.data.length !== width * height * 4 || imported.data.length !== source.data.length) throw new Error("comparison-dimensions");
  let changed = 0, error = 0;
  for (let i = 0; i < source.data.length; i += 4) {
    let largest = 0;
    for (let channel = 0; channel < 3; channel++) {
      const a = 255 + (source.data[i + channel]! - 255) * source.data[i + 3]! / 255;
      const b = 255 + (imported.data[i + channel]! - 255) * imported.data[i + 3]! / 255;
      const delta = Math.abs(a - b);
      error += delta; largest = Math.max(largest, delta);
    }
    if (largest > 16) changed++;
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { algorithm: "rgba-white-v1", width, height, threshold: 16, changedPixelPercent: round(changed / (width * height) * 100), meanChannelError: round(error / (width * height * 3)) };
}

// Validate before browser image decoding; do not trust a message's byte budget alone.
export function validateComparisonPng(bytes: Uint8Array, width: number, height: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > COMPARISON_MAX_BYTES || ![137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) throw new Error("comparison-image");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error("comparison-image");
  const w = view.getUint32(16), h = view.getUint32(20);
  if (w < 1 || h < 1 || w > COMPARISON_MAX_EDGE + 1 || h > COMPARISON_MAX_EDGE + 1 || Math.abs(w - width) > 1 || Math.abs(h - height) > 1) throw new Error("comparison-dimensions");
}
