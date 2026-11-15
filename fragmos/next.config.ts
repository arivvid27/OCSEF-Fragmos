import type { NextConfig } from "next";

const sentinelUrl = process.env.SENTINEL_URL ?? "http://127.0.0.1:8787";
// The engine routes lib/monitor/api.ts calls. The agent's /v1/messages stays off the web app's port.
const monitorRoutes = ["/api/events", "/api/stats", "/api/upstreams", "/api/approvals", "/api/approvals/:id", "/ws"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return monitorRoutes.map((route) => ({ source: `/engine${route}`, destination: `${sentinelUrl}${route}` }));
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
