import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listAgreements } from "@/server/services/property";
import { cents } from "@/server/services/common";
import { ButtonLink, Card, FilterBar, FilterSelect, FilterSubmit, Money, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatDate, fromDbDate, optionalFromDbDate } from "@/lib/dates";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { AGREEMENT_TYPE_LABELS } from "./labels";
import { RowActions, type RowAction } from "@/components/row-actions";
import type { Actor } from "@/server/auth/actor";

export const metadata = { title: "Agreements" };

export default async function AgreementsPage({ searchParams }: PageProps<"/agreements">) {
  const actor = await requirePage("agreements.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "ACTIVE";
  const type = typeof sp.type === "string" ? sp.type : "";
  const { items: agreements, ...pg } = paginate(await listAgreements(actor, { status: status === "ALL" ? "" : status, type }), sp.page);

  return (
    <>
      <PageHeader
        title="Agreements"
        icon={FileSignature}
        back={{ href: "/accounts", label: "Accounts" }}
        description="Rental agreements, purchased-unit ownership records and management agreements, with their effective dates."
        actions={can(actor.role, "agreements.manage") ? <ButtonLink href="/agreements/new" icon={Plus}>New agreement</ButtonLink> : null}
      />
      <Card>
        <FilterBar>
          <FilterSelect label="Status" name="status" defaultValue={status} options={[{ value: "ACTIVE", label: "Active" }, { value: "ENDED", label: "Ended" }, { value: "CANCELLED", label: "Cancelled" }, { value: "ALL", label: "All" }]} />
          <FilterSelect label="Type" name="type" defaultValue={type} options={[{ value: "", label: "All types" }, ...Object.entries(AGREEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FilterSubmit />
        </FilterBar>
        <Table head={["Unit", "Account", "Type", "From", "To", "Rent / fee", "Due day", "Status", <span key="a" className="sr-only">Actions</span>]} empty="No agreements match these filters.">
          {agreements.map((a) => (
            <tr key={a.id}>
              <Td><Link href={`/units/${a.unitId}`} className="hover:underline">{a.unit.unitNumber}</Link></Td>
              <Td><Link href={`/accounts/${a.partyId}`} className="hover:underline">{a.party.displayName}</Link></Td>
              <Td><Link href={`/agreements/${a.id}`} className="font-medium text-primary-600 hover:underline">{AGREEMENT_TYPE_LABELS[a.type]}</Link></Td>
              <Td>{formatDate(fromDbDate(a.startDate))}</Td>
              <Td>{formatDate(optionalFromDbDate(a.endDate))}</Td>
              <Td><Money cents={cents(a.rentAmount) ?? cents(a.managementFeeAmount)} /></Td>
              <Td>{a.dueDay ?? <span className="text-slate-400">not set</span>}</Td>
              <Td><StatusBadge kind="agreement" status={a.status} /></Td>
              <Td className="w-px text-right"><RowActions label={`Actions for the ${AGREEMENT_TYPE_LABELS[a.type].toLowerCase()} of unit ${a.unit.unitNumber}`} items={agreementActions(actor, a)} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/agreements" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}

/**
 * Agreement terms are not edited (issued invoices depend on them): an agreement is ended, or cancelled
 * if entered in error; approved charges are added or ended on it (F54). Agreements are never deleted.
 */
function agreementActions(actor: Actor, a: { id: string; partyId: string; status: string }): RowAction[] {
  const href = `/agreements/${a.id}`;
  const items: RowAction[] = [{ label: "View agreement", href }, { label: "View account", href: `/accounts/${a.partyId}` }];
  const manage = can(actor.role, "agreements.manage") && a.status === "ACTIVE";
  if (manage) {
    items.push({ label: "Add or end a charge", href: `${href}#charges` });
    items.push({ label: "End agreement", href: `${href}#end` });
    items.push({ label: "Cancel (entered in error)", href: `${href}#cancel`, tone: "danger" });
  }
  items.push({ label: "Edit terms", unavailable: "Agreement terms are fixed once saved; end it and record a new agreement for new terms." });
  items.push({ label: "Delete agreement", unavailable: "Agreements are kept for their invoices and history; cancel one entered in error." });
  return items;
}
