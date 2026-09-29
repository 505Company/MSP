import assert from "node:assert/strict"
import test from "node:test"
import { profilePptxBytes, restorePresentationProfile } from "../admin/lib/uploads/pptx-profiler.js"
import { buildQwenInput, buildQwenMessages, QWEN_INPUT_LIMITS, type QwenTaskInput } from "../admin/lib/uploads/qwen-input.js"
import { group, pptxFixture, SECRET, shape } from "./fixtures/qwen-pptx.js"
import { validateQwenInput } from "../src/validate-qwen-input.js"

function checkReferences(input: QwenTaskInput): void {
  validateQwenInput(input)
  const nodes = new Map(input.nodes.map((node) => [node.id, node]))
  assert.equal(nodes.size, input.nodes.length)
  for (const id of input.roots) assert.equal(nodes.get(id)?.type, "slide")
  for (const node of input.nodes) {
    assert.ok(input.roots.includes(node.rootId))
    if (node.parentId !== null) {
      const parent = nodes.get(node.parentId)
      assert.equal(parent?.rootId, node.rootId)
      assert.ok(parent.children.includes(node.id))
    }
    assert.equal(new Set(node.children).size, node.children.length)
    for (const child of node.children) assert.equal(nodes.get(child)?.parentId, node.id)
    assert.ok(node.fullChildCount >= node.children.length)
    for (const id of node.props.colorIds) assert.ok(input.foundations.colors.some((style) => style.id === id))
    for (const id of node.props.typographyIds) assert.ok(input.foundations.typography.some((style) => style.id === id))
  }
  for (const style of [...input.foundations.colors, ...input.foundations.typography]) {
    for (const id of style.evidenceNodeIds) assert.ok(nodes.has(id))
  }
  assert.equal(input.counts.objectsProvided, input.nodes.length - input.roots.length)
  assert.equal(input.counts.objectsProvided + input.counts.objectsOmitted, input.counts.objectsTotal)
  assert.equal(input.sourceSlides.reduce((sum, slide) => sum + slide.providedObjectCount, 0), input.counts.objectsProvided)
  for (const slide of input.sourceSlides) assert.equal(slide.providedObjectCount + slide.omittedObjectCount, slide.objectCount)
}

test("PPTX source identities retain nesting and follow presentation order, not ZIP names", async () => {
  const bytes = await pptxFixture([
    { part: "ppt/slides/slide9.xml", objects: shape("2") + group("3", group("4", shape("5", { kind: "image" }))) },
    { part: "ppt/slides/slide1.xml", objects: shape("2"), hidden: true },
  ], { "ppt/slides/slide99.xml": "<p:sld/>" })
  const first = await profilePptxBytes("first.pptx", bytes)
  const second = await profilePptxBytes("renamed.pptx", bytes)
  assert.equal(first.source.slideCount, 2)
  assert.equal(first.slides[0]!.sourcePart, "ppt/slides/slide9.xml")
  assert.equal(first.slides[1]!.hidden, true)
  assert.deepEqual(first.primitives.map((node) => node.id), second.primitives.map((node) => node.id))
  const image = first.primitives.find((node) => node.kind === "image")!
  assert.equal(image.sourceRef.shapeId, "5")
  assert.equal(first.primitives.find((node) => node.id === image.parentId)?.sourceRef.shapeId, "4")
  assert.ok(first.primitives.every((node) => node.identityMethod === "shape_id"))
  const input = buildQwenInput(first)
  assert.deepEqual(input, buildQwenInput(second))
  checkReferences(input)
})

test("missing and duplicate source IDs have distinct reproducible paths without invented shape IDs", async () => {
  const bytes = await pptxFixture([{ objects: shape("2") + shape("2") + shape(null) + group("8", shape("2")) }])
  const profile = await profilePptxBytes("duplicate.pptx", bytes)
  assert.equal(new Set(profile.primitives.map((node) => node.id)).size, 5)
  assert.equal(profile.primitives.filter((node) => node.identityMethod === "element_path").length, 4)
  assert.equal(profile.primitives.filter((node) => node.sourceRef.shapeId === "2").length, 3)
  assert.ok(profile.primitives.some((node) => node.sourceRef.shapeId === null))
  assert.equal(profile.warnings.find((warning) => warning.code === "object_id_fallback")?.count, 4)
  checkReferences(buildQwenInput(profile))
})

test("unresolved geometry stays unknown; off-slide bounds and zero-size lines are not clamped", async () => {
  const profile = await profilePptxBytes("geometry.pptx", await pptxFixture([{ objects:
    shape("2", { transform: '<a:xfrm><a:off x="-100" y="50"/><a:ext cx="1200" cy="100"/></a:xfrm>' }) +
    shape("3", { transform: "" }) +
    shape("4", { transform: '<a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="200" cy="100"/></a:xfrm>' }) +
    shape("5", { kind: "line", transform: '<a:xfrm><a:off x="0" y="0"/><a:ext cx="200" cy="0"/></a:xfrm>' }) +
    group("6", shape("7")),
  }]))
  const find = (id: string) => profile.primitives.find((node) => node.sourceRef.shapeId === id)!
  assert.deepEqual(find("2").box, { x: -0.1, y: 0.1, width: 1.2, height: 0.2 })
  assert.equal(find("3").box, null)
  assert.equal(find("3").role, "unknown")
  assert.equal(find("4").geometryReason, "rotation_or_flip_not_resolved")
  assert.equal(find("5").box?.height, 0)
  assert.equal(find("7").geometryReason, "group_transform_not_resolved")
  const input = buildQwenInput(profile)
  for (const node of input.nodes.filter((node) => node.geometry.status === "unavailable")) assert.equal(node.bounds, null)
  assert.equal(input.counts.geometryUnavailableProvided, 3)
  checkReferences(input)
})

