import assert from "node:assert/strict"
import test from "node:test"
import { buildDesignSystemDraft } from "../admin/lib/uploads/design-system.js"
import { profilePptxBytes } from "../admin/lib/uploads/pptx-profiler.js"
import { group, pptxFixture, shape } from "./fixtures/qwen-pptx.js"

test("a draft remains available without Qwen and every observation refers to a source object", async () => {
  const profile = await profilePptxBytes("example.pptx", await pptxFixture([
    { objects: shape("1") + shape("2", { kind: "image" }) },
    { objects: shape("1"), hidden: true },
  ]))
  const draft = buildDesignSystemDraft(profile)
  assert.equal(draft.status, "draft")
  assert.equal(draft.analysis, null)
  assert.equal(draft.coverage.hiddenSlides, 1)
  assert.equal(draft.repeatedElements.length, 1)
  assert.equal(draft.repeatedElements[0].slideCount, 2)
  const ids = new Set(profile.primitives.map((object) => object.id))
  for (const item of [...draft.colors, ...draft.typography, ...draft.repeatedElements]) {
    assert.ok(item.occurrences.length > 0)
    for (const occurrence of item.occurrences) assert.ok(ids.has(occurrence.objectId))
  }
  assert.deepEqual(draft.colors.map((item) => item.hex), profile.palette.map((item) => item.hex))
})

test("repeated objects on a single slide are not persistent elements; incomplete groups are not complete layouts", async () => {
  const profile = await profilePptxBytes("groups.pptx", await pptxFixture([
    { objects: shape("1") + shape("2") },
    { objects: group("3", shape("4")) },
    { objects: group("3", shape("4")) },
  ]))
  const draft = buildDesignSystemDraft(profile)
  assert.equal(draft.repeatedElements.length, 0)
  assert.deepEqual(draft.layouts.map((layout) => layout.slideIndices), [[0]])
})
