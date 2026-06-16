const apiUrl = process.env.QLAB_API_URL || "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker production builds
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,

  // Run tsc separately; don't block the production build on ESLint
  eslint: { ignoreDuringBuilds: true },

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
};

export default nextConfig;
