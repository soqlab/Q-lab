const apiUrl = process.env.QLAB_API_URL || "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker production builds
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Pre-bundle large icon/component libraries so they're not compiled per-request
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  async rewrites() {
    return [
      {
        source: "/qlab-api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        // HTML pages — never cache so users always get the latest deploy
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        // Hashed static assets — cache forever (filename changes on each build)
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
