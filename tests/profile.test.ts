import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { validateProfile } from "../src/validate-profile.js";

test("the example profile satisfies the schema", async () => {
  const profile = JSON.parse(await fs.readFile("examples/template-profile-draft.example.json", "utf8"));
  await assert.doesNotReject(() => validateProfile(profile));
});

test("the schema rejects coordinates outside 0..1", async () => {
  const profile = JSON.parse(await fs.readFile("examples/template-profile-draft.example.json", "utf8"));
  profile.primitives[0].box.x = 1.5;
  await assert.rejects(() => validateProfile(profile), /must be <= 1/);
});

test("the schema rejects a primitive without provenance", async () => {
  const profile = JSON.parse(await fs.readFile("examples/template-profile-draft.example.json", "utf8"));
  delete profile.primitives[0].source;
  await assert.rejects(() => validateProfile(profile), /must have required property 'source'/);
});
