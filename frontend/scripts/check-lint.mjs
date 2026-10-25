// Lint ratchet: CI fails if the number of ESLint errors goes up.
// Existing errors are mostly React 19 hook-style rules in older Labs pages; lower .lint-baseline as
// they are fixed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseline = Number(readFileSync(new URL("../.lint-baseline", import.meta.url), "utf8").trim());
let raw = "";
try {
  raw = execSync("npx eslint . -f json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  raw = e.stdout || "";
}
const files = JSON.parse(raw || "[]");
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
