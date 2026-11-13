// No tracking, provably: fails if the dashboard could make a request to anyone but Q-Lab.
//
//   1. The Content-Security-Policy that next.config.mjs sends may allow only this site ('self'),
//      inline data (data:, blob:) and, when NEXT_PUBLIC_QLAB_API_BASE is set, the Q-Lab backend.
//      The browser enforces it, so anything else is blocked even if code tried to load it.
//   2. The source (app/, components/, lib/, public/) may not load anything from another origin:
//      no <img>/<script>/<link>/<video>/<iframe> src, CSS url(), fetch, EventSource, WebSocket,
//      sendBeacon or new Image() with an outside http(s) address. Plain links (<a href>) are fine:
//      nothing is requested until the person clicks.
//   3. No analytics or session-recording package is a dependency.
//
// Run: node scripts/check-no-third-party.mjs   (exit 1 on any finding)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];

// ── 1. CSP ────────────────────────────────────────────────────────────────────
async function policyFor(apiBase) {
  const saved = { env: process.env.NODE_ENV, api: process.env.NEXT_PUBLIC_QLAB_API_BASE };
  process.env.NODE_ENV = "production";
  if (apiBase) process.env.NEXT_PUBLIC_QLAB_API_BASE = apiBase;
  else delete process.env.NEXT_PUBLIC_QLAB_API_BASE;
  // A fresh module instance per configuration (the query string defeats the import cache).
  const mod = await import(`${pathToFileURL(join(root, "next.config.mjs")).href}?api=${encodeURIComponent(apiBase || "")}`);
  process.env.NODE_ENV = saved.env;
  if (saved.api === undefined) delete process.env.NEXT_PUBLIC_QLAB_API_BASE;
  else process.env.NEXT_PUBLIC_QLAB_API_BASE = saved.api;
  const rules = await mod.default.headers();
  const values = rules.flatMap((r) => r.headers).filter((h) => h.key.toLowerCase() === "content-security-policy").map((h) => h.value);
  return values;
}

const KEYWORDS = new Set(["'self'", "'none'", "'unsafe-inline'", "data:", "blob:"]);

function checkPolicy(policy, apiBase, label) {
  const directives = Object.fromEntries(
    policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      return [name, sources];
    }),
  );
  if (!directives["default-src"] || directives["default-src"].join(" ") !== "'self'") {
    problems.push(`CSP (${label}): default-src must be exactly 'self'`);
  }
  for (const [name, sources] of Object.entries(directives)) {
    for (const s of sources) {
      if (KEYWORDS.has(s)) continue;
      if (apiBase && s === apiBase && (name === "connect-src" || name === "img-src")) continue;
      problems.push(`CSP (${label}): ${name} allows ${s}`);
    }
  }
  for (const name of ["object-src", "frame-src"]) {
    if ((directives[name] || []).join(" ") !== "'none'") problems.push(`CSP (${label}): ${name} must be 'none'`);
  }
}

const API = "https://qlab-backend.example.org";
const plain = await policyFor("");
const direct = await policyFor(API);
if (!plain.length) problems.push("next.config.mjs sends no Content-Security-Policy header");
for (const p of plain) checkPolicy(p, "", "default");
for (const p of direct) checkPolicy(p, API, "with NEXT_PUBLIC_QLAB_API_BASE");

// ── 2. Source scan ────────────────────────────────────────────────────────────
const EXT = /\.(tsx?|jsx?|mjs|css|json|html)$/;
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (EXT.test(name)) yield p;
  }
}

const URL_ = String.raw`["'\x60]\s*(?:https?:|wss?:)?\/\/`; // an absolute or protocol-relative address in quotes
const PATTERNS = [
  ["element source", new RegExp(String.raw`\b(?:src|srcSet|srcset|poster|data)\s*=\s*\{?\s*` + URL_)],
  ["<link> element", new RegExp(String.raw`<link\b[^>]*\bhref\s*=\s*\{?\s*` + URL_)],
  ["CSS url()", /url\(\s*["']?\s*(?:https?:)?\/\//],
  ["CSS @import", /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//],
  ["fetch()", new RegExp(String.raw`\bfetch\(\s*` + URL_)],
  ["EventSource", new RegExp(String.raw`new\s+EventSource\(\s*` + URL_)],
  ["WebSocket", new RegExp(String.raw`new\s+WebSocket\(\s*` + URL_)],
  ["sendBeacon", /\bsendBeacon\s*\(/],
  ["new Image()", /new\s+Image\s*\(/],
  ["importScripts", /\bimportScripts\s*\(/],
  ["manifest icon", /"src"\s*:\s*"(?:https?:)?\/\//],
];

for (const dir of ["app", "components", "lib", "public"]) {
  let walker;
  try { walker = [...files(join(root, dir))]; } catch { continue; }
  for (const file of walker) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [what, re] of PATTERNS) {
        if (re.test(line)) problems.push(`${relative(root, file)}:${i + 1}  ${what} loads from another site: ${line.trim().slice(0, 140)}`);
      }
    });
  }
}

// ── 3. Dependencies ───────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const TRACKERS = /(^|\/)(analytics|react-ga|ga4|gtag|posthog|mixpanel|segment|amplitude|plausible|fathom|hotjar|fullstory|logrocket|heap|clarity|sentry|datadog|newrelic|matomo|umami|@vercel\/analytics|@vercel\/speed-insights)/i;
for (const d of deps) if (TRACKERS.test(d)) problems.push(`package.json: ${d} looks like an analytics or monitoring package`);

if (problems.length) {
  console.error(`No-third-party check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`No-third-party check passed: CSP allows only this site${direct.length ? " (and the Q-Lab API when configured)" : ""}; no outside resource loads in app/, components/, lib/, public/; no analytics packages.`);
