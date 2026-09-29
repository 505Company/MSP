import { XMLParser } from "fast-xml-parser"
import JSZip from "jszip"

type RecordValue = Record<string, unknown>

export type PrimitiveKind =
  | "text"
  | "image"
  | "shape"
  | "line"
  | "group"
  | "chart"
  | "table"
  | "smartArt"
  | "unknown"

export type SemanticRole =
  | "title"
  | "subtitle"
  | "body"
  | "image"
  | "divider"
  | "background"
  | "decoration"
  | "unknown"

export type Box = { x: number; y: number; width: number; height: number }

export type Primitive = {
  id: string
  rootId: string
  parentId: string
  children: string[]
  sourceRef: { part: string; shapeId: string | null; elementPath: string }
  identityMethod: "shape_id" | "element_path"
  slideIndex: number
  kind: PrimitiveKind
  role: SemanticRole
  roleBasis: "placeholder" | "heuristic"
  box: Box | null
  colors: string[]
  typography: Array<{
    fontFamily: string | null
    fontSizePt: number
    fontWeight: number | null
    italic: boolean | null
  }>
  geometryResolved: boolean
  geometryReason: "missing_transform" | "invalid_transform" | "group_transform_not_resolved" | "rotation_or_flip_not_resolved" | null
}

export type ParsedPresentation = {
  schemaVersion: "0.3.1"
  source: {
    fileName: string
    sha256: string
    sizeBytes: number
    slideCount: number
    slideSizeEmu: { width: number; height: number }
  }
  generatedAt: string
  palette: Array<{ hex: string; usageCount: number }>
  typography: Array<{
    fontFamily: string | null
    fontSizePt: number
    fontWeight: number | null
    italic: boolean | null
    usageCount: number
  }>
  primitives: Primitive[]
  slides: Array<{
    id: string
    sourcePart: string
    slideIndex: number
    hidden: boolean
    children: string[]
    objectCount: number
    kinds: Record<string, number>
    roles: Record<string, number>
  }>
  warnings: Array<{ code: string; message: string; count: number }>
}

const objectKeys = ["p:sp", "p:pic", "p:graphicFrame", "p:grpSp", "p:cxnSp"] as const
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => objectKeys.includes(name as (typeof objectKeys)[number]),
})

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function attr(value: unknown, name: string): string | undefined {
  const result = record(value)?.[`@_${name}`]
  return result === undefined ? undefined : String(result)
}

function numberAttr(value: unknown, name: string): number | undefined {
  const parsed = Number(attr(value, name))
  return Number.isFinite(parsed) ? parsed : undefined
}

function walk(value: unknown, visitor: (key: string, child: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visitor)
    return
  }
  const node = record(value)
  if (!node) return
  for (const [key, child] of Object.entries(node)) {
    visitor(key, child)
    walk(child, visitor)
  }
}

function normalizeBox(
  transform: unknown,
  slideWidth: number,
  slideHeight: number,
  insideGroup: boolean
): Pick<Primitive, "box" | "geometryResolved" | "geometryReason"> {
  const node = record(transform)
  const unresolved = (geometryReason: Primitive["geometryReason"]) => ({
    box: null, geometryResolved: false, geometryReason,
  })
  // Group children use a different coordinate system. Do not label their local
  // offsets as slide coordinates until group transforms are actually composed.
  if (insideGroup) return unresolved("group_transform_not_resolved")
  if (numberAttr(node, "rot") || ["flipH", "flipV"].some((key) => ["1", "true"].includes(attr(node, key) ?? ""))) {
    return unresolved("rotation_or_flip_not_resolved")
  }
  const offset = record(node?.["a:off"])
  const extent = record(node?.["a:ext"])
  const rawX = numberAttr(offset, "x")
  const rawY = numberAttr(offset, "y")
  const rawWidth = numberAttr(extent, "cx")
  const rawHeight = numberAttr(extent, "cy")

  if (
    rawX === undefined ||
    rawY === undefined ||
    rawWidth === undefined ||
    rawHeight === undefined
  ) {
    return unresolved("missing_transform")
  }
  if (rawWidth < 0 || rawHeight < 0) return unresolved("invalid_transform")

  return {
    box: {
      x: rawX / slideWidth,
      y: rawY / slideHeight,
      width: rawWidth / slideWidth,
      height: rawHeight / slideHeight,
    },
    geometryResolved: true,
    geometryReason: null,
  }
}

