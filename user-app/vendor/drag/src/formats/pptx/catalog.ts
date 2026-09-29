import { PPTX_GEOMETRY_LIMITS } from "./limits";
import { isSafeLink } from "../../core/safe-link";
import { SECURITY_LIMITS } from "../../core/limits";
import { PptxError, PptxPackage } from "./package";

const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const SLIDE_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

export interface PptxSlideDescriptor {
  id: string;
  sourceIndex: number;
  part: string;
  width: number;
  height: number;
}
export interface PptxCatalog { format: "pptx"; pages: PptxSlideDescriptor[] }
export interface Relationship { id: string; type: string; target: string; external?: boolean; blocked?: boolean }

/** Local package session. No references are fetched or dereferenced outside this archive. */
export class PptxCatalogReader {
  private readonly archive: PptxPackage;
  private readonly overrides = new Map<string, string>();
  private readonly inertWorkbooks = new Set<string>();
  private readonly defaults = new Map<string, string>();

  constructor(bytes: Uint8Array, private readonly parser: Pick<DOMParser, "parseFromString"> = new DOMParser()) {
    this.archive = new PptxPackage(bytes);
    const types = this.xml("[Content_Types].xml", CONTENT, "Types");
    for (const child of Array.from(types.children)) {
      if (child.namespaceURI !== CONTENT) fail();
      const type = required(child, "ContentType");
      if (/macroEnabled|vbaProject|oleObject|activeX/i.test(type)) throw new PptxError("unsupported-file", "Active PPTX content is not supported");
      if (child.localName === "Override") {
        const name = required(child, "PartName");
        if (!name.startsWith("/")) fail();
        const part = resolveTarget("", name);
        if (this.overrides.has(part)) fail();
        // Editors can retain type declarations for deleted, unused parts.
        // Relationships still require their targets to exist before any slide is opened.
        this.overrides.set(part, type);
      } else if (child.localName === "Default") {
        const extension = required(child, "Extension").toLowerCase();
        if (this.defaults.has(extension)) fail();
        this.defaults.set(extension, type);
      } else fail();
    }
    // Reject unsafe relationships even on currently unselected slides.
    for (const name of this.archive.names()) {
      if (/(?:vbaProject\.bin|activeX\/)/i.test(name)) throw new PptxError("unsupported-file", "Embedded active PPTX content is not supported");
      if (name.endsWith(".rels")) this.relationshipsFromPart(name);
    }
    for (const name of this.archive.names()) {
      if (/embeddings\//i.test(name) && !name.endsWith("/") && !this.inertWorkbooks.has(name)) throw new PptxError("unsupported-file", "Unsupported embedded PPTX package");
    }
  }

  readAsset(part: string): Uint8Array { return this.archive.read(part); }

  presentationPart(): string {
    const roots = [...this.relationships("").values()].filter(rel => rel.type === `${OFFICE_REL}/officeDocument`);
    if (roots.length !== 1) fail();
    return roots[0]!.target;
  }

  analyze(): PptxCatalog {
    const roots = [...this.relationships("").values()].filter(rel => rel.type === `${OFFICE_REL}/officeDocument`);
    if (roots.length !== 1) fail();
    const part = roots[0]!.target;
    if (this.contentType(part) !== MAIN_TYPE) throw new PptxError("unsupported-file", "Expected an unencrypted PPTX presentation");
    const root = this.xml(part, PRESENTATION, "presentation");
    const size = children(root, PRESENTATION, "sldSz");
    if (size.length !== 1) fail();
    const width = dimension(required(size[0]!, "cx")), height = dimension(required(size[0]!, "cy"));
    const lists = children(root, PRESENTATION, "sldIdLst");
    if (lists.length !== 1) fail();
    const slides = children(lists[0]!, PRESENTATION, "sldId");
    if (!slides.length) fail();
    if (slides.length > SECURITY_LIMITS.maxPages) throw new PptxError("security-limit", "PPTX slide budget exceeded");
    const relationships = this.relationships(part), seen = new Set<string>(), seenIds = new Set<string>();
    const pages = slides.map((slide, sourceIndex) => {
      const id = required(slide, "id"), relationshipId = slide.getAttributeNS(OFFICE_REL, "id");
      const rel = relationshipId ? relationships.get(relationshipId) : undefined;
      if (!rel || rel.type !== `${OFFICE_REL}/slide` || seen.has(rel.target) || seenIds.has(id) || this.contentType(rel.target) !== SLIDE_TYPE) fail();
      seen.add(rel.target); seenIds.add(id);
      return { id: `pptx-slide-${sourceIndex + 1}`, sourceIndex, part: rel.target, width, height };
    });
    return { format: "pptx", pages };
  }

  /** Only explicit RGB slide backgrounds in this slice; other paints are disclosed. */
  readBackground(part: string): { color?: string; warnings: string[] } {
    const root = this.xml(part, PRESENTATION, "sld");
    const common = children(root, PRESENTATION, "cSld")[0];
    if (!common) fail();
    const background = children(common, PRESENTATION, "bg")[0];
    if (!background) return { warnings: ["pptx-background-inheritance-pending"] };
    const properties = children(background, PRESENTATION, "bgPr")[0];
    const fill = properties && children(properties, DRAWING, "solidFill")[0];
    const rgb = fill && children(fill, DRAWING, "srgbClr")[0];
    const color = rgb?.getAttribute("val");
    if (color && /^[0-9a-f]{6}$/i.test(color) && !rgb!.children.length && properties!.children.length === 1 && fill!.children.length === 1) {
      return { color: color.toUpperCase(), warnings: [] };
    }
    return { warnings: ["pptx-background-unsupported"] };
  }

  private contentType(part: string): string | undefined {
    return this.overrides.get(part) ?? this.defaults.get(part.split(".").pop()!.toLowerCase());
  }

  relationships(source: string): Map<string, Relationship> {
    const slash = source.lastIndexOf("/");
    const part = source ? `${source.slice(0, slash + 1)}_rels/${source.slice(slash + 1)}.rels` : "_rels/.rels";
    return this.archive.has(part) ? this.relationshipsFromPart(part) : new Map();
  }

  private relationshipsFromPart(part: string): Map<string, Relationship> {
    const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(part);
    const source = part === "_rels/.rels" ? "" : match ? `${match[1] ?? ""}${match[2]}` : undefined;
    if (source === undefined) fail();
    const root = this.xml(part, PACKAGE_REL, "Relationships");
    const result = new Map<string, Relationship>();
    for (const child of Array.from(root.children)) {
      if (child.namespaceURI !== PACKAGE_REL || child.localName !== "Relationship") fail();
      const id = required(child, "Id"), type = required(child, "Type"), mode = child.getAttribute("TargetMode");
      if (mode === "External") {
        const hyperlink = type === `${OFFICE_REL}/hyperlink`;
        const media = type === `${OFFICE_REL}/video` || type === `${OFFICE_REL}/audio` || type === "http://schemas.microsoft.com/office/2007/relationships/media";
        if (!hyperlink && !media) throw new PptxError("unsupported-file", "External PPTX resources are not supported");
        if (result.has(id)) fail();
        const raw = required(child, "Target"), safe = isSafeLink(raw, media);
        result.set(id, { id, type, target: safe ? raw : "", external: true, ...(safe ? {} : { blocked: true }) });
        continue;
      }
      if (mode && mode !== "Internal") fail();
      if (/\/(?:oleObject|vbaProject|control)$/.test(type)) throw new PptxError("unsupported-file", "Active PPTX content is not supported");
      const target = resolveTarget(source, required(child, "Target"));
      if (type === `${OFFICE_REL}/package`) {
        if (this.contentType(source) !== "application/vnd.openxmlformats-officedocument.drawingml.chart+xml" || this.contentType(target) !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || !target.toLowerCase().endsWith(".xlsx")) throw new PptxError("unsupported-file", "Unsupported embedded PPTX package");
        // The chart cache is authoritative for import. Workbook bytes are never opened or executed.
        this.inertWorkbooks.add(target);
      }
      if (result.has(id) || !this.archive.has(target)) fail();
      result.set(id, { id, type, target });
    }
    return result;
  }

  xml(part: string, namespace: string, localName: string): Element {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(this.archive.read(part, 4 * 1024 * 1024)); }
    catch (error) { if (error instanceof PptxError) throw error; fail(); }
    if (/<!DOCTYPE|<!ENTITY/i.test(text!)) throw new PptxError("unsupported-file", "XML declarations with entities are not supported");
    // Bound DOM construction before parsing; the lexical count is deliberately conservative.
    let depth = 0, count = 0, guides = 0, pathCommands = 0;
    for (const token of text!.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
      const tag = token[0];
      if (tag.startsWith("<?") || tag.startsWith("<!")) continue;
      if (tag.startsWith("</")) depth--;
      else {
        count++; if (!tag.endsWith("/>")) depth++;
        const local = /^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)(?=[\s/>])/.exec(tag)?.[1];
        if (local === "gd") guides++;
        if (local && ["moveTo","lnTo","quadBezTo","cubicBezTo","arcTo","close"].includes(local)) pathCommands++;
        if (guides > PPTX_GEOMETRY_LIMITS.maxGuides || pathCommands > PPTX_GEOMETRY_LIMITS.maxPathCommands) throw new PptxError("security-limit", "PPTX geometry XML budget exceeded");
      }
      if (depth > 64 || count > 100_000) throw new PptxError("security-limit", "PPTX XML budget exceeded");
    }
    const document = this.parser.parseFromString(text!, "application/xml");
    const root = document.documentElement;
    if (document.getElementsByTagName("parsererror").length || root.namespaceURI !== namespace || root.localName !== localName) fail();
    return root;
  }
}

function children(parent: Element, namespace: string, localName: string): Element[] {
  return Array.from(parent.children).filter(child => child.namespaceURI === namespace && child.localName === localName);
}
function required(element: Element, name: string): string {
  const value = element.getAttribute(name);
  if (!value) fail();
  return value;
}
function dimension(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail();
  const pixels = Number(value) / 9525;
  if (pixels < 0.01 || pixels > SECURITY_LIMITS.maxPageDimension) throw new PptxError("security-limit", "PPTX slide dimension budget exceeded");
  return pixels;
}
function resolveTarget(source: string, target: string): string {
  if (/[\\\0%?#:]/.test(target)) fail();
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const piece of target.replace(/^\//, "").split("/")) {
    if (piece === "..") { if (!parts.length) fail(); parts.pop(); }
    else if (piece !== ".") { if (!piece) fail(); parts.push(piece); }
  }
  if (!parts.length) fail();
  return parts.join("/");
}
function fail(): never { throw new PptxError("invalid-file", "Invalid PPTX package structure"); }
