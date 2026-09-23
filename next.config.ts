import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Study PDF policy is 25MB (`STUDY_PDF_MAX_BYTES`). Next.js Server Actions
  // default to 1MB — that mismatch rejected valid Main Books PDFs with a
  // generic page/server error before app validation ran. Leave headroom for
  // multipart boundaries. App MIME/size checks remain authoritative.
  //
  // Next.js 16 also defaults `experimental.proxyClientMaxBodySize` to 10MB
  // (proxy/middleware body buffer). Bodies above that are truncated with
  // "Unexpected end of form" even when serverActions.bodySizeLimit is 26mb.
  experimental: {
    serverActions: {
      bodySizeLimit: "26mb",
    },
    proxyClientMaxBodySize: "26mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
