// Money is handled as integer cents. Never use floating-point arithmetic on amounts.
// The database stores Decimal(14,2); values cross the boundary as strings.

export type Cents = number;

const MAX_CENTS = 999_999_999_999_99; // fits Decimal(14,2)

/** Parse a user-entered or database amount ("1,250.50", "1250.5", Decimal) into cents. */
export function toCents(value: string | number | { toString(): string }): Cents {
  const text = String(value).trim().replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Invalid amount: "${String(value)}"`);
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new Error("Amount is too large");
  return sign ? -cents : cents;
}

/** Like toCents but returns null instead of throwing. */
export function tryCents(value: string | null | undefined): Cents | null {
  if (value == null || value.trim() === "") return null;
  try {
    return toCents(value);
  } catch {
    return null;
  }
}

/** Convert cents to the "1234.50" string used for Decimal columns. */
export function centsToDecimalString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Display format, e.g. "KES 1,250.50". */
export function formatMoney(cents: Cents, currency = "KES"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${currency} ${whole}.${String(abs % 100).padStart(2, "0")}`;
}
