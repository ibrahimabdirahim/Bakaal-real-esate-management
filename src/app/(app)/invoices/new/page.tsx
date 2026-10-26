import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { Card, Notice, PageHeader } from "@/components/ui";
import { ManualInvoiceForm } from "./manual-invoice-form";
import { FilePlus2 } from "lucide-react";

export const metadata = { title: "Manual invoice" };

export default async function NewManualInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const actor = await requirePage("invoices.create_manual");
  const sp = await searchParams;
  const agreementId = typeof sp.agreementId === "string" ? sp.agreementId : null;
  const agreement = agreementId ? await db.agreement.findUnique({ where: { id: agreementId }, include: { unit: true, party: true } }) : null;
  const parties = await db.party.findMany({ where: { archivedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });

  return (
    <>
      <PageHeader icon={FilePlus2} title={agreement?.status === "ENDED" ? "Final settlement invoice" : "Create invoice"} back={{ href: "/invoices", label: "Invoices" }} />
      <div className="mb-4">
        <Notice tone="blue">
          Use only for charges that are authorised by an agreement or approved decision — for example a final settlement after an agreement ends. Do not invent late fees,
          proration or deposits. {can(actor.role, "invoices.issue_manual") ? "It is issued when you save it and adds to the account's outstanding balance; issued invoices are corrected with credit notes, never edited." : "The draft must then be reviewed and issued by a finance officer or administrator."}
        </Notice>
      </div>
      <Card>
        <ManualInvoiceForm
          parties={parties.map((p) => ({ value: p.id, label: p.displayName }))}
          defaultPartyId={typeof sp.partyId === "string" ? sp.partyId : ""}
          canIssue={can(actor.role, "invoices.issue_manual")}
          defaults={agreement ? { agreementId: agreement.id, unitId: agreement.unitId, partyId: agreement.partyId, label: `${agreement.type.toLowerCase()} agreement, unit ${agreement.unit.unitNumber} — ${agreement.party.displayName}` } : null}
        />
      </Card>
    </>
  );
}
