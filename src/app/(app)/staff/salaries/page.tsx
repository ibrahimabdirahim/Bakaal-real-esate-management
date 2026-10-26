import Link from "next/link";
import { BadgeDollarSign } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { salaryOverview } from "@/server/services/salaries";
import { ButtonLink, Card, FilterBar, FilterInput, FilterSubmit, Money, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StatusBadge } from "@/components/status";
import { centsToDecimalString } from "@/lib/money";
import { formatMonth, monthStart, todayISO } from "@/lib/dates";
import { setSalaryAction } from "../actions";
import { StaffTabs } from "../staff-tabs";
import { RowActions } from "@/components/row-actions";

export const metadata = { title: "Salary management" };

export default async function SalaryManagementPage({ searchParams }: PageProps<"/staff/salaries">) {
  const actor = await requirePage("salary.view");
  const sp = await searchParams;
  const thisMonth = monthStart(todayISO());
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : thisMonth;
  const o = await salaryOverview(actor, month);
  const canSet = can(actor.role, "salary.manage");
  const canRecord = canSet && can(actor.role, "expenses.submit") && o.isCurrentOrPast;
  const recorded = o.rows.filter((r) => r.record);

  return (
    <>
      <PageHeader
        icon={BadgeDollarSign}
        title="Salary Management"
        description="Agreed salaries of building staff and the salary payment recorded for each month. Salaries are monthly; no other frequency is supported."
        actions={<ButtonLink variant="secondary" href={`/staff/salary-payments?month=${month.slice(0, 7)}`}>Staff Payments for {formatMonth(month)}</ButtonLink>}
      />
      <StaffTabs actor={actor} current="salaries" />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat compact tone="brand" label="Agreed monthly salaries" value={<Money cents={o.agreedTotal} />} hint="Staff employed this month" />
        <Stat compact tone="amber" label="Not yet recorded" value={String(o.notRecorded)} hint={formatMonth(month)} />
        <Stat compact tone="blue" label="Recorded, not yet paid" value={<Money cents={recorded.filter((r) => r.record!.status !== "PAID").reduce((t, r) => t + r.record!.net, 0)} />} />
        <Stat compact tone="green" label="Paid" value={<Money cents={recorded.filter((r) => r.record!.status === "PAID").reduce((t, r) => t + r.record!.net, 0)} />} />
      </div>
      <Card>
        <FilterBar>
          <FilterInput label="Salary month" name="month" type="month" defaultValue={month.slice(0, 7)} max={thisMonth.slice(0, 7)} />
          <FilterSubmit label="Show" />
        </FilterBar>
        {!o.isCurrentOrPast && <Notice>Salaries cannot be recorded for a future month.</Notice>}
        <Table head={["Staff member", "Position", "Frequency", "Agreed salary", `${formatMonth(month)}`, "Last paid month", <span key="a" className="sr-only">Actions</span>]} empty="No staff were employed in this month.">
          {o.rows.map((r) => (
            <tr key={r.id}>
              <Td><Link href={`/staff/${r.id}`} className="font-medium text-primary-600 hover:underline">{r.fullName}</Link></Td>
              <Td>{r.position}</Td>
              <Td>Monthly</Td>
              <Td>
                {canSet ? (
                  <ActionForm action={setSalaryAction.bind(null, r.id)} className="flex items-center gap-2">
                    <input
                      name="salaryAmount"
                      inputMode="decimal"
                      aria-label={`Agreed monthly salary for ${r.fullName} (KES)`}
                      defaultValue={r.agreedSalary != null ? centsToDecimalString(r.agreedSalary) : ""}
                      placeholder="Not set"
                      className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                    />
                    <SubmitButton variant="secondary">Save</SubmitButton>
                  </ActionForm>
                ) : (
                  <Money cents={r.agreedSalary} />
                )}
              </Td>
              <Td>
                {r.record ? (
                  <Link href={`/staff/salary-payments/${r.record.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <StatusBadge kind="salary" status={r.record.status} /> <Money cents={r.record.net} />
                  </Link>
                ) : (
                  <span className="text-sm text-muted">Not recorded</span>
                )}
              </Td>
              <Td>{r.lastPaidMonth ? formatMonth(r.lastPaidMonth) : "—"}</Td>
              <Td className="w-px text-right">
                <RowActions
                  label={`Actions for ${r.fullName}`}
                  items={[
                    { label: "View staff member", href: `/staff/${r.id}` },
                    ...(r.record ? [{ label: `View ${formatMonth(month)} salary payment`, href: `/staff/salary-payments/${r.record.id}` }] : []),
                    ...(!r.record && canRecord && r.employed ? [{ label: `Record payment for ${formatMonth(month)}`, href: `/staff/salary-payments/new?staff=${r.id}&month=${month.slice(0, 7)}` }] : []),
                    { label: "View salary history", href: `/staff/salary-payments?staff=${r.id}` },
                    ...(canSet ? [{ label: "Edit agreed salary", unavailable: "Change it in this row and press Save; recorded salary payments keep their own amounts." }] : []),
                  ]}
                />
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">Changing an agreed salary only affects salary payments recorded afterwards; recorded payments keep their own amounts.</p>
      </Card>
    </>
  );
}
