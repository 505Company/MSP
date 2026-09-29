import fs from "node:fs/promises"
import { Ajv2020 } from "ajv/dist/2020.js"

const schema = JSON.parse(await fs.readFile(new URL("../schemas/qwen-task-input.schema.json", import.meta.url), "utf8"))
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

/** Structural JSON Schema validation. Cross-reference invariants are tested at the adapter interface. */
export function validateQwenInput(input: unknown): void {
  if (!validate(input)) {
    const details = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n")
    throw new Error(`Qwen task input validation failed:\n${details}`)
  }
}
