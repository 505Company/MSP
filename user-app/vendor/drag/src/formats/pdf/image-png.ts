import { zlibSync } from "fflate";
import { SECURITY_LIMITS } from "../../core/limits";

// Bounded RGB/RGBA decoder output → portable PNG, without browser canvas APIs.
export function encodeImagePng(width: number, height: number, data: Uint8Array | Uint8ClampedArray, channels: 3 | 4): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > SECURITY_LIMITS.maxImageDimension || height > SECURITY_LIMITS.maxImageDimension || width * height > SECURITY_LIMITS.maxImagePixels) throw new Error("image-pixel-limit");
  if (data.length !== width * height * channels) throw new Error("invalid-image-data");
  const rows = new Uint8Array(height * (width * channels + 1));
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * channels, (y + 1) * width * channels), y * (width * channels + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = channels === 4 ? 6 : 2;
  const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlibSync(rows)), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of chunks) { result.set(value, offset); offset += value.length; }
  return result;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(Uint8Array.from(type, character => character.charCodeAt(0)), 4); result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}
