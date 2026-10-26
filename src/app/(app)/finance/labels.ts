import type { StatementEntryKind } from "@/server/ledger";

export const LEDGER_KIND_LABELS: Record<StatementEntryKind, string> = {
  INVOICE: "Invoice",
  CREDIT_NOTE: "Credit note",
  PAYMENT: "Verified payment",
  PAYMENT_REVERSAL: "Payment reversal",
};
