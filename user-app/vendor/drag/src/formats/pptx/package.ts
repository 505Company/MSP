import { Inflate } from "fflate";
import { ARCHIVE_LIMITS, inspectArchiveIndex } from "../../core/archive-guard";
import { SECURITY_LIMITS } from "../../core/limits";

export class PptxError extends Error {
  constructor(readonly code: "invalid-file" | "unsupported-file" | "protected-file" | "security-limit", message: string) {
    super(message);
    this.name = "PptxError";
  }
}

interface Entry {
  name: string;
  compressedBytes: number;
  uncompressedBytes: number;
  start: number;
  crc: number;
  method: number;
}

/** Index first; decompress only requested parts, never the complete package. */
export class PptxPackage {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length > SECURITY_LIMITS.maxFileBytes) throw new PptxError("security-limit", "PPTX file budget exceeded");
    try { this.index(); } catch (error) {
      if (error instanceof PptxError) throw error;
      throw new PptxError("invalid-file", "Invalid PPTX archive");
    }
  }

  has(name: string): boolean { return this.entries.has(name); }
  names(): string[] { return [...this.entries.keys()]; }

  read(name: string, maxBytes = 16 * 1024 * 1024): Uint8Array {
    const entry = this.entries.get(name);
    if (!entry) throw new PptxError("invalid-file", "Missing PPTX part");
    if (entry.uncompressedBytes > maxBytes) throw new PptxError("security-limit", "PPTX part budget exceeded");
    const source = this.bytes.subarray(entry.start, entry.start + entry.compressedBytes);
    const output = new Uint8Array(entry.uncompressedBytes);
    let written = 0;
    const append = (chunk: Uint8Array) => {
      if (written + chunk.length > output.length) throw new PptxError("invalid-file", "PPTX expanded size mismatch");
      output.set(chunk, written);
      written += chunk.length;
    };
    try {
      if (entry.method === 0) append(source);
      else {
        // Small input chunks bound each synchronous inflate step, including forged sizes.
        const stream = new Inflate(append);
        if (!source.length) stream.push(source, true);
        for (let offset = 0; offset < source.length; offset += 1024) {
          stream.push(source.subarray(offset, offset + 1024), offset + 1024 >= source.length);
        }
      }
    } catch (error) {
      if (error instanceof PptxError) throw error;
      throw new PptxError("invalid-file", "Invalid PPTX compressed part");
    }
    if (written !== output.length || crc32(output) !== entry.crc) throw new PptxError("invalid-file", "PPTX part integrity mismatch");
    return output;
  }

  private index(): void {
    const bytes = this.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => view.getUint16(at, true);
    const u32 = (at: number) => view.getUint32(at, true);
    const invalid = () => new PptxError("invalid-file", "Invalid PPTX archive index");
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
    }
    if (end < 0) throw invalid();
    const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
    if (count === 65535 || start === 0xffffffff || size === 0xffffffff) {
      throw new PptxError("unsupported-file", "ZIP64 PPTX is not supported");
    }
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || start + size !== end) throw invalid();
    if (count > ARCHIVE_LIMITS.maxEntries) throw new PptxError("security-limit", "PPTX entry budget exceeded");
    let at = start;
    const spans: { start: number; end: number }[] = [];
    for (let index = 0; index < count; index++) {
      if (at + 46 > end || u32(at) !== 0x02014b50) throw invalid();
      const flags = u16(at + 8), method = u16(at + 10);
      if (flags & 0x41) throw new PptxError("protected-file", "Encrypted PPTX is not supported");
      if (method !== 0 && method !== 8) throw new PptxError("unsupported-file", "Unsupported PPTX compression");
      const nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32);
      const next = at + 46 + nameLength + extra + comment;
      if (next > end || u16(at + 34)) throw invalid();
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLength));
      if (!name || name.includes("\\") || name.includes("\0") || name.includes(":") || name.includes("%") || name.startsWith("/") || name.split("/").some(p => p === ".." || p === ".") || this.entries.has(name)) throw invalid();
      const local = u32(at + 42), compressedBytes = u32(at + 20), uncompressedBytes = u32(at + 24);
      if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) throw invalid();
      const data = local + 30 + u16(local + 26) + u16(local + 28);
      if (data > start || data + compressedBytes > start || u16(local + 26) !== nameLength) throw invalid();
      for (let n = 0; n < nameLength; n++) if (bytes[local + 30 + n] !== bytes[at + 46 + n]) throw invalid();
      if (!(flags & 8) && (u32(local + 14) !== u32(at + 16) || u32(local + 18) !== compressedBytes || u32(local + 22) !== uncompressedBytes)) throw invalid();
      this.entries.set(name, { name, compressedBytes, uncompressedBytes, start: data, crc: u32(at + 16), method });
      spans.push({ start: local, end: data + compressedBytes });
      at = next;
    }
    if (at !== end) throw invalid();
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) if (spans[i]!.start < spans[i - 1]!.end) throw invalid();
    try { inspectArchiveIndex([...this.entries.values()]); }
    catch { throw new PptxError("security-limit", "PPTX archive budget exceeded"); }
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
