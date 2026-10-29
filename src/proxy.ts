import { NextResponse, type NextRequest } from "next/server";

// Runs before every page and API request (not static files, and not document uploads, which must not be
// buffered by the proxy and check the session themselves).
//  1. Content-Security-Policy with a fresh nonce: only this app's own scripts, carrying the nonce, may run
//     (Next.js adds the nonce to its scripts); no plugins, no other sites' forms, no embedding.
//  2. Optimistic sign-in check: visitors without a session cookie go to the sign-in page. Every page and
//     server action still validates the session and permissions on the server.
const PUBLIC = ["/login", "/api/health"];

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (charts, progress bars) need 'unsafe-inline' for styles; scripts never do.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has("bakaal_session")) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!api/documents|_next/static|_next/image|favicon.ico).*)"],
};
