// Type-check ratchet: the build fails if the number of TypeScript errors goes up.
// Existing errors are in older Labs pages; lower .typecheck-baseline as they are fixed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseline = Number(readFileSync(new URL("../.typecheck-baseline", import.meta.url), "utf8").trim());
let output = "";
try {
  output = execSync("npx tsc --noEmit -p .", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  output = (e.stdout || "") + (e.stderr || "");
}
const errors = output.split("\n").filter((l) => l.includes("error TS"));
console.log(`TypeScript errors: ${errors.length} (allowed: ${baseline})`);
if (errors.length > baseline) {
  console.log(errors.join("\n"));
  console.error(`\nNew type errors were introduced (${errors.length} > ${baseline}). Fix them before merging.`);
  process.exit(1);
}
if (errors.length < baseline) {
  console.log(`Nice: ${baseline - errors.length} fewer than the baseline. Lower .typecheck-baseline to ${errors.length}.`);
}
