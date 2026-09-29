import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject } from "ajv";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "../schemas/template-profile-draft.schema.json");

export async function validateProfile(profile: unknown): Promise<void> {
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  type FormatsPlugin = (instance: Ajv2020) => Ajv2020;
  const addFormats = (addFormatsModule as unknown as { default?: FormatsPlugin }).default
    ?? (addFormatsModule as unknown as FormatsPlugin);
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(profile)) {
    const message = (validate.errors ?? [])
      .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`)
      .join("\n");
    throw new Error(`TemplateProfileDraft validation failed:\n${message}`);
  }
}
