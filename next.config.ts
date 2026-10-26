import type { NextConfig } from "next";

// Cache Components is off: every page in this internal financial system reads the
// signed-in session and live balances, so all routes render dynamically per request
// and money figures are never served from a cache.
const nextConfig: NextConfig = {
  // The development badge defaults to bottom-left, where it covers the sidebar's expand/collapse button.
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
  // Baseline security headers for every response. The CSP sets only frame-ancestors for now;
  // a full script policy needs nonces for Next.js inline scripts, a separate, tested change.
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
        ],
      },
    ];
  },
  
};

export default nextConfig;
