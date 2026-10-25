const apiUrl = process.env.QLAB_API_URL || "http://127.0.0.1:8000";
// Set where the browser calls the backend directly (see app/layout.tsx); it must be allowed here.
const directApi = (process.env.NEXT_PUBLIC_QLAB_API_BASE || "").replace(/\/+$/, "");
// Single-container deploy (deploy/render-single): requests arriving on these host names are the
// backend's (the SDK posts runs to them), so they are passed through to the API untouched.
const backendHosts = (process.env.QLAB_BACKEND_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is for the Docker image; Netlify (NETLIFY=true at build) brings its own runtime.
  output: process.env.NODE_ENV === "production" && !process.env.NETLIFY ? "standalone" : undefined,

  eslint: { ignoreDuringBuilds: true },

  // The app does not use next/image. Turning the optimiser off closes /_next/image, the
  // endpoint behind several critical Next.js advisories (remote code execution via SVG/AVIF).
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },

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
        // All routes: security + no caching by default (not on backend host names: the API sets its own)
        source: "/:path*",
        ...(backendHosts.length ? { missing: backendHosts.map((value) => ({ type: "host", value })) } : {}),
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https://buildlist.io https://betalist.com https://peerpush.com",
              directApi ? `connect-src 'self' ${directApi}` : "connect-src 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
      {
        // Hashed static assets override the above — cache forever
        // (safe because _next/static filenames change on every build)
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
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
