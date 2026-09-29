export interface SourceAsset { id: string; bytes: Uint8Array; mime: string; extension: string; origins: string[] }
export interface SourceElement { id: string; slide: number; kind: string; name: string; properties: Record<string, unknown>; parentId?: string }
export interface SourceSnapshot {
  schemaVersion: 1; sourceId: string; name: string; slideCount: number;
  slides: { id: string; number: number; width: number; height: number; part: string; text: string; warnings: string[] }[];
  elements: SourceElement[];
  assets: { id: string; mime: string; byteLength: number; origins: string[] }[];
  colors: { hex: string; occurrences: number }[];
  fonts: { family: string; sizes: number[]; occurrences: number }[];
  limitations: string[];
}

export type VisualPackage = { renderer: 'drag-checkpoint-2026-09-24' | 'msp-web-2026-09-25' | 'msp-web-2026-09-29'; previewKind: 'reconstruction'; snapshot: SourceSnapshot; assets: Array<Omit<SourceAsset, 'bytes'> & { base64: string }>; previews: Array<{ id: string; dataUrl: string }>; sheets: Array<{ ids: string[]; dataUrl: string }> }

export type PreparedPresentation = Omit<VisualPackage, 'assets'> & { assets: SourceAsset[] }
