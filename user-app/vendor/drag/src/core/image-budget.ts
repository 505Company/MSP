import { SECURITY_LIMITS } from "./limits";

/** Read dimensions before native decoding; decoding still validates the complete image. */
function dimensions(bytes: Uint8Array, maxPixels:number, maxDimension:number): { width: number; height: number; format: "png" | "jpeg" } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, format: "png" | "jpeg";
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error("invalid-image");
    width = view.getUint32(16); height = view.getUint32(20); format = "png";
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    format = "jpeg";
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) throw new Error("invalid-image");
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) throw new Error("invalid-image");
      if (marker !== undefined && [0xc0,0xc1,0xc2].includes(marker)) {
        if (length < 8) throw new Error("invalid-image");
        height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
      }
      at += length;
    }
  } else throw new Error("unsupported-image");
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension || width * height > maxPixels) throw new Error("image-pixel-limit");
  return { width, height, format };
}

export function imageDimensions(bytes:Uint8Array){return dimensions(bytes,SECURITY_LIMITS.maxImagePixels,SECURITY_LIMITS.maxImageDimension);}
/** Bounded local PPTX decode only; these bytes must never be sent directly to Figma. */
export function pptxSourceDimensions(bytes:Uint8Array){return dimensions(bytes,SECURITY_LIMITS.maxPptxSourceImagePixels,SECURITY_LIMITS.maxImageDimension);}
