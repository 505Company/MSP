import type { ShapeElementIR } from "../../core/model";
import { child, kids, number } from "./appearance";

/** Width-relative dashes; system presets are reconstructed and disclosed. */
export function lineStyle(line: Element | undefined, width: number, warn: () => void): Partial<NonNullable<ShapeElementIR["stroke"]>> {
  if (!line) return {};
  const result: Partial<NonNullable<ShapeElementIR["stroke"]>> = {};
  const cap = line.getAttribute("cap");
  if (cap) { if (!["flat", "rnd", "sq"].includes(cap)) warn(); else result.cap = cap === "rnd" ? "ROUND" : cap === "sq" ? "SQUARE" : "NONE"; }
  const join = kids(line).find(e => ["round", "bevel", "miter"].includes(e.localName));
  if (join) { result.join = join.localName === "round" ? "ROUND" : join.localName === "bevel" ? "BEVEL" : "MITER"; if (join.hasAttribute("lim")) warn(); }
  const custom = child(line, "custDash"), preset = child(line, "prstDash")?.getAttribute("val");
  if (custom && preset) throw new Error("invalid-file");
  if (custom) {
    const stops = kids(custom);
    if (!stops.length || stops.length > 32) throw new Error("security-limit");
    result.dash = stops.flatMap(stop => {
      if (stop.localName !== "ds") throw new Error("invalid-file");
      return ["d", "sp"].map(key => {
        const value = number(stop, key, -1) / 100000 * width;
        if (value <= 0 || value > 10000) throw new Error("security-limit");
        return value;
      });
    });
  } else if (preset && preset !== "solid") {
    const patterns: Record<string, number[]> = { dot:[1,3], dash:[4,3], lgDash:[8,3], dashDot:[4,3,1,3], lgDashDot:[8,3,1,3], lgDashDotDot:[8,3,1,3,1,3], sysDash:[3,1], sysDot:[1,1], sysDashDot:[3,1,1,1], sysDashDotDot:[3,1,1,1,1,1] };
    if (Object.hasOwn(patterns,preset)) result.dash = patterns[preset]!.map(n => n * width);
    // Preset lengths are renderer-dependent, so disclose the reconstruction.
    warn();
  }
  if (kids(line).some(e => ["headEnd","tailEnd"].includes(e.localName) && (e.getAttribute("type") ?? "none") !== "none")) warn();
  if (line.getAttribute("cmpd") && line.getAttribute("cmpd") !== "sng" || line.getAttribute("algn") === "in") warn();
  return result;
}
