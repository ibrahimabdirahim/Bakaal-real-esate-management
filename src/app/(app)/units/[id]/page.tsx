import Link from "next/link";
import { DocumentsCard } from "../../documents/documents-card";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getUnit, unitRegistration } from "@/server/services/property";
import { OCCUPANCY_LABELS } from "@/server/services/occupancy";
import { Badge, ButtonLink, Card, DescriptionList, Money, PageHeader, Table, Td } from "@/components/ui";
import { cents } from "@/server/services/common";
import { formatDate, fromDbDate, optionalFromDbDate } from "@/lib/dates";
import { UnitForm, type UnitFacts } from "../unit-form";
import { updateUnitAction } from "../actions";
import { occupancyTone } from "../labels";
import { AGREEMENT_TYPE_LABELS } from "../../agreements/labels";
import { StatusBadge } from "@/components/status";
import { Building2, CheckCircle2 } from "lucide-react";

export default async function UnitPage({ params, searchParams }: PageProps<"/units/[id]">) {
  const actor = await requirePage("units.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getUnit(actor, id);
  if (!data) notFound();
  const { unit, invoices, occupancy } = data;
  const canManage = can(actor.role, "units.manage");
  const canAgreements = can(actor.role, "agreements.view");
  const justCreated = sp.created === "1";
  const registration = justCreated ? await unitRegistration(actor) : null;
  // Occupancy follows the agreements; the edit form shows it but changes happen on the agreement.
  const facts: UnitFacts = {
    occupancy: OCCUPANCY_LABELS[occupancy],
    occupied: occupancy !== "VACANT",
  };

  return (
    <>
      <PageHeader icon={Building2}
        title={`Unit ${unit.unitNumber}`}
        back={{ href: "/units", label: "Units" }}
        description={<Badge tone={occupancyTone(occupancy)}>{OCCUPANCY_LABELS[occupancy]}</Badge>}
        actions={can(actor.role, "agreements.manage") ? <ButtonLink href={`/agreements/new?unitId=${unit.id}`}>New agreement</ButtonLink> : null}
      />
      {justCreated && (
        <div role="status" className="mb-6 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden /> Unit {unit.unitNumber} registered
          </p>
          <p className="mt-1 text-sm">
            {registration?.configured
              ? registration.overBy > 0
                ? `${registration.registered} units are now registered, ${registration.overBy} more than the building's total of ${registration.capacity}.`
                : `${registration.registered} of ${registration.capacity} units registered; ${registration.remaining} remaining to register.`
              : `${registration?.registered ?? 0} unit(s) registered. The building's total number of units is not set, so the remaining count is not shown.`}{" "}
            The unit is vacant until an agreement is recorded.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canManage && <ButtonLink variant="secondary" href="/units/new">Add another unit</ButtonLink>}
            <ButtonLink variant="secondary" href="/units">Back to Unit register</ButtonLink>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Details">
          <DescriptionList items={[["Floor", unit.floor], ["Type", unit.unitType], ["Notes / readiness", unit.notes], ["In use", unit.isActive ? "Yes" : "No (retired)"]]} />
        </Card>
        {canManage && (
          <Card title="Edit unit" id="edit" className="scroll-mt-20 xl:col-span-2">
            <UnitForm action={updateUnitAction.bind(null, unit.id)} unit={unit} facts={facts} cancelHref={`/units/${unit.id}`} />
          </Card>
        )}
      </div>

      {canAgreements && (
        <Card title="Agreements and occupancy history" className="mt-6">
          <Table head={["Type", "Account", "From", "To", "Rent / fee", "Status"]} empty="No agreements: the unit has always been vacant.">
            {unit.agreements.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/agreements/${a.id}`} className="text-primary-600 hover:underline">{AGREEMENT_TYPE_LABELS[a.type]}</Link></Td>
                <Td>{can(actor.role, "accounts.view") ? <Link href={`/accounts/${a.partyId}`} className="hover:underline">{a.party.displayName}</Link> : a.party.displayName}</Td>
                <Td>{formatDate(fromDbDate(a.startDate))}</Td>
                <Td>{formatDate(optionalFromDbDate(a.endDate))}</Td>
                <Td><Money cents={cents(a.rentAmount) ?? cents(a.managementFeeAmount)} /></Td>
                <Td><StatusBadge kind="agreement" status={a.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {invoices.length > 0 && (
        <Card title="Recent invoices" className="mt-6">
          <Table head={["Invoice", "Account", "Issued", "Total"]}>
            {invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></Td>
                <Td>{i.party.displayName}</Td>
                <Td>{formatDate(optionalFromDbDate(i.issueDate))}</Td>
                <Td><Money cents={cents(i.total)} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {can(actor.role, "workorders.view") && (
        <Card title="Maintenance" className="mt-6">
          <Table head={["Work order", "Title", "Priority", "Status"]} empty="No work orders for this unit.">
            {unit.workOrders.map((w) => (
              <tr key={w.id}>
                <Td><Link href={`/maintenance/${w.id}`} className="text-primary-600 hover:underline">{w.number}</Link></Td>
                <Td>{w.title}</Td>
                <Td>{w.priority}</Td>
                <Td>{w.status}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <DocumentsCard actor={actor} ownerType="UNIT" ownerId={unit.id} title="Unit documents" className="mt-6" slots={[{ category: "PHOTO", label: "Property photographs", multiple: true }, { category: "OTHER", multiple: true }]} />
    </>
  );
}
