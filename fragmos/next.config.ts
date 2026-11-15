import type { NextConfig } from "next";

const sentinelUrl = process.env.SENTINEL_URL ?? "http://127.0.0.1:8787";
const engineRoutes = [
  "/api/events",
  "/api/stats",
  "/api/upstreams",
  "/api/approvals",
  "/api/approvals/:id",
  "/api/gateway",
  "/api/keys",
  "/api/keys/:id",
  "/ws",
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return engineRoutes.map((route) => ({ source: `/engine${route}`, destination: `${sentinelUrl}${route}` }));
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
