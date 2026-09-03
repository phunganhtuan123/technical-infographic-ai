import type { NextConfig } from "next";

// The connector is bound to loopback and is not reachable from a browser on its
// own: this app is served over HTTPS through a Cloudflare tunnel, which both
// hides port 47821 and makes any plain-http call to it mixed content. Proxying
// it under this origin solves all three at once — one hostname, one scheme, no
// CORS — and lets the connector stay loopback-only.
const connector = process.env.AI_CONNECTOR_INTERNAL_URL ?? "http://127.0.0.1:47821";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },

  async rewrites() {
    return [
      // Discovery is fetched from the origin root by contract, so it cannot be
      // moved under the prefix.
      { source: "/.well-known/technical-infographic-ai", destination: `${connector}/.well-known/technical-infographic-ai` },
      { source: "/ai-connector/:path*", destination: `${connector}/:path*` },
    ];
  },

  // Next marks prerendered HTML `s-maxage=31536000`, which is right for a CDN
  // and wrong for a browser that has to pick up a redeploy. The document is
  // cheap and must always be revalidated; the hashed asset filenames under
  // /_next/static already make those safe to keep forever.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/((?!_next/static).*)",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
