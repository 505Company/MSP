import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { profilePptx } from "./profile-pptx.js";
import { renderReport } from "./report.js";
import { validateProfile } from "./validate-profile.js";

function usage(): never {
  console.error("Usage: npm run profile -- <template.pptx> [--out <directory>]");
  process.exit(2);
}

const args = process.argv.slice(2);
const inputPath = args[0];
if (!inputPath) usage();
const outFlag = args.indexOf("--out");
const outputDirectory = path.resolve(outFlag >= 0 ? args[outFlag + 1] ?? "output" : "output");

const result = await profilePptx(path.resolve(inputPath));
await validateProfile(result.profile);
await fs.mkdir(outputDirectory, { recursive: true });

const jsonPath = path.join(outputDirectory, "template-profile-draft.json");
const reportPath = path.join(outputDirectory, "report.html");
await fs.writeFile(jsonPath, `${JSON.stringify(result.profile, null, 2)}\n`, "utf8");
await fs.writeFile(reportPath, renderReport(result), "utf8");

console.log(`Profile: ${jsonPath}`);
console.log(`Report:  ${reportPath}`);
console.log(`Slides:  ${result.summary.slideCount}`);
console.log(`Objects: ${result.summary.objectCount}`);
console.log(`Colors:  ${(result.profile as any).tokens.colors.length}`);
console.log(`Type:    ${(result.profile as any).tokens.typography.length}`);
console.log(`Warnings:${(result.profile as any).warnings.length}`);
