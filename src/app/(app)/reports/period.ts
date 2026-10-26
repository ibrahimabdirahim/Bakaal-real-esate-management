import { isISODate, monthStart, todayISO } from "@/lib/dates";

/** Reads a from/to period from search params, defaulting to the current month. */
export function readPeriod(sp: Record<string, string | string[] | undefined>) {
  const today = todayISO();
  const from = typeof sp.from === "string" && isISODate(sp.from) ? sp.from : monthStart(today);
  const to = typeof sp.to === "string" && isISODate(sp.to) ? sp.to : today;
  return from <= to ? { from, to } : { from: to, to: from };
}
