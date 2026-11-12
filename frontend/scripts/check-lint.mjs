// Lint ratchet: CI fails if the number of ESLint errors goes up.
// Lower .lint-baseline whenever errors are fixed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseline = Number(readFileSync(new URL("../.lint-baseline", import.meta.url), "utf8").trim());
let raw = "";
try {
  raw = execSync("npx eslint . -f json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  // Exit code 1 means lint errors were found (JSON is still printed); anything else means ESLint itself failed.
  if (e.status !== 1) {
    console.error(`ESLint did not run (exit code ${e.status}).
${e.stderr || e.message}`);
    process.exit(2);
  }
  raw = e.stdout || "";
}
let files;
try {
  files = JSON.parse(raw);
} catch {
  console.error(`ESLint printed no JSON report, so errors can't be counted.
${raw.slice(0, 2000)}`);
  process.exit(2);
}
const errors = files.flatMap((f) => f.messages.filter((m) => m.severity === 2).map((m) => `${f.filePath}:${m.line}  ${m.ruleId}  ${m.message}`));
console.log(`ESLint errors: ${errors.length} (allowed: ${baseline})`);
if (errors.length > baseline) {
  console.log(errors.join("\n"));
  console.error(`\nNew lint errors were introduced (${errors.length} > ${baseline}). Fix them before merging.`);
  process.exit(1);
}
if (errors.length < baseline) {
  console.log(`Nice: ${baseline - errors.length} fewer than the baseline. Lower .lint-baseline to ${errors.length}.`);
}
