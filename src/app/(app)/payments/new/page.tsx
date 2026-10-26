import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { PaymentForm } from "./payment-form";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { getInvoice } from "@/server/services/finance";
import { centsToDecimalString } from "@/lib/money";
import { Wallet } from "lucide-react";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  const actor = await requirePage("payments.record");
  const sp = await searchParams;
  const parties = await db.party.findMany({ where: { archivedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
  const oneStep = can(actor.role, "payments.verify") && can(actor.role, "payments.allocate");
  // From an invoice's "Record payment": its account and remaining balance (the amount stays editable).
  const invoiceId = typeof sp.invoiceId === "string" ? sp.invoiceId : null;
  const found = invoiceId && can(actor.role, "invoices.view") ? await getInvoice(actor, invoiceId) : null;
  const invoice = found && found.invoice.status === "ISSUED" && found.summary.balance > 0 ? { id: found.invoice.id, number: found.invoice.number, balance: centsToDecimalString(found.summary.balance), partyId: found.invoice.partyId } : null;
  return (
    <>
      <PageHeader icon={Wallet} title="Record payment" description={oneStep ? "Saved as received (verified) in one step. Enter how much goes to each open invoice; anything not allocated stays unallocated and reduces no invoice." : "The payment is saved as pending verification and changes no balance until it is verified. Once verified, it is allocated to the account's invoices on its page (the amounts you choose)."} back={{ href: "/payments", label: "Payments" }} />
      <Card>
        <PaymentForm parties={parties.map((p) => ({ value: p.id, label: p.displayName }))} partyId={invoice?.partyId ?? (typeof sp.partyId === "string" ? sp.partyId : "")} invoice={invoice} oneStep={oneStep} maxBytes={MAX_DOCUMENT_BYTES} showTerms={can(actor.role, "accounts.view") && can(actor.role, "agreements.view")} />
      </Card>
    </>
  );
}
