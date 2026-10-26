// Upload and discard requests change data, so they must come from Bakaal's own pages
// (the same check Next.js applies to server actions). The session cookie is SameSite=Lax too.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
