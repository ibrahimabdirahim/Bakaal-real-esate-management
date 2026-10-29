import Link from "next/link";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { previewBilling, registrationInvoices } from "@/server/services/billing";
import { Money, Notice } from "@/components/ui";
import { formatMonth, monthStart, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";

/**
 * After Add Account (F65): what the first billing did — the invoices issued with the account, or why
 * none was (recomputed now with the billing rules, so the reasons are the real ones).
 */
export async function FirstBillingNotice({ actor, partyId, outcome }: { actor: Actor; partyId: string; outcome: string }) {
  const month = monthStart(todayISO());
  if (outcome === "off") return null;
  if (outcome === "not-permitted") {
    return <div className="mb-6"><Notice tone="blue">{`No invoice was issued with the account: your role does not issue billing. Finance or an administrator bills ${formatMonth(month)} from Billing & Payments.`}</Notice></div>;
  }
  if (Number(outcome) > 0 && can(actor.role, "invoices.view")) {
    const issued = await registrationInvoices(actor, partyId);
    return (
      <div className="mb-6">
        <Notice tone="green">
          {`First invoice${issued.length === 1 ? "" : "s"} issued for ${formatMonth(month)}: `}
          {issued.map((i, n) => (
            <span key={i.id}>{n > 0 && ", "}<Link href={`/invoices/${i.id}`} className="font-medium underline">{i.number}</Link></span>
          ))}
          {" · total "}<Money cents={sumCents(issued.map((i) => i.total))} />
          {". Later billing runs for this month skip these charges."}
        </Notice>
      </div>
    );
  }
  if (!can(actor.role, "billing.preview")) return null;
  const p = await previewBilling(actor, month, { partyIds: [partyId] });
  const reasons = [...p.exceptions.map((e) => e.message), ...p.reviews.map((r) => r.message)];
  const text =
    reasons.length > 0
      ? `No invoice was issued for ${formatMonth(month)}: ${[...new Set(reasons)].join(" ")}`
      : p.nothingToBill.length > 0
        ? `No invoice was issued for ${formatMonth(month)}: the agreement has no charge to bill this month.`
        : `No invoice was issued for ${formatMonth(month)}: the agreement does not start this month. Its first invoice comes with the billing run for the month it starts.`;
  return <div className="mb-6"><Notice tone="amber">{text}</Notice></div>;
}
