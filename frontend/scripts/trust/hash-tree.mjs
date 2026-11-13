// The reproducible part of a Next.js build: prints the SHA-256 of every file the site serves or
// renders from, then one digest over that list. Two builds of one commit, in different
// directories, print the same digest (checked in .github/workflows/frontend-checks.yml; the digest
// is recorded in the deploy log by .github/workflows/transparency.yml).
//
//   node scripts/trust/hash-tree.mjs            # .next/static and .next/server, one line per file, then the digest
//   node scripts/trust/hash-tree.mjs --digest   # only the digest
//
// Left out on purpose: three files holding secrets Next.js generates fresh for every build (the
// server-actions encryption key and the preview-mode keys). They never reach a browser, and they
// must differ between builds. Also left out: .next/cache, traces, and the standalone copy.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || ".next";
const onlyDigest = process.argv.includes("--digest");
const DIRS = ["static", "server"];
const SECRETS = new Set(["server/server-reference-manifest.json", "server/server-reference-manifest.js", "server/preview-props.json"]);

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = DIRS.filter((d) => existsSync(join(root, d))).flatMap((d) => walk(join(root, d)));
if (!files.length) {
  console.error(`No build output under ${root}/ (run next build first).`);
  process.exit(2);
}
const lines = files
  .map((f) => relative(root, f).split(sep).join("/"))
  .filter((p) => !SECRETS.has(p))
  .sort()
  .map((p) => `${createHash("sha256").update(readFileSync(join(root, p))).digest("hex")}  ${p}`);
const digest = createHash("sha256").update(lines.join("\n") + "\n").digest("hex");
if (!onlyDigest) console.log(lines.join("\n"));
console.log(`${digest}  (${lines.length} files)`);