test("only structural observations reach the prompt; styles keep evidence and unknown inherited values", async () => {
  const profile = await profilePptxBytes(`${SECRET}.pptx`, await pptxFixture([{ objects:
    group("2", shape("3")) + shape("4", { properties: '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>' }) +
    shape("5", { properties: '<a:solidFill><a:srgbClr val="FF0000"><a:tint val="50000"/></a:srgbClr></a:solidFill>' }),
  }], { "ppt/theme/theme1.xml": '<a:theme><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="FFFF00"/></a:accent1></a:clrScheme></a:themeElements></a:theme>' }))
  assert.deepEqual(profile.palette, [{ hex: "#123456", usageCount: 1 }])
  assert.equal(profile.typography[0]!.usageCount, 3)
  assert.equal(profile.typography[0]!.italic, null)
  const input = buildQwenInput(profile)
  assert.equal(JSON.stringify(buildQwenMessages(input)).includes(SECRET), false)
  assert.equal(input.capabilities.previews, "unavailable")
  assert.deepEqual(input.previews, [])
  assert.equal(input.foundations.colors[0]!.evidenceNodeIds.length, 1)
  assert.ok(input.nodes.find((node) => node.sourceRef.shapeId === "3")!.props.typographyIds.length)
  checkReferences(input)
})

test("fully opaque explicit colors remain measurable while real opacity changes stay unresolved", async () => {
  const profile = await profilePptxBytes("opacity.pptx", await pptxFixture([{ objects:
    shape("2", { properties: '<a:solidFill><a:srgbClr val="FF9C12"><a:alpha val="100000"/></a:srgbClr></a:solidFill>' }) +
    shape("3", { properties: '<a:solidFill><a:srgbClr val="FF9C12"><a:alpha val="50000"/></a:srgbClr></a:solidFill>' }),
  }]))
  assert.deepEqual(profile.palette, [{ hex: "#FF9C12", usageCount: 1 }])
  assert.deepEqual(profile.primitives.find((object) => object.sourceRef.shapeId === "3")!.colors, [])
})

test("sampling observes object and UTF-8 budgets while preserving ancestors and honest coverage", async () => {
  const profile = await profilePptxBytes("large.pptx", await pptxFixture(Array.from({ length: 24 }, (_, index) => ({
    objects: Array.from({ length: index < 12 ? 24 : 50 }, (_, i) => shape(String(i + 2))).join("") +
      group("101", group("102", shape("103", { kind: "image" }))),
  }))))
  const input = buildQwenInput(profile)
  checkReferences(input)
  assert.equal(input.roots.length, 18)
  assert.ok(input.counts.objectsProvided <= QWEN_INPUT_LIMITS.objects)
  assert.ok(input.sourceSlides.every((slide) => slide.providedObjectCount <= QWEN_INPUT_LIMITS.objectsPerSlide))
  assert.ok(new TextEncoder().encode(JSON.stringify(input)).byteLength <= QWEN_INPUT_LIMITS.bytes)
  assert.equal(input.selection.truncated, true)
  assert.equal(input.selection.byteBudgetApplied, true)
  assert.ok(input.nodes.some((node) => node.type === "image"))
  assert.ok(input.nodes.some((node) => node.fullChildCount > node.children.length))
  assert.deepEqual(buildQwenInput(profile), input)
})

test("retry reparses legacy caches from source and reuses the current profile without a second read", async () => {
  const bytes = await pptxFixture([{ objects: shape("2") }])
  let reads = 0
  const readSource = async () => { reads += 1; return bytes }
  const upgraded = await restorePresentationProfile({ schemaVersion: "0.3.0", primitives: [] }, "cached.pptx", readSource)
  assert.equal(upgraded.schemaVersion, "0.3.1")
  assert.equal(upgraded.primitives[0]!.sourceRef.shapeId, "2")
  assert.equal(reads, 1)
  assert.equal(await restorePresentationProfile(upgraded, "cached.pptx", readSource), upgraded)
  assert.equal(reads, 1)
  checkReferences(buildQwenInput(upgraded))
})

test("the interchange schema rejects extra content and false precision for unknown geometry", async () => {
  const input = buildQwenInput(await profilePptxBytes("schema.pptx", await pptxFixture([{ objects: shape("2", { transform: "" }) }])))
  assert.throws(() => validateQwenInput({ ...input, slideText: SECRET }), /additional properties/)
  const broken = structuredClone(input)
  broken.nodes.find((node) => node.type === "text")!.bounds = { x: 0, y: 0, width: 0, height: 0 }
  assert.throws(() => validateQwenInput(broken), /must be null/)
})
