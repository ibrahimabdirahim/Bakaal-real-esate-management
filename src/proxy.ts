import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: send visitors without a session cookie to the sign-in page.
// Every page and server action still validates the session and permissions on the server.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("bakaal_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Document uploads/downloads check the session themselves (and must not be buffered by the proxy);
  // the health check is public by design (it reveals nothing).
  matcher: ["/((?!login|api/documents|api/health|_next/static|_next/image|favicon.ico).*)"],
};
