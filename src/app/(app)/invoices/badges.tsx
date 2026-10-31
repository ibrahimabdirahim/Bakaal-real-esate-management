import { Badge, type BadgeTone } from "@/components/ui";
import type { InvoiceSummary } from "@/server/services/finance";

export function InvoiceStatusBadge({ s }: { s: Pick<InvoiceSummary, "paymentStatus" | "dueState"> }) {
  if (s.paymentStatus === "DRAFT") return <Badge tone="slate">Draft</Badge>;
  if (s.paymentStatus === "PAID") return <Badge tone="green">Paid</Badge>;
  const base = s.paymentStatus === "PART_PAID" ? "Part-paid" : "Unpaid";
  switch (s.dueState) {
    case "OVERDUE":
      return <Badge tone="red">{base} · overdue</Badge>;
    case "PAST_DUE_GRACE_UNKNOWN":
      return <Badge tone="red">{base} · past due</Badge>;
    case "WITHIN_GRACE":
      return <Badge tone="amber">{base} · in grace period</Badge>;
    default:
      return <Badge tone={s.paymentStatus === "PART_PAID" ? "blue" : "amber"}>{base}</Badge>;
  }
}

/**
 * The short status for the invoice list: Paid, Partial, Overdue (or Past due), Unpaid, Draft. The same
 * rules as InvoiceStatusBadge; its full wording (e.g. "Part-paid · in grace period") is the tooltip and
 * is shown on the invoice itself.
 */
export function InvoiceListStatus({ s }: { s: Pick<InvoiceSummary, "paymentStatus" | "dueState"> }) {
  const full =
    s.paymentStatus === "DRAFT" ? "Draft" : s.paymentStatus === "PAID" ? "Paid"
    : `${s.paymentStatus === "PART_PAID" ? "Part-paid" : "Unpaid"}${s.dueState === "OVERDUE" ? " · overdue" : s.dueState === "PAST_DUE_GRACE_UNKNOWN" ? " · past due" : s.dueState === "WITHIN_GRACE" ? " · in grace period" : ""}`;
  const [tone, text]: [BadgeTone, string] =
    s.paymentStatus === "DRAFT" ? ["slate", "Draft"]
    : s.paymentStatus === "PAID" ? ["green", "Paid"]
    : s.dueState === "OVERDUE" ? ["red", "Overdue"]
    : s.dueState === "PAST_DUE_GRACE_UNKNOWN" ? ["red", "Past due"]
    : s.paymentStatus === "PART_PAID" ? ["amber", "Partial"]
    : ["slate", "Unpaid"];
  return <span title={full}><Badge tone={tone}>{text}</Badge></span>;
}
