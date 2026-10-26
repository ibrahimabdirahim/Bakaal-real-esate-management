/** Slices a list for display and reports where the current page sits. */
export function paginate<T>(items: T[], pageParam: unknown, size = 25) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Number(typeof pageParam === "string" ? pageParam : 1);
  const page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  return { items: items.slice((page - 1) * size, page * size), page, pages, total };
}

/** The current search params as plain strings, without the page number (for pagination links). */
export function queryWithoutPage(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (k !== "page" && typeof v === "string" && v !== "") out[k] = v;
  return out;
}
