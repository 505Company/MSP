import assert from "node:assert/strict"
import test from "node:test"
import { checkpointContext, analyzeCheckpoint, CHECKPOINT } from "../lib/digital-designer/pipeline"
import { validateCandidateSubset } from "../lib/digital-designer/design-analysis"
import { buildQwenInput } from "../lib/uploads/qwen-input"
import type { ParsedPresentation } from "../lib/uploads/pptx-profiler"

const profile: ParsedPresentation = {
  schemaVersion: "0.3.1", source: { fileName: "synthetic.pptx", sha256: "a".repeat(64), sizeBytes: 10, slideCount: 2, slideSizeEmu: { width: 160, height: 90 } }, generatedAt: "2026-09-24",
  palette: [{ hex: "#123456", usageCount: 2 }], typography: [], warnings: [],
  slides: [0, 1].map(i => ({ id: `slide-${i}`, sourcePart: `ppt/slides/slide${i + 1}.xml`, slideIndex: i, hidden: false, children: [`object-${i}`], objectCount: 1, kinds: { shape: 1 }, roles: { unknown: 1 } })),
  primitives: [0, 1].map(i => ({ id: `object-${i}`, rootId: `slide-${i}`, parentId: `slide-${i}`, children: [], sourceRef: { part: `ppt/slides/slide${i + 1}.xml`, shapeId: "1", elementPath: "sp/1" }, identityMethod: "shape_id", slideIndex: i, kind: "shape", role: "unknown", roleBasis: "heuristic", box: { x: 0, y: 0, width: 1, height: 1 }, colors: ["#123456"], typography: [], geometryResolved: true, geometryReason: null })),
}
const input = buildQwenInput(profile)
const { refs, context } = checkpointContext(input)
function response() {
  const categoryId = [...refs.categoryIds][0]
  return { schemaVersion: 1, sourceId: refs.sourceId, summary: "Синтетический пример",
    findings: [{ id: "color", categoryId, name: "Цвет", kind: "token", value: "#123456", role: "Основной", confidence: 0.9, reviewStatus: "candidate", evidence: { basis: "measured", slideIds: ["s1"], elementIds: ["s1-e1"], assetIds: [] }, transforms: { allowed: [], forbidden: [], unknown: [] } }],
    photoStyle: { status: "insufficient_evidence", variants: [], limitations: ["Нет превью"] }, coverage: [...refs.categoryIds].map(categoryId => ({ categoryId, status: "not_assessed", note: "Нет данных" })), uncertainties: ["Нет рендера"] }
}
test("checkpoint aliases retain source identity and slide boundaries", () => {
  assert.equal(context.sourceMap["s1-e1"], "object-0")
  assert.equal(context.sourceMap["s2-e2"], "object-1")
  assert.equal(refs.visualSlideIds.size, 0)
  assert.equal(validateCandidateSubset(response(), refs).result.findings.length, 1)
})
test("invalid evidence is quarantined without discarding valid candidates", () => {
  const raw = response()
  raw.findings.push({ ...raw.findings[0], id: "bad", evidence: { ...raw.findings[0].evidence, elementIds: ["invented"] } })
  const checked = validateCandidateSubset(raw, refs)
  assert.equal(checked.proposedCount, 2)
  assert.equal(checked.result.findings.length, 1)
  assert.equal(checked.rejected[0].reason, "analysis-unknown-reference")
})
test("cross-slide molecules and unseen visual evidence never pass", () => {
  const raw = response()
  raw.findings[0].kind = "molecule"
  raw.findings[0].evidence.elementIds = ["s1-e1", "s2-e2"]
  assert.throws(() => validateCandidateSubset(raw, refs), /no-valid-candidates/)
  const visual = response(); visual.findings[0].evidence.basis = "visual_observation"
  assert.throws(() => validateCandidateSubset(visual, refs), /no-valid-candidates/)
})
test("wrong sources and incomplete category coverage are rejected", () => {
  const raw = response(); raw.sourceId = "b".repeat(64)
  assert.throws(() => validateCandidateSubset(raw, refs), /wrong-source/)
  const partial = response(); partial.coverage.pop()
  assert.throws(() => validateCandidateSubset(partial, refs), /incomplete-coverage/)
})
test("live pipeline sends colleague schema and returns validated checkpoint metadata", async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    const request = JSON.parse(String(options?.body))
    assert.equal(request.response_format.json_schema.name, "design_analysis")
    assert.equal(request.messages[1].content.includes("synthetic.pptx"), false)
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response()) } }] })
  }
  try {
    const result = await analyzeCheckpoint(input, { apiKey: "test-only" })
    assert.equal(result.status, "analyzed")
    if (result.status === "analyzed") { assert.equal(result.checkpoint.checkpoint, CHECKPOINT); assert.equal(result.checkpoint.visualAnalysis, false) }
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})
test("no key performs no model request", async () => {
  assert.deepEqual(await analyzeCheckpoint(input, {}), { status: "not_configured" })
})