function nonVisual(key: string, node: RecordValue): RecordValue {
  const propertyKey = {
    "p:sp": "p:nvSpPr",
    "p:pic": "p:nvPicPr",
    "p:graphicFrame": "p:nvGraphicFramePr",
    "p:grpSp": "p:nvGrpSpPr",
    "p:cxnSp": "p:nvCxnSpPr",
  }[key]
  return record(propertyKey ? node[propertyKey] : undefined) ?? {}
}

function transformFor(key: string, node: RecordValue): unknown {
  if (key === "p:graphicFrame") return node["p:xfrm"]
  if (key === "p:grpSp") return record(node["p:grpSpPr"])?.["a:xfrm"]
  return record(node["p:spPr"])?.["a:xfrm"]
}

function detectKind(key: string, node: RecordValue): PrimitiveKind {
  if (key === "p:pic") return "image"
  if (key === "p:grpSp") return "group"
  if (key === "p:cxnSp") return "line"
  if (key === "p:sp") return node["p:txBody"] ? "text" : "shape"
  if (key === "p:graphicFrame") {
    const serialized = JSON.stringify(node)
    if (serialized.includes("/chart")) return "chart"
    if (serialized.includes("/table")) return "table"
    if (serialized.includes("/diagram")) return "smartArt"
  }
  return "unknown"
}

function detectRole(
  kind: PrimitiveKind,
  placeholder: string | undefined,
  box: Box | null
): SemanticRole {
  if (placeholder === "title" || placeholder === "ctrTitle") return "title"
  if (placeholder === "subTitle") return "subtitle"
  if (placeholder === "body") return "body"
  if (placeholder === "pic" || kind === "image") return "image"
  if (kind === "line") return "divider"
  if (kind === "text" && box) return box.y < 0.25 && box.height < 0.25 ? "title" : "body"
  if (kind === "shape" && box && box.width > 0.95 && box.height > 0.95) return "background"
  if (kind === "shape") return "decoration"
  return "unknown"
}

function collectColors(value: unknown): string[] {
  const colors = new Set<string>()
  walk(value, (key, child) => {
    // Fully opaque alpha is an identity transform. Other modifiers need paint
    // resolution, so keep them unresolved rather than reporting the base color.
    const color = record(child) ?? {}
    const modifiers = Object.keys(color).filter((name) => !name.startsWith("@_"))
    if (modifiers.some((name) => {
      const modifier = record(color[name])
      return name !== "a:alpha" || attr(modifier, "val") !== "100000" ||
        Object.keys(modifier ?? {}).some((attribute) => attribute !== "@_val")
    })) return
    if (key === "a:srgbClr") {
      const hex = attr(child, "val")
      if (hex && /^[0-9a-f]{6}$/i.test(hex)) colors.add(`#${hex.toUpperCase()}`)
    }
    if (key === "a:sysClr") {
      const hex = attr(child, "lastClr")
      if (hex && /^[0-9a-f]{6}$/i.test(hex)) colors.add(`#${hex.toUpperCase()}`)
    }
  })
  return [...colors]
}

function collectTypography(value: unknown): Primitive["typography"] {
  const observations = new Map<string, Primitive["typography"][number]>()
  walk(value, (key, child) => {
    if (!["a:rPr", "a:defRPr", "a:endParaRPr"].includes(key)) return
    const node = record(child)
    const size = numberAttr(node, "sz")
    if (!node || !size || size <= 0) return
    const font =
      attr(record(node["a:latin"]), "typeface") ??
      attr(record(node["a:ea"]), "typeface") ??
      attr(record(node["a:cs"]), "typeface") ??
      null
    const observation = {
      fontFamily: font,
      fontSizePt: size / 100,
      fontWeight: attr(node, "b") === undefined ? null : ["1", "true"].includes(attr(node, "b")!) ? 700 : 400,
      italic: attr(node, "i") === undefined ? null : ["1", "true"].includes(attr(node, "i")!),
    }
    observations.set(JSON.stringify(observation), observation)
  })
  return [...observations.values()]
}

