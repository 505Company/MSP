import type { SolidPaintIR } from "../../core/model";
import { PptxCatalogReader, OFFICE_REL, PRESENTATION as P, DRAWING as A } from "./catalog";
import { PptxError } from "./package";

export const child = (e: Element | undefined, name: string, ns = A): Element | undefined => e && Array.from(e.children).find(c => c.localName === name && c.namespaceURI === ns);
export const kids = (e: Element | undefined, ns = A): Element[] => e ? Array.from(e.children).filter(c => c.namespaceURI === ns) : [];
export const path = (e: Element | undefined, ...names: string[]): Element | undefined => names.reduce<Element | undefined>((at, name) => child(at, name), e);
export function number(e: Element | undefined, attr: string, fallback: number): number {
  const text = e?.getAttribute(attr);
  if (text === null || text === undefined) return fallback;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new PptxError("invalid-file", "Invalid PPTX numeric property");
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new PptxError("invalid-file", "Invalid PPTX numeric property");
  return value;
}
export const enabled = (e: Element | undefined, attr: string, fallback = false) => e?.hasAttribute(attr) ? ["1", "true"].includes(e.getAttribute(attr)!) : fallback;
export const shapeTree = (root: Element | undefined) => child(child(root, "cSld", P), "spTree", P);
export const placeholder = (shape: Element | undefined) => {
  if (!shape) return undefined;
  const nv = kids(shape, P).find(c => c.localName.startsWith("nv"));
  return child(child(nv, "nvPr", P), "ph", P);
};
export const properties = (shape: Element | undefined) => child(shape, "spPr", P);
export const textBody = (shape: Element | undefined) => child(shape, "txBody", P);

export interface SlideAppearance {
  slide: Element; slidePart: string;
  layout?: Element; layoutPart?: string;
  master?: Element; masterPart?: string;
  theme?: Element;
  defaultText?: Element;
  colorMap: Record<string, string>;
}

export function appearance(reader: PptxCatalogReader, slidePart: string): SlideAppearance {
  const slide = reader.xml(slidePart, P, "sld");
  const related = (source: string, kind: string) => {
    const matches = [...reader.relationships(source).values()].filter(r => r.type === `${OFFICE_REL}/${kind}`);
    if (matches.length > 1) throw new PptxError("invalid-file", "Ambiguous PPTX inheritance");
    return matches[0]?.target;
  };
  const layoutPart = related(slidePart, "slideLayout");
  const layout = layoutPart ? reader.xml(layoutPart, P, "sldLayout") : undefined;
  const masterPart = layoutPart ? related(layoutPart, "slideMaster") : undefined;
  const master = masterPart ? reader.xml(masterPart, P, "sldMaster") : undefined;
  const themePart = masterPart ? related(masterPart, "theme") : related(reader.presentationPart(), "theme");
  const theme = themePart ? reader.xml(themePart, A, "theme") : undefined;
  const presentation = reader.xml(reader.presentationPart(), P, "presentation");
  const defaultText = child(presentation, "defaultTextStyle", P);
  const colorMap: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  const masterMap = child(master, "clrMap", P);
  if (masterMap) for (const attr of Array.from(masterMap.attributes)) colorMap[attr.localName] = attr.value;
  const baseMap = { ...colorMap };
  for (const root of [layout, slide]) {
    const override = child(root, "clrMapOvr", P);
    if (child(override, "masterClrMapping")) Object.assign(colorMap, baseMap);
    const map = child(override, "overrideClrMapping");
    if (map) for (const attr of Array.from(map.attributes)) colorMap[attr.localName] = attr.value;
  }
  return { slide, slidePart, colorMap, ...(layout && layoutPart ? { layout, layoutPart } : {}), ...(master && masterPart ? { master, masterPart } : {}), ...(theme ? { theme } : {}), ...(defaultText ? { defaultText } : {}) };
}

/** Resolve properties per placeholder; never merge unrelated shapes on a master. */
export function shapeLayers(shape: Element, context: SlideAppearance): Element[] {
  const ph = placeholder(shape);
  if (!ph) return [shape];
  const idx = ph.getAttribute("idx") ?? "0";
  const layout = kids(shapeTree(context.layout), P).find(s => placeholder(s) && (placeholder(s)!.getAttribute("idx") ?? "0") === idx);
  const type = placeholder(layout)?.getAttribute("type") ?? ph.getAttribute("type") ?? "obj";
  const category = (value: string) => value === "ctrTitle" ? "title" : ["obj", "subTitle"].includes(value) ? "body" : value;
  const master = kids(shapeTree(context.master), P).find(s => category(placeholder(s)?.getAttribute("type") ?? "obj") === category(type) && placeholder(s));
  return [master, layout, shape].filter((s): s is Element => Boolean(s));
}

