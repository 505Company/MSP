import { SECURITY_LIMITS } from "../../core/limits";

const MAX_HEADER_OFFSET = 1024;

export function validateLocalPdf(name: string, size: number, prefix?: Uint8Array): string | null {
  if (!name.toLocaleLowerCase("en-US").endsWith(".pdf")) return "Select a .pdf file.";
  if (!Number.isSafeInteger(size) || size < 1) return "Select a non-empty PDF file.";
  if (size > SECURITY_LIMITS.maxFileBytes) return "Select a PDF smaller than 400 MiB.";
  if (prefix) {
    const header = ascii(prefix.subarray(0, MAX_HEADER_OFFSET));
    const version = /%PDF-(\d\.\d)/.exec(header)?.[1];
    if (!version) return "This file does not have a valid PDF signature.";
    if (!new Set(["1.4", "1.5", "1.6", "1.7", "2.0"]).has(version)) {
      return "Export this document as PDF 1.4–2.0 and try again.";
    }
  }
  return null;
}

function ascii(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}
