// CSV for the report exports (opens in Excel).

/** One cell: quoted when needed; text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Prevent spreadsheet formula injection, but leave plain numbers (e.g. a negative reversal amount) as numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole file, with a byte-order mark so Excel reads it as UTF-8. */
export function toCsv(head: string[], rows: unknown[][]): string {
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
