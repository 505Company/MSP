import fs from "node:fs/promises";
import { validateProfile } from "./validate-profile.js";

const profile = JSON.parse(await fs.readFile("examples/template-profile-draft.example.json", "utf8"));
await validateProfile(profile);
console.log("Example validates against TemplateProfileDraft schema.");
