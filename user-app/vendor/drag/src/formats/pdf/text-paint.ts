import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ColorIR, TextElementIR } from "../../core/model";

// Match Unicode content, not operator counts: PDF.js can merge several showText operations.
export function textPaintMatcher(fnArray: number[], argsArray: unknown[][]) {
  let state = { color: "#000000", alpha: 1, mode: 0 };
  const stack: typeof state[] = [];
  const characters: string[] = [];
  const paints: typeof state[] = [];
  const positions: number[] = [];
  for (let index = 0; index < fnArray.length; index++) {
    const op = fnArray[index];
    const args = argsArray[index] ?? [];
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) stack.push({ ...state });
    if (op === OPS.restore || op === OPS.paintFormXObjectEnd) state = stack.pop() ?? state;
    if (op === OPS.setFillRGBColor && typeof args[0] === "string") state.color = args[0];
    if (op === OPS.setTextRenderingMode && typeof args[0] === "number") state.mode = args[0];
    if (op === OPS.setGState && Array.isArray(args[0])) {
      for (const entry of args[0]) {
        if (Array.isArray(entry) && entry[0] === "ca" && typeof entry[1] === "number" && entry[1] >= 0 && entry[1] <= 1) state.alpha = entry[1];
      }
    }
    if (op !== OPS.showText || !Array.isArray(args[0])) continue;
    for (const glyph of args[0]) {
      if (!glyph || typeof glyph.unicode !== "string") continue;
      for (const character of glyph.unicode as string) {
        if (/\s/u.test(character)) continue;
        characters.push(character); paints.push({ ...state }); positions.push(index);
      }
    }
  }
  let cursor = 0;
  return (text: string): { runs: NonNullable<TextElementIR["colorRuns"]>; zIndex: number; operatorIndexes: number[]; invisible: boolean; unsupportedMode: boolean } | undefined => {
    const entries: { character: string; start: number; end: number }[] = [];
    let offset = 0;
    for (const character of text) {
      if (!/\s/u.test(character)) entries.push({ character, start: offset, end: offset + character.length });
      offset += character.length;
    }
    if (!entries.length || entries.some((entry, index) => entry.character !== characters[cursor + index])) return undefined;
    const runs: NonNullable<TextElementIR["colorRuns"]> = [];
    let lastPaint: string | undefined;
    let invisible = true;
    let unsupportedMode = false;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const paint = paints[cursor + index]!;
      const alpha = paint.mode === 3 || paint.mode === 7 ? 0 : paint.alpha;
      if (alpha > 0) invisible = false;
      if (paint.mode !== 0 && paint.mode !== 3) unsupportedMode = true;
      const paintKey = `${paint.color}:${alpha}`;
      if (lastPaint === paintKey) runs[runs.length - 1]!.end = entry.end;
      else {
        if (runs.length) runs[runs.length - 1]!.end = entry.start;
        runs.push({ start: runs.length ? entry.start : 0, end: entry.end, fill: { type: "solid", color: { ...rgb(paint.color), a: alpha } } });
        lastPaint = paintKey;
      }
    }
    runs[runs.length - 1]!.end = text.length;
    const zIndex = positions[cursor]!;
    const operatorIndexes=[...new Set(positions.slice(cursor,cursor+entries.length))];
    cursor += entries.length;
    return { runs, zIndex, operatorIndexes, invisible, unsupportedMode };
  };
}

function rgb(hex: string): ColorIR {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0;
  return { r: (value >>> 16) / 255, g: ((value >>> 8) & 255) / 255, b: (value & 255) / 255, a: 1 };
}
