// Failed sign-ins per network address (audit 2026-10-29): after MAX_FAILURES failures within WINDOW_MS,
// further sign-ins from that address are refused until the window has passed. Defence in depth beside
// the per-account lockout: it also covers guesses spread over many (or unknown) e-mail addresses.
// Kept in this server's memory: suited to one server instance; it starts empty after a restart.

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES = 30;
const MAX_ADDRESSES = 10_000;

const failures = new Map<string, number[]>();

const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((t) => t > now - WINDOW_MS);

/** True while the address has had MAX_FAILURES failed sign-ins within the window. */
export function signInBlocked(key: string, now = Date.now()): boolean {
  return recent(key, now).length >= MAX_FAILURES;
}

export function recordSignInFailure(key: string, now = Date.now()) {
  const times = [...recent(key, now), now];
  failures.delete(key); // re-inserted last: the map stays ordered from least to most recently seen
  failures.set(key, times.slice(-MAX_FAILURES));
  while (failures.size > MAX_ADDRESSES) failures.delete(failures.keys().next().value!);
}

/**
 * The client's address as seen by the hosting proxy: the last X-Forwarded-For entry (the one the proxy
 * appends; earlier entries can be set by the client), else X-Real-IP, else "unknown" (local use).
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) || headers.get("x-real-ip")?.trim() || "unknown";
}

/** For tests only. */
export function resetSignInLimits() {
  failures.clear();
}
