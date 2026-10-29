import type { NextConfig } from "next";

// Cache Components is off: every page in this internal financial system reads the
// signed-in session and live balances, so all routes render dynamically per request
// and money figures are never served from a cache.
const nextConfig: NextConfig = {
  // The development badge defaults to bottom-left, where it covers the sidebar's expand/collapse button.
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
  // Baseline security headers for every response, static files included. The full Content-Security-Policy
  // (with a per-request nonce for scripts) is set by src/proxy.ts; frame-ancestors here also covers what
  // the proxy does not see (static files, document downloads).
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" }, // no embedding in other sites (clickjacking)
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          // Browsers apply this only over HTTPS (Render): always use HTTPS for this site for a year.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  
};

export default nextConfig;
