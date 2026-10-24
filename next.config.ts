import type { NextConfig } from "next";

const securityHeaders = [
  // CSP is now generated dynamically per-request in lib/supabase/middleware.ts
  // using a cryptographic nonce instead of unsafe-inline for script-src.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  // Loaded from node_modules at runtime, not bundled: its per-framework
  // instrumentations dynamically require packages this app does not install
  // (e.g. @nestjs/core), which Turbopack treats as a build error.
  // server-util reaches React's client API (createContext), which the server
  // bundle's react-server build lacks; externalising it loads it through Node.
  // The editor schema must resolve to the same core the externalised
  // server-util loads, so core is externalised with it.
  serverExternalPackages: [
    "@opentelemetry/auto-instrumentations-node",
    "@blocknote/server-util",
    "@blocknote/core",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
