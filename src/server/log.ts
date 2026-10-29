// Structured logging (audit 2026-10-29): one JSON object per line on stdout/stderr, which Render's log
// viewer keeps and can search. Never log request bodies, cookies, tokens, passwords or connection
// strings: callers pass only what is needed to find the problem.
//
// Error alerts: when ERROR_ALERT_WEBHOOK_URL is set, every logged error is also POSTed there as JSON
// ({ text, level, msg, ... }), so any alerting tool that accepts a webhook can be connected without code.

type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

/** The parts of an error that are safe to log (no request data). Stack traces stay server-side. */
export function errorFields(e: unknown): Fields {
  if (e instanceof Error) {
    const digest = "digest" in e ? String((e as { digest?: unknown }).digest) : undefined;
    return { errorName: e.name, errorMessage: redact(e.message), digest, stack: e.stack ? redact(e.stack.split("\n").slice(0, 6).join(" | ")) : undefined };
  }
  return { errorMessage: redact(String(e)) };
}

/** Removes anything that looks like a connection string or a credential from a message. */
export function redact(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^:\s/@]+:[^@\s]+@/gi, "$1://****:****@")
    .replace(/\b(password|secret|token|apikey|api_key|authorization)=([^&\s]+)/gi, "$1=****");
}

export function log(level: Level, msg: string, fields: Fields = {}) {
  const entry = { time: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (level === "error") void alert(entry);
}

async function alert(entry: Record<string, unknown>) {
  const url = process.env.ERROR_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `BAKAAL error: ${entry.msg}${entry.errorMessage ? ` — ${entry.errorMessage}` : ""}`, ...entry }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // An alert that cannot be delivered must never break the request; the log line above remains.
  }
}
