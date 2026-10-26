import { requirePage } from "@/server/auth/session";
import { db } from "@/server/db";
import { ButtonLink, Card, Notice, PageHeader } from "@/components/ui";
import { AgreementForm } from "../agreement-form";
import { createAgreementAction } from "../actions";
import { FileSignature } from "lucide-react";

export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({ searchParams }: PageProps<"/agreements/new">) {
  await requirePage("agreements.manage");
  const sp = await searchParams;
  const [units, parties] = await Promise.all([
    db.unit.findMany({ where: { isActive: true }, select: { id: true, unitNumber: true, unitType: true } }),
    db.party.findMany({ where: { archivedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
  ]);
  units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

  return (
    <>
      <PageHeader icon={FileSignature} title="New agreement" back={typeof sp.partyId === "string" ? { href: `/accounts/${sp.partyId}?tab=agreement`, label: "Account" } : { href: "/accounts", label: "Accounts" }} />
      {units.length === 0 || parties.length === 0 ? (
        <Notice>
          You need at least one unit and one account first.{" "}
          <span className="inline-flex gap-2"><ButtonLink variant="secondary" href="/units/new">Add unit</ButtonLink><ButtonLink variant="secondary" href="/accounts/new">Add account</ButtonLink></span>
        </Notice>
      ) : (
        <Card>
          <AgreementForm
            action={createAgreementAction}
            units={units.map((u) => ({ value: u.id, label: `${u.unitNumber}${u.unitType ? ` — ${u.unitType}` : ""}` }))}
            parties={parties.map((p) => ({ value: p.id, label: p.displayName }))}
            defaults={{ unitId: typeof sp.unitId === "string" ? sp.unitId : undefined, partyId: typeof sp.partyId === "string" ? sp.partyId : undefined }}
          />
        </Card>
      )}
    </>
  );
}