function collectPrimitives(
  container: RecordValue,
  slideIndex: number,
  slideWidth: number,
  slideHeight: number,
  sourcePart: string,
  rootId: string,
  output: Primitive[],
  parentId = rootId,
  parentPath = "p:spTree"
): void {
  for (const key of objectKeys) {
    for (const [index, raw] of asArray(container[key]).entries()) {
      const node = record(raw)
      if (!node) continue
      const elementPath = `${parentPath}/${key}[${index}]`
      // Start with path identities; a second pass promotes unique cNvPr IDs.
      const id = `${rootId}/path/${elementPath}`
      const kind = detectKind(key, node)
      const geometry = normalizeBox(transformFor(key, node), slideWidth, slideHeight, parentId !== rootId)
      const nv = nonVisual(key, node)
      const rawShapeId = attr(nv["p:cNvPr"], "id")
      const shapeId = rawShapeId && /^\d{1,10}$/.test(rawShapeId) ? rawShapeId : null
      const nvProperties = record(nv["p:nvPr"])
      const placeholder = attr(nvProperties?.["p:ph"], "type")
      // A group's own observations must not count its children's styles again.
      const ownProperties = Object.fromEntries(Object.entries(node).filter(([name]) => !objectKeys.includes(name as (typeof objectKeys)[number])))
      output.push({
        id,
        rootId,
        parentId,
        children: [],
        sourceRef: { part: sourcePart, shapeId, elementPath },
        identityMethod: "element_path",
        slideIndex,
        kind,
        role: detectRole(kind, placeholder, geometry.box),
        roleBasis: ["title", "ctrTitle", "subTitle", "body", "pic"].includes(placeholder ?? "") ? "placeholder" : "heuristic",
        ...geometry,
        colors: collectColors(ownProperties),
        typography: collectTypography(ownProperties),
      })
      if (key === "p:grpSp") {
        collectPrimitives(node, slideIndex, slideWidth, slideHeight, sourcePart, rootId, output, id, elementPath)
      }
    }
  }
}

function resolveIdentities(primitives: Primitive[]): void {
  const counts = new Map<string, number>()
  const shapeKey = (item: Primitive) => `${item.rootId}/shape/${item.sourceRef.shapeId}`
  for (const item of primitives) {
    if (item.sourceRef.shapeId !== null) counts.set(shapeKey(item), (counts.get(shapeKey(item)) ?? 0) + 1)
  }
  const identities = new Map(primitives.map((item) => [item.id, counts.get(shapeKey(item)) === 1 ? shapeKey(item) : item.id]))
  for (const item of primitives) {
    const id = identities.get(item.id)!
    item.identityMethod = id === item.id ? "element_path" : "shape_id"
    item.id = id
    item.parentId = identities.get(item.parentId) ?? item.parentId
  }
  const byId = new Map(primitives.map((item) => [item.id, item]))
  for (const item of primitives) byId.get(item.parentId)?.children.push(item.id)
}

