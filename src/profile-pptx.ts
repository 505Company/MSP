import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { Box, NormalizedElement, ProfileResult, SourceRef, TypographyObservation } from "./types.js";

const PROFILE_VERSION = "0.1.0";
const MIN_BOX_SIZE = 0.000001;
const supportedObjectKeys = ["p:sp", "p:pic", "p:graphicFrame", "p:grpSp", "p:cxnSp"] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => [
    "p:sp",
    "p:pic",
    "p:graphicFrame",
    "p:grpSp",
    "p:cxnSp",
    "a:p",
    "a:r",
    "a:fld"
  ].includes(name)
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

function firstChildObject(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object") return undefined;
  return node as Record<string, unknown>;
}

function walk(node: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visitor);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    visitor(key, value);
    walk(value, visitor);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function numberAttr(node: unknown, name: string): number | undefined {
  const value = attr(node, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBox(xfrm: unknown, slideWidth: number, slideHeight: number): { box: Box; warning?: string } {
  const record = firstChildObject(xfrm) ?? {};
  const off = record["a:off"];
  const ext = record["a:ext"];
  const rawX = numberAttr(off, "x");
  const rawY = numberAttr(off, "y");
  const rawWidth = numberAttr(ext, "cx");
  const rawHeight = numberAttr(ext, "cy");

  if (rawX === undefined || rawY === undefined || rawWidth === undefined || rawHeight === undefined) {
    return {
      box: { x: 0, y: 0, width: MIN_BOX_SIZE, height: MIN_BOX_SIZE },
      warning: "Object geometry is inherited or missing and was not resolved in V0."
    };
  }

  const x = clamp(rawX / slideWidth, 0, 1);
  const y = clamp(rawY / slideHeight, 0, 1);
  const width = clamp(rawWidth / slideWidth, MIN_BOX_SIZE, Math.max(MIN_BOX_SIZE, 1 - x));
  const height = clamp(rawHeight / slideHeight, MIN_BOX_SIZE, Math.max(MIN_BOX_SIZE, 1 - y));
  const clipped = rawX < 0 || rawY < 0 || rawX + rawWidth > slideWidth || rawY + rawHeight > slideHeight;

  return {
    box: { x, y, width, height },
    warning: clipped ? "Object geometry extends beyond the slide and was clamped in the normalized model." : undefined
  };
}

function nonVisualProperties(key: string, node: Record<string, unknown>): Record<string, unknown> {
  const nvKey = {
    "p:sp": "p:nvSpPr",
    "p:pic": "p:nvPicPr",
    "p:graphicFrame": "p:nvGraphicFramePr",
    "p:grpSp": "p:nvGrpSpPr",
    "p:cxnSp": "p:nvCxnSpPr"
  }[key];
  return firstChildObject(nvKey ? node[nvKey] : undefined) ?? {};
}

function coreProperties(nv: Record<string, unknown>): Record<string, unknown> {
  return firstChildObject(nv["p:cNvPr"]) ?? {};
}

function transformFor(key: string, node: Record<string, unknown>): unknown {
  if (key === "p:graphicFrame") return node["p:xfrm"];
  if (key === "p:grpSp") return firstChildObject(node["p:grpSpPr"])?.["a:xfrm"];
  return firstChildObject(node["p:spPr"])?.["a:xfrm"];
}

function placeholderType(nv: Record<string, unknown>): string | undefined {
  const nvPr = firstChildObject(nv["p:nvPr"]);
  return attr(nvPr?.["p:ph"], "type");
}

function detectKind(key: string, node: Record<string, unknown>): NormalizedElement["kind"] {
  if (key === "p:pic") return "image";
  if (key === "p:grpSp") return "group";
  if (key === "p:cxnSp") return "line";
  if (key === "p:graphicFrame") {
    const serialized = JSON.stringify(node);
    if (serialized.includes("/chart")) return "chart";
    if (serialized.includes("/table")) return "table";
    if (serialized.includes("/diagram")) return "smartArt";
    return "unknown";
  }
  if (key === "p:sp") return node["p:txBody"] ? "text" : "shape";
  return "unknown";
}

function collectText(node: unknown): string {
  const chunks: string[] = [];
  walk(node, (key, value) => {
    if (key !== "a:t") return;
    if (typeof value === "string" || typeof value === "number") chunks.push(String(value));
    else if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
      chunks.push(String((value as Record<string, unknown>)["#text"] ?? ""));
    }
  });
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function detectRole(
  kind: NormalizedElement["kind"],
  name: string,
  placeholder: string | undefined,
  box: Box,
  text: string
): NormalizedElement["semanticRole"] {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("logo") || lowerName.includes("логотип")) return "logo";
  if (placeholder === "title" || placeholder === "ctrTitle") return "title";
  if (placeholder === "subTitle") return "subtitle";
  if (placeholder === "body") return "body";
  if (placeholder === "pic" || kind === "image") return "image";
  if (kind === "line") return "divider";
  if (kind === "text") {
    if (box.y < 0.25 && box.height < 0.25 && text.length < 160) return "title";
    return "body";
  }
  if (kind === "shape" && box.width > 0.95 && box.height > 0.95) return "background";
  if (kind === "shape") return "decoration";
  return "unknown";
}

function collectColors(node: unknown, schemeColors: Map<string, string>): string[] {
  const colors = new Set<string>();
  walk(node, (key, value) => {
    if (key === "a:srgbClr") {
      const hex = attr(value, "val");
      if (hex && /^[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(hex)) colors.add(`#${hex.toUpperCase()}`);
    }
    if (key === "a:sysClr") {
      const hex = attr(value, "lastClr");
      if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) colors.add(`#${hex.toUpperCase()}`);
    }
    if (key === "a:schemeClr") {
      const scheme = attr(value, "val");
      const resolved = scheme ? schemeColors.get(scheme) : undefined;
      if (resolved) colors.add(resolved);
    }
  });
  return [...colors].sort();
}

function collectTypography(node: unknown): TypographyObservation[] {
  const observations = new Map<string, TypographyObservation>();
  walk(node, (key, value) => {
    if (!["a:rPr", "a:defRPr", "a:endParaRPr"].includes(key) || !value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const sizeRaw = numberAttr(record, "sz");
    if (!sizeRaw || sizeRaw <= 0) return;
    const latin = firstChildObject(record["a:latin"]);
    const eastAsian = firstChildObject(record["a:ea"]);
    const complexScript = firstChildObject(record["a:cs"]);
    const fontFamily = attr(latin, "typeface") ?? attr(eastAsian, "typeface") ?? attr(complexScript, "typeface") ?? "(inherited)";
    const observation: TypographyObservation = {
      fontFamily,
      fontSizePt: sizeRaw / 100,
      fontWeight: attr(record, "b") === "1" ? 700 : 400,
      italic: attr(record, "i") === "1"
    };
    observations.set(JSON.stringify(observation), observation);
  });
  return [...observations.values()];
}

function extractTheme(
  theme: Record<string, unknown>,
  schemeColors: Map<string, string>,
  themeNames: Set<string>
): void {
  const root = firstChildObject(theme["a:theme"]);
  const name = attr(root, "name");
  if (name) themeNames.add(name);
  const elements = firstChildObject(root?.["a:themeElements"]);
  const scheme = firstChildObject(elements?.["a:clrScheme"]);
  if (!scheme) return;

  for (const [schemeName, wrapper] of Object.entries(scheme)) {
    if (schemeName.startsWith("@_")) continue;
    let hex: string | undefined;
    walk(wrapper, (key, value) => {
      if (hex) return;
      if (key === "a:srgbClr") hex = attr(value, "val");
      if (key === "a:sysClr") hex = attr(value, "lastClr");
    });
    if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) {
      const shortName = schemeName.includes(":") ? schemeName.split(":").at(-1)! : schemeName;
      if (!schemeColors.has(shortName)) schemeColors.set(shortName, `#${hex.toUpperCase()}`);
    }
  }
}

function elementFromNode(
  key: string,
  node: Record<string, unknown>,
  slideIndex: number,
  slideWidth: number,
  slideHeight: number,
  schemeColors: Map<string, string>,
  fallbackId: number
): NormalizedElement {
  const nv = nonVisualProperties(key, node);
  const core = coreProperties(nv);
  const objectId = attr(core, "id") ?? `generated-${fallbackId}`;
  const objectName = attr(core, "name") ?? `${key}-${objectId}`;
  const kind = detectKind(key, node);
  const text = collectText(node);
  const geometry = normalizeBox(transformFor(key, node), slideWidth, slideHeight);
  const semanticRole = detectRole(kind, objectName, placeholderType(nv), geometry.box, text);

  return {
    id: `slide-${slideIndex}.object-${objectId}`,
    objectId,
    objectName,
    slideIndex,
    kind,
    semanticRole,
    box: geometry.box,
    ...(text ? { textPreview: text.slice(0, 240) } : {}),
    colors: collectColors(node, schemeColors),
    typography: collectTypography(node),
    warnings: geometry.warning ? [geometry.warning] : []
  };
}

function extractElementsFromContainer(
  container: Record<string, unknown>,
  slideIndex: number,
  slideWidth: number,
  slideHeight: number,
  schemeColors: Map<string, string>,
  target: NormalizedElement[],
  counter: { value: number }
): void {
  for (const key of supportedObjectKeys) {
    for (const item of asArray(container[key])) {
      if (!item || typeof item !== "object") continue;
      counter.value += 1;
      const node = item as Record<string, unknown>;
      target.push(elementFromNode(key, node, slideIndex, slideWidth, slideHeight, schemeColors, counter.value));
      if (key === "p:grpSp") {
        extractElementsFromContainer(node, slideIndex, slideWidth, slideHeight, schemeColors, target, counter);
      }
    }
  }
}

function sourceFor(element: NormalizedElement): SourceRef {
  return {
    slideIndex: element.slideIndex,
    objectIds: [element.objectId],
    box: element.box
  };
}

function tokenRoleForColor(element: NormalizedElement): string {
  if (element.semanticRole === "background") return "background";
  if (element.kind === "text") return "text";
  if (element.kind === "chart") return "chart";
  if (["logo", "icon", "decoration"].includes(element.semanticRole)) return "decorative";
  return "accent";
}

function typographyRole(element: NormalizedElement): string {
  if (["title", "subtitle", "body", "caption", "label", "metric"].includes(element.semanticRole)) {
    return element.semanticRole;
  }
  return "unknown";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function buildProfile(
  inputPath: string,
  sha256: string,
  slideWidth: number,
  slideHeight: number,
  slideCount: number,
  elements: NormalizedElement[]
): Record<string, unknown> {
  const colorMap = new Map<string, { id: string; hex: string; roles: Set<string>; usageCount: number; sources: SourceRef[] }>();
  const typographyMap = new Map<string, {
    id: string;
    fontFamily: string;
    fontSizePt: number;
    fontWeight: number;
    italic: boolean;
    roles: Set<string>;
    usageCount: number;
    sources: SourceRef[];
  }>();

  for (const element of elements) {
    for (const hex of element.colors) {
      const id = `color.${hex.slice(1).toLowerCase()}`;
      const token = colorMap.get(id) ?? { id, hex, roles: new Set<string>(), usageCount: 0, sources: [] };
      token.roles.add(tokenRoleForColor(element));
      token.usageCount += 1;
      token.sources.push(sourceFor(element));
      colorMap.set(id, token);
    }
    for (const observation of element.typography) {
      const id = `type.${slug(observation.fontFamily)}.${observation.fontSizePt}.${observation.fontWeight}.${observation.italic ? "italic" : "normal"}`;
      const token = typographyMap.get(id) ?? {
        id,
        ...observation,
        roles: new Set<string>(),
        usageCount: 0,
        sources: []
      };
      token.roles.add(typographyRole(element));
      token.usageCount += 1;
      token.sources.push(sourceFor(element));
      typographyMap.set(id, token);
    }
  }

  const colors = [...colorMap.values()]
    .sort((a, b) => b.usageCount - a.usageCount || a.hex.localeCompare(b.hex))
    .map((token) => ({ ...token, roles: [...token.roles].sort() }));
  const typography = [...typographyMap.values()]
    .sort((a, b) => b.usageCount - a.usageCount || b.fontSizePt - a.fontSizePt || a.fontFamily.localeCompare(b.fontFamily))
    .map((token) => ({ ...token, roles: [...token.roles].sort() }));

  const warnings = elements
    .filter((element) => element.warnings.length > 0)
    .flatMap((element) => element.warnings.map((message) => ({
      code: "low_confidence",
      message,
      sources: [sourceFor(element)]
    })));

  return {
    schemaVersion: "0.1.0",
    draftId: `draft-${sha256.slice(0, 12)}`,
    source: {
      fileName: path.basename(inputPath),
      sha256,
      slideCount,
      slideSizeEmu: { width: slideWidth, height: slideHeight }
    },
    generatedAt: new Date().toISOString(),
    profilerVersion: PROFILE_VERSION,
    tokens: {
      colors,
      typography,
      spacing: [],
      strokes: []
    },
    primitives: elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      semanticRole: element.semanticRole,
      objectName: element.objectName,
      ...(element.textPreview ? { textPreview: element.textPreview } : {}),
      box: element.box,
      styleTokenIds: [
        ...element.colors.map((hex) => `color.${hex.slice(1).toLowerCase()}`),
        ...element.typography.map((observation) =>
          `type.${slug(observation.fontFamily)}.${observation.fontSizePt}.${observation.fontWeight}.${observation.italic ? "italic" : "normal"}`
        )
      ],
      source: sourceFor(element),
      confidence: element.warnings.length > 0 ? 0.55 : 0.9
    })),
    persistentElements: [],
    patterns: [],
    constructions: [],
    layouts: [],
    warnings
  };
}