export function themeFont(name: string, context: SlideAppearance): string {
  if (!name.startsWith("+")) return name;
  const branch = name.startsWith("+mj") ? "majorFont" : "minorFont";
  const font = path(context.theme, "themeElements", "fontScheme", branch, "latin")?.getAttribute("typeface");
  return font || "Arial";
}

export function color(element: Element | undefined, context: SlideAppearance, warn: () => void, phColor?: SolidPaintIR): SolidPaintIR | undefined {
  if (!element) return undefined;
  let hex: string | undefined;
  if (element.localName === "srgbClr") hex = element.getAttribute("val") ?? undefined;
  else if (element.localName === "sysClr") hex = element.getAttribute("lastClr") ?? undefined;
  else if (element.localName === "schemeClr") {
    const key = element.getAttribute("val") ?? "";
    if (key === "phClr") {
      if (!phColor) { warn(); return undefined; }
      return transformColor(phColor, element, warn);
    }
    const entry = child(path(context.theme, "themeElements", "clrScheme"), context.colorMap[key] ?? key);
    const source = kids(entry)[0];
    if (source?.localName === "srgbClr") hex = source.getAttribute("val") ?? undefined;
    else if (source?.localName === "sysClr") hex = source.getAttribute("lastClr") ?? undefined;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) { warn(); return undefined; }
  const channels = [0, 2, 4].map(i => parseInt(hex!.slice(i, i + 2), 16) / 255);
  return transformColor({ type: "solid", color: { r: channels[0]!, g: channels[1]!, b: channels[2]!, a: 1 } }, element, warn);
}
function transformColor(base: SolidPaintIR, element: Element, warn: () => void): SolidPaintIR {
  const c = { ...base.color };
  for (const transform of kids(element)) {
    const value = number(transform, "val", 100000) / 100000;
    if (transform.localName === "alpha") c.a = value;
    else if (transform.localName === "alphaMod") c.a *= value;
    else if (transform.localName === "alphaOff") c.a += value;
    else if (transform.localName === "tint" || transform.localName === "shade") {
      for (const key of ["r", "g", "b"] as const) c[key] = transform.localName === "tint" ? c[key] * value + (1 - value) : c[key] * value;
    } else if (transform.localName === "lumMod" || transform.localName === "lumOff") {
      // DrawingML luminance transformations operate in HSL, not directly on RGB.
      const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), delta = max - min, light = (max + min) / 2;
      const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
      let hue = delta === 0 ? 0 : max === c.r ? ((c.g - c.b) / delta + 6) % 6 : max === c.g ? (c.b - c.r) / delta + 2 : (c.r - c.g) / delta + 4;
      const l = clamp(transform.localName === "lumMod" ? light * value : light + value);
      const chroma = (1 - Math.abs(2 * l - 1)) * saturation, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = l - chroma / 2;
      const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
      c.r = rgb[0]! + m; c.g = rgb[1]! + m; c.b = rgb[2]! + m;
    } else warn();
  }
  return { type: "solid", color: { r: clamp(c.r), g: clamp(c.g), b: clamp(c.b), a: clamp(c.a) } };
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function fill(container: Element | undefined, context: SlideAppearance, warn: () => void, phColor?: SolidPaintIR): SolidPaintIR | undefined {
  const paint = kids(container).find(c => ["solidFill", "noFill", "gradFill", "blipFill", "pattFill", "grpFill"].includes(c.localName));
  if (!paint || paint.localName === "noFill") return undefined;
  if (paint.localName !== "solidFill") { warn(); return undefined; }
  return color(kids(paint)[0], context, warn, phColor);
}
export function hasFill(container: Element | undefined): boolean { return kids(container).some(c => /Fill$/.test(c.localName)); }
export function referenceStyle(shape: Element | undefined, kind: "fill" | "ln", context: SlideAppearance, warn: () => void): { element?: Element; phColor?: SolidPaintIR } {
  const reference = child(child(shape, "style", P), `${kind}Ref`);
  if (!reference) return {};
  const idx = number(reference, "idx", 0);
  if (!idx) return {};
  const list = path(context.theme, "themeElements", "fmtScheme", kind === "ln" ? "lnStyleLst" : idx >= 1001 ? "bgFillStyleLst" : "fillStyleLst");
  const element = kids(list)[idx >= 1001 ? idx - 1001 : idx - 1];
  if (!element) { warn(); return {}; }
  const phColor = color(kids(reference)[0], context, warn);
  return { element, ...(phColor ? { phColor } : {}) };
}
