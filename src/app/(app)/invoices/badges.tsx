import { Badge } from "@/components/ui";
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
