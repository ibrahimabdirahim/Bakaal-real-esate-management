import type { StatementEntry } from "@/server/ledger";
import { formatMonth } from "@/lib/dates";

/** Billing month of an invoice entry ("Manual" for manual invoices; blank for payments). */
export function BillingPeriodCell({ entry }: { entry: StatementEntry }) {
  if (entry.kind !== "INVOICE" && entry.kind !== "CREDIT_NOTE") return <span className="text-slate-400">—</span>;
  return entry.billingPeriod ? <>{formatMonth(entry.billingPeriod)}</> : <span className="text-slate-500">Manual</span>;
}
