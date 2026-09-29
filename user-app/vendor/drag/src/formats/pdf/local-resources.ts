declare const __PDF_LOCAL_RESOURCES__: Record<string, string>;

/** PDF.js 6 BinaryDataFactory contract. Never delegates to fetch or a URL. */
export class LocalPdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (!["cMapUrl", "standardFontDataUrl"].includes(kind) || typeof filename !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(filename)) throw new Error("pdf-resource-unavailable");
    const data = typeof __PDF_LOCAL_RESOURCES__ === "undefined" ? {} : __PDF_LOCAL_RESOURCES__;
    const key = `${kind}/${filename}`;
    if (!Object.prototype.hasOwnProperty.call(data, key)) throw new Error("pdf-resource-unavailable");
    return Uint8Array.from(atob(data[key]!), (character) => character.charCodeAt(0));
  }
}
