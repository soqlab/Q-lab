// npm ci && npm run build  ->  frontend/public/vendor/qlab-pq-verify.js
// The output is committed, so neither the site nor the server needs this step; rebuild it when a
// version in package.json changes. Same pins as Morrow's verifier (tools/pq-verify-js there).
import { build } from "esbuild";

await build({
  entryPoints: ["entry.mjs"],
  outfile: "../../frontend/public/vendor/qlab-pq-verify.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: false,
  legalComments: "inline",
  banner: { js: "/* qlab-pq-verify: built by tools/pq-verify-js from @noble/post-quantum 0.7.1, @noble/curves 2.4.0 and @noble/hashes 2.4.0 (MIT, Paul Miller). Do not edit; rebuild. */" },
});