async function readXml(zip: JSZip, path: string): Promise<RecordValue> {
  const entry = zip.file(path)
  if (!entry) throw new Error(`PPTX part is missing: ${path}`)
  return xml.parse(await entry.async("string")) as RecordValue
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function profilePptxBytes(
  fileName: string,
  bytes: Uint8Array
): Promise<ParsedPresentation> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false })
  const paths = Object.keys(zip.files)
  if (paths.length > 10_000) throw new Error("PPTX contains too many ZIP entries")
  if (paths.some((path) => path.startsWith("/") || path.split("/").includes(".."))) {
    throw new Error("PPTX contains an unsafe ZIP path")
  }

  const presentation = await readXml(zip, "ppt/presentation.xml")
  const root = record(presentation["p:presentation"])
  const slideSize = record(root?.["p:sldSz"])
  const width = numberAttr(slideSize, "cx")
  const height = numberAttr(slideSize, "cy")
  if (!width || !height || width < 0 || height < 0) throw new Error("PPTX slide size is missing or invalid")

  let slidePaths = paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(
      (left, right) =>
        Number(left.match(/slide(\d+)\.xml/)?.[1]) -
        Number(right.match(/slide(\d+)\.xml/)?.[1])
    )
  const warnings: ParsedPresentation["warnings"] = []
  if (root?.["p:sldIdLst"] !== undefined) {
    const relationships = await readXml(zip, "ppt/_rels/presentation.xml.rels")
    const targets = new Map(asArray(record(relationships.Relationships)?.Relationship).map((value) => [attr(value, "Id"), value]))
    slidePaths = asArray(record(root["p:sldIdLst"])?.["p:sldId"]).map((entry) => {
      const relationship = targets.get(attr(entry, "r:id"))
      const target = attr(relationship, "Target")
      if (!target || attr(relationship, "TargetMode") === "External" || !attr(relationship, "Type")?.endsWith("/slide")) {
        throw new Error("PPTX has an invalid slide relationship")
      }
      const url = new URL(target, "https://pptx.invalid/ppt/presentation.xml")
      const part = decodeURIComponent(url.pathname.slice(1))
      if (url.origin !== "https://pptx.invalid" || url.search || url.hash || !/^ppt\/slides\/[^/]+\.xml$/.test(part) || !zip.file(part)) {
        throw new Error("PPTX has a missing or unsupported slide target")
      }
      return part
    })
    if (new Set(slidePaths).size !== slidePaths.length) throw new Error("PPTX has duplicate slide targets")
  } else {
    warnings.push({ code: "slide_order_fallback", message: "Порядок слайдов восстановлен по именам частей: список слайдов отсутствует.", count: 1 })
  }
  if (!slidePaths.length) throw new Error("PPTX contains no slides")

  const primitives: Primitive[] = []
  const hiddenSlides = new Set<number>()
  for (let slideIndex = 0; slideIndex < slidePaths.length; slideIndex += 1) {
    const sourcePart = slidePaths[slideIndex]!
    const rootId = `pptx:${sourcePart}`
    const slide = await readXml(zip, sourcePart)
    const slideRoot = record(slide["p:sld"])
    if (["0", "false"].includes(attr(slideRoot, "show") ?? "")) hiddenSlides.add(slideIndex)
    const common = record(slideRoot?.["p:cSld"])
    const tree = record(common?.["p:spTree"])
    if (tree) collectPrimitives(tree, slideIndex, width, height, sourcePart, rootId, primitives)
  }
  resolveIdentities(primitives)

  const colorUsage = new Map<string, number>()
  const typographyUsage = new Map<string, ParsedPresentation["typography"][number]>()
  for (const primitive of primitives) {
    for (const color of primitive.colors) {
      colorUsage.set(color, (colorUsage.get(color) ?? 0) + 1)
    }
    for (const observation of primitive.typography) {
      const key = JSON.stringify(observation)
      const existing = typographyUsage.get(key)
      typographyUsage.set(key, {
        ...observation,
        usageCount: (existing?.usageCount ?? 0) + 1,
      })
    }
  }

  const slides = Array.from({ length: slidePaths.length }, (_, slideIndex) => {
    const items = primitives.filter((primitive) => primitive.slideIndex === slideIndex)
    const kinds: Record<string, number> = {}
    const roles: Record<string, number> = {}
    for (const item of items) {
      kinds[item.kind] = (kinds[item.kind] ?? 0) + 1
      roles[item.role] = (roles[item.role] ?? 0) + 1
    }
    const sourcePart = slidePaths[slideIndex]!
    const id = `pptx:${sourcePart}`
    return { id, sourcePart, slideIndex, hidden: hiddenSlides.has(slideIndex), children: items.filter((item) => item.parentId === id).map((item) => item.id), objectCount: items.length, kinds, roles }
  })
  for (const reason of ["missing_transform", "invalid_transform", "group_transform_not_resolved", "rotation_or_flip_not_resolved"] as const) {
    const count = primitives.filter((primitive) => primitive.geometryReason === reason).length
    if (count) warnings.push({ code: reason, message: {
      missing_transform: "Геометрия отсутствует в объекте; наследование из макета не разрешено.",
      invalid_transform: "Геометрия содержит недопустимые размеры.",
      group_transform_not_resolved: "Координаты внутри групп не пересчитаны в координаты слайда.",
      rotation_or_flip_not_resolved: "Геометрия повёрнутых или отражённых объектов не разрешена.",
    }[reason], count })
  }
  const fallbackIdentities = primitives.filter((primitive) => primitive.identityMethod === "element_path").length
  if (fallbackIdentities) warnings.push({ code: "object_id_fallback", message: "Отсутствующие или повторные ID объектов заменены ссылками на структурный путь внутри части PPTX.", count: fallbackIdentities })

  return {
    schemaVersion: "0.3.1",
    source: {
      fileName,
      sha256: await sha256(bytes),
      sizeBytes: bytes.byteLength,
      slideCount: slidePaths.length,
      slideSizeEmu: { width, height },
    },
    generatedAt: new Date().toISOString(),
    palette: [...colorUsage]
      .map(([hex, usageCount]) => ({ hex, usageCount }))
      .sort((left, right) => right.usageCount - left.usageCount || left.hex.localeCompare(right.hex)),
    typography: [...typographyUsage.values()].sort(
      (left, right) =>
        right.usageCount - left.usageCount ||
        right.fontSizePt - left.fontSizePt ||
        (left.fontFamily ?? "").localeCompare(right.fontFamily ?? "")
    ),
    primitives,
    slides,
    warnings,
  }
}

/** Rebuild stale profiles from source to apply identity and color fixes. */
export async function restorePresentationProfile(
  cached: unknown,
  fileName: string,
  readSource: () => Promise<Uint8Array>
): Promise<ParsedPresentation> {
  if (record(cached)?.schemaVersion === "0.3.1") return cached as ParsedPresentation
  return profilePptxBytes(fileName, await readSource())
}
