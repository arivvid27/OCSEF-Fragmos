import type { NextConfig } from "next";

const sentinelUrl = process.env.SENTINEL_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/engine/:path*", destination: `${sentinelUrl}/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