function buildSummary(elements: NormalizedElement[], slideCount: number, themeNames: Set<string>): ProfileResult["summary"] {
  const objectCounts: Record<string, number> = {};
  for (const element of elements) objectCounts[element.kind] = (objectCounts[element.kind] ?? 0) + 1;
  const slides = Array.from({ length: slideCount }, (_, slideIndex) => {
    const onSlide = elements.filter((element) => element.slideIndex === slideIndex);
    const kinds: Record<string, number> = {};
    for (const element of onSlide) kinds[element.kind] = (kinds[element.kind] ?? 0) + 1;
    return {
      slideIndex,
      objectCount: onSlide.length,
      kinds,
      textSamples: onSlide.flatMap((element) => element.textPreview ? [element.textPreview] : []).slice(0, 3)
    };
  });
  return {
    slideCount,
    objectCount: elements.length,
    objectCounts,
    themeNames: [...themeNames].sort(),
    slides
  };
}

async function readXml(zip: JSZip, fileName: string): Promise<Record<string, unknown>> {
  const entry = zip.file(fileName);
  if (!entry) throw new Error(`Required PPTX part is missing: ${fileName}`);
  return parser.parse(await entry.async("string")) as Record<string, unknown>;
}

export async function profilePptx(inputPath: string): Promise<ProfileResult> {
  const bytes = await fs.readFile(inputPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });

  const entryNames = Object.keys(zip.files);
  if (entryNames.length > 10_000) throw new Error("PPTX contains too many ZIP entries.");
  if (entryNames.some((name) => name.startsWith("/") || name.split("/").includes(".."))) {
    throw new Error("PPTX contains an unsafe ZIP path.");
  }

  const presentation = await readXml(zip, "ppt/presentation.xml");
  const root = firstChildObject(presentation["p:presentation"]);
  const slideSize = firstChildObject(root?.["p:sldSz"]);
  const slideWidth = numberAttr(slideSize, "cx");
  const slideHeight = numberAttr(slideSize, "cy");
  if (!slideWidth || !slideHeight) throw new Error("PPTX slide size is missing or invalid.");

  const slideFiles = entryNames
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)?.[1]) - Number(b.match(/slide(\d+)\.xml/)?.[1]));
  if (slideFiles.length === 0) throw new Error("PPTX contains no slides.");

  const schemeColors = new Map<string, string>();
  const themeNames = new Set<string>();
  for (const themeFile of entryNames.filter((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name)).sort()) {
    extractTheme(await readXml(zip, themeFile), schemeColors, themeNames);
  }

  const elements: NormalizedElement[] = [];
  for (let slideIndex = 0; slideIndex < slideFiles.length; slideIndex += 1) {
    const slide = await readXml(zip, slideFiles[slideIndex]!);
    const slideRoot = firstChildObject(slide["p:sld"]);
    const commonSlideData = firstChildObject(slideRoot?.["p:cSld"]);
    const shapeTree = firstChildObject(commonSlideData?.["p:spTree"]);
    if (!shapeTree) continue;
    extractElementsFromContainer(shapeTree, slideIndex, slideWidth, slideHeight, schemeColors, elements, { value: 0 });
  }

  return {
    profile: buildProfile(inputPath, sha256, slideWidth, slideHeight, slideFiles.length, elements),
    summary: buildSummary(elements, slideFiles.length, themeNames)
  };
}
