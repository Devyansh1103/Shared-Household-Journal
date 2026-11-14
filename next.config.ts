import type { NextConfig } from "next";
import { checkPublicSecrets, describeProblems } from "./src/lib/env";

// A secret in a NEXT_PUBLIC_ variable would be compiled into every browser's
// JavaScript, so the build stops here instead (roadmap Phase 18).
const secrets = checkPublicSecrets(process.env);
if (!secrets.ok) throw new Error(describeProblems(secrets.problems));

const isDev = process.env.NODE_ENV === "development";

// Content Security Policy without nonces: nonces need every page rendered per
// request, which Partial Prerendering (cacheComponents) can't do. The browser
// talks only to this origin (Supabase is called from the server), so
// everything is 'self'. Next.js's own inline scripts and styles need
// 'unsafe-inline'; React needs 'unsafe-eval' in development only.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Older browsers' equivalent of frame-ancestors 'none': no framing.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Invite links carry their token in the path: never send it elsewhere.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore it over plain HTTP (local development).
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
