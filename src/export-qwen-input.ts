import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { profilePptxBytes, sha256 } from "../admin/lib/uploads/pptx-profiler.js"
import { buildQwenInput, buildQwenMessages } from "../admin/lib/uploads/qwen-input.js"
import { validateQwenInput } from "./validate-qwen-input.js"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "output/qwen-input" } },
})
if (positionals.length !== 1) {
  console.error("Usage: npm run profile:qwen -- <template.pptx> [--out <directory>]")
  process.exit(2)
}

const source = path.resolve(positionals[0]!)
const profile = await profilePptxBytes(path.basename(source), await fs.readFile(source))
const input = buildQwenInput(profile)
validateQwenInput(input)
// This is the exact compact JSON included in the model's user message.
const json = JSON.stringify(input)
const bytes = new TextEncoder().encode(json)
const manifest = {
  schemaVersion: "1.0.0",
  inputFile: "qwen-input.json",
  inputSchemaVersion: input.schemaVersion,
  promptVersion: input.task.promptVersion,
  sourceSha256: profile.source.sha256,
  inputSha256: await sha256(bytes),
  inputBytes: bytes.byteLength,
  counts: input.counts,
  modelCalled: false,
}
const directory = path.resolve(values.out!)
await fs.mkdir(directory, { recursive: true })
await fs.writeFile(path.join(directory, "qwen-input.json"), json, "utf8")
await fs.writeFile(path.join(directory, "qwen-messages.json"), JSON.stringify(buildQwenMessages(input), null, 2) + "\n", "utf8")
await fs.writeFile(path.join(directory, "qwen-input-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")
console.log(`Qwen input: ${path.join(directory, "qwen-input.json")}`)
console.log(`Slides: ${input.counts.slidesProvided}/${input.counts.slidesTotal}; objects: ${input.counts.objectsProvided}/${input.counts.objectsTotal}; bytes: ${bytes.byteLength}`)
console.log("Offline export complete. No model request was made.")
