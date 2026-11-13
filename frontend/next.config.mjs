import { execFileSync } from "node:child_process";

const apiUrl = process.env.QLAB_API_URL || "http://127.0.0.1:8000";
// Set where the browser calls the backend directly (see app/layout.tsx); it must be allowed here.
const directApi = (process.env.NEXT_PUBLIC_QLAB_API_BASE || "").replace(/\/+$/, "");
// Single-container deploy (deploy/render-single): requests arriving on these host names are the
// backend's (the SDK posts runs to them), so they are passed through to the API untouched.
const backendHosts = (process.env.QLAB_BACKEND_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);

// The commit this build is made from (Render sets RENDER_GIT_COMMIT, GitHub Actions GITHUB_SHA).
// Shown in the app and on /trust so anyone can compare it with GitHub. Both values come from the
// commit, never the clock, so two builds of one commit stay identical.
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const rawCommit = (process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || git("rev-parse", "HEAD")).toLowerCase();
const commit = /^[0-9a-f]{40}$/.test(rawCommit) ? rawCommit : "";
const commitEpoch = commit ? git("show", "-s", "--format=%ct", commit) : "";
const commitTime = commitEpoch ? new Date(Number(commitEpoch) * 1000).toISOString().replace(".000Z", "Z") : "";

const isDev = process.env.NODE_ENV !== "production";

/**
 * The Content-Security-Policy sent with every page. Nothing outside this site may be loaded or
 * contacted, except the Q-Lab backend itself when NEXT_PUBLIC_QLAB_API_BASE points the browser at
 * it directly. scripts/check-no-third-party.mjs fails the build check if an outside origin appears.
 * 'unsafe-inline' for scripts: Next.js writes each page's data into inline <script> tags, and the
 * app adds two small inline scripts (theme and sign-in token). 'unsafe-eval' only in development,
 * where React's dev tools need it.
 */
export function contentSecurityPolicy() {
  const api = directApi ? ` ${directApi}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob:${api}`,
    `connect-src 'self'${api}`,
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is for the Docker image; Netlify (NETLIFY=true at build) brings its own runtime.
  output: process.env.NODE_ENV === "production" && !process.env.NETLIFY ? "standalone" : undefined,

  // The app does not use next/image, so the image optimiser (/_next/image, historically the
  // source of several critical Next.js advisories) stays off: less attack surface, nothing lost.
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },

  env: {
    NEXT_PUBLIC_QLAB_COMMIT: commit,
    NEXT_PUBLIC_QLAB_COMMIT_TIME: commitTime,
  },
  // The build ID is the commit, so it is the same for every build of that commit.
  ...(commit ? { generateBuildId: async () => commit } : {}),

  // Pre-bundle large icon/component libraries so they're not compiled per-request
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
    // AI answers and exports can run past the 30 s default when proxied to the backend.
    proxyTimeout: 300_000,
  },

  async rewrites() {
    const api = [
      {
        source: "/qlab-api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
    if (!backendHosts.length) return api;
    return {
      beforeFiles: [
        ...backendHosts.map((value) => ({
          source: "/:path*",
          has: [{ type: "host", value }],
          destination: `${apiUrl}/:path*`,
        })),
        // The platform health check reaches the container without a public host name.
        { source: "/health", destination: `${apiUrl}/health` },
      ],
      afterFiles: api,
    };
  },

  async headers() {
    return [
      {
        // All routes: security + no caching by default (not on backend host names: the API sets its own).
        // _next/static is left to Next.js, which serves those hashed files as immutable.
        source: "/((?!_next/static/).*)",
        ...(backendHosts.length ? { missing: backendHosts.map((value) => ({ type: "host", value })) } : {}),
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Links to other sites are not told which Q-Lab page they came from.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
      {
        source: "/videos/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
