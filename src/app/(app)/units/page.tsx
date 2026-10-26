import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { findBuilding } from "@/server/services/common";
import { listUnits, unitRegistration } from "@/server/services/property";
import { RegistrationProgress } from "./registration-progress";
import { OCCUPANCY_LABELS, type Occupancy } from "@/server/services/occupancy";
import { Badge, ButtonLink, Card, FilterBar, FilterInput, FilterSelect, FilterSubmit, Money, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { occupancyTone } from "./labels";
import { RowActions, type RowAction } from "@/components/row-actions";
import { NoBuilding } from "@/components/no-building";
import type { Actor } from "@/server/auth/actor";

export const metadata = { title: "Units" };

export default async function UnitsPage({ searchParams }: PageProps<"/units">) {
  const actor = await requirePage("units.view");
  if (!(await findBuilding())) return <NoBuilding actor={actor} title="Unit register" />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const occupancy = (typeof sp.occupancy === "string" ? sp.occupancy : "") as Occupancy | "";
  const [all, registration] = await Promise.all([listUnits(actor, { q, occupancy }), unitRegistration(actor)]);
  const { items: units, ...pg } = paginate(all, sp.page);
  const showRent = can(actor.role, "agreements.view");
  const linkAccounts = can(actor.role, "accounts.view");
  const person = (p: { id: string; displayName: string } | null) =>
    !p ? "—" : linkAccounts ? <Link className="hover:underline" href={`/accounts/${p.id}`}>{p.displayName}</Link> : p.displayName;

  return (
    <>
      <PageHeader
        title="Unit register"
        icon={Building2}
        description="Every unit with its current occupancy, derived from the agreements in force today."
        actions={can(actor.role, "units.manage") ? <ButtonLink href="/units/new" icon={Plus}>Add unit</ButtonLink> : null}
      />
      <RegistrationProgress progress={registration} canConfigure={can(actor.role, "settings.manage")} canAddUnits={can(actor.role, "units.manage")} className="mb-6" />
      <Card>
        <FilterBar>
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Unit number or type" />
          <FilterSelect label="Status" name="occupancy" defaultValue={occupancy} options={[{ value: "", label: "All units" }, ...Object.entries(OCCUPANCY_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FilterSubmit />
        </FilterBar>
        <Table head={["Unit", "Floor", "Type", "Status", "Tenant", "Owner", ...(showRent ? ["Monthly rent"] : []), <span key="a" className="sr-only">Actions</span>]} empty={q || occupancy ? "No units match these filters." : "No units yet. Add the building's units to get started."}>
          {units.map((u) => (
            <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
              <Td>
                <Link href={`/units/${u.id}`} className="font-medium text-primary-600 hover:underline">{u.unitNumber}</Link>
                {!u.isActive && <span className="ml-2 text-xs text-slate-500">(retired)</span>}
              </Td>
              <Td>{u.floor ?? "—"}</Td>
              <Td>{u.unitType ?? "—"}</Td>
              <Td><Badge tone={occupancyTone(u.occupancy)}>{OCCUPANCY_LABELS[u.occupancy]}</Badge></Td>
              <Td>{person(u.tenant)}</Td>
              <Td>{person(u.owner)}</Td>
              {showRent && <Td><Money cents={u.monthlyRent} /></Td>}
              <Td className="w-px text-right"><RowActions label={`Actions for unit ${u.unitNumber}`} items={unitActions(actor, u)} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/units" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}

/** Units are never deleted (agreements, invoices and work orders refer to them): a unit no longer used is retired (F54). */
function unitActions(actor: Actor, u: { id: string; unitNumber: string; isActive: boolean }): RowAction[] {
  const href = `/units/${u.id}`;
  const items: RowAction[] = [{ label: "View unit", href }];
  if (can(actor.role, "units.manage")) {
    items.push({ label: "Edit unit", href: `${href}#edit` });
    items.push(u.isActive ? { label: "Retire unit", href: `${href}#edit` } : { label: "Return to use", href: `${href}#edit` });
  }
  if (u.isActive && can(actor.role, "agreements.manage")) items.push({ label: "New agreement", href: `/agreements/new?unitId=${u.id}` });
  items.push({ label: "Delete unit", unavailable: "Units are kept for their agreements, invoices and work orders. Retire a unit that is no longer used." });
  return items;
}
