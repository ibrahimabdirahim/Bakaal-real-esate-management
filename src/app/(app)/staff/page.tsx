import Link from "next/link";
import { Plus, UserCog } from "lucide-react";
import { RowActions, type RowAction } from "@/components/row-actions";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listStaff } from "@/server/services/operations";
import { Badge, ButtonLink, Card, FilterBar, FilterInput, FilterPills, FilterSubmit, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, optionalFromDbDate, todayISO } from "@/lib/dates";
import { StaffTabs } from "./staff-tabs";

export const metadata = { title: "Staff management" };


/** Staff Management: the staff list, with the other staff sections as tabs inside the page. */
export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const actor = await requirePage("staff.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = sp.status === "current" || sp.status === "former" ? sp.status : "";
  const today = todayISO();
  const all = await listStaff(actor);
  // Employment status comes from the end date (the existing way to record that someone left).
  const isFormer = (s: (typeof all)[number]) => !!s.endDate && optionalFromDbDate(s.endDate)! < today;
  const matching = all.filter((s) => !q || [s.fullName, s.position, s.phone ?? ""].some((v) => v.toLowerCase().includes(q.toLowerCase())));
  const staff = matching.filter((s) => (status === "current" ? !isFormer(s) : status === "former" ? isFormer(s) : true));
  const created = typeof sp.created === "string" ? all.find((s) => s.id === sp.created) : undefined;
  const showSalary = can(actor.role, "salary.view");
  const canManage = can(actor.role, "staff.manage");
  const withStatus = (st: string) => {
    const qs = new URLSearchParams(Object.entries({ status: st, q }).filter(([, v]) => v));
    return `/staff${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        icon={UserCog}
        title="Staff Management"
        description="Building service staff (cleaners, guards, caretakers): their records, salaries, payments and tasks. Staff are records, not system users; salary details are restricted."
        actions={canManage ? <ButtonLink href="/staff/new" icon={Plus}>Add Staff</ButtonLink> : null}
      />
      <StaffTabs actor={actor} current="staff" />
      {created && (
        <div className="mb-4">
          <Notice tone="green">
            {`${created.fullName} was added to the staff list.`} <Link href={`/staff/${created.id}`} className="font-medium underline">Open the staff record</Link>
          </Notice>
        </div>
      )}
      <FilterPills
        label="Employment status"
        items={[
          { href: withStatus(""), label: "All", count: matching.length, current: status === "" },
          { href: withStatus("current"), label: "Current", count: matching.filter((s) => !isFormer(s)).length, current: status === "current" },
          { href: withStatus("former"), label: "Former", count: matching.filter(isFormer).length, current: status === "former" },
        ]}
      />
      <Card>
        <FilterBar>
          {status && <input type="hidden" name="status" value={status} />}
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Name, occupation or phone" />
          <FilterSubmit />
        </FilterBar>
        <Table
          head={["Staff name", "Occupation", "Phone", "Status", ...(showSalary ? ["Agreed salary"] : []), "Joined", "Open tasks", <span key="a" className="sr-only">Actions</span>]}
          empty={q || status ? "No staff match these filters." : "No staff records yet."}
        >
          {staff.map((s) => (
            <tr key={s.id} className={isFormer(s) ? "opacity-60" : ""}>
              <Td><Link href={`/staff/${s.id}`} className="font-medium text-primary-600 hover:underline">{s.fullName}</Link></Td>
              <Td>{s.position}</Td>
              <Td>{s.phone ?? "—"}</Td>
              <Td>{isFormer(s) ? <Badge>Former</Badge> : <Badge tone="green">Current</Badge>}</Td>
              {showSalary && <Td><Money cents={s.salaryAmount} /></Td>}
              <Td>{formatDate(optionalFromDbDate(s.startDate))}</Td>
              <Td>{s.openTasks}</Td>
              <Td className="w-px text-right">
                <RowActions
                  label={`Actions for ${s.fullName}`}
                  items={[
                    { label: "View staff member", href: `/staff/${s.id}` },
                    ...(canManage
                      ? ([
                          { label: "Edit details", href: `/staff/${s.id}#edit` },
                          ...(isFormer(s) ? [] : [{ label: "Record leaving date", href: `/staff/${s.id}#edit` }]),
                          // Staff records are kept: salaries, tasks, documents and the audit log refer to them. Leaving = an end date.
                          { label: "Delete staff member", unavailable: "Staff records are kept for their salaries, tasks and history. Set an end date (Edit) when someone leaves." },
                        ] as RowAction[])
                      : []),
                  ]}
                />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
