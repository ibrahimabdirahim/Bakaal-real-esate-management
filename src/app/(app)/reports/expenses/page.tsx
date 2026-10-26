import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { StatusBadge } from "@/components/status";
import { expenseReport } from "@/server/services/reports";
import { Card, FilterBar, FilterInput, FilterSubmit, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { ReportActions } from "../report-tools";
import { readPeriod } from "../period";
import { EXPENSE_CATEGORY_LABELS } from "../../expenses/labels";
import { Receipt } from "lucide-react";

export const metadata = { title: "Expense report" };

export default async function ExpenseReportPage({ searchParams }: PageProps<"/reports/expenses">) {
  const actor = await requirePage("reports.financial");
  const { from, to } = readPeriod(await searchParams);
  const r = await expenseReport(actor, from, to);

  return (
    <>
      <PageHeader icon={Receipt} title="Expenses" description={`Costs approved for ${formatDate(from)} – ${formatDate(to)}, by service month (or the day recorded when there is no service period). Approval is not payment: paid amounts are shown separately, by payment date.`} back={{ href: "/reports", label: "Reports" }} actions={<ReportActions exportHref={`/reports/export/expenses?from=${from}&to=${to}`} />} />
      {r.salariesHidden && <div className="mb-4"><Notice tone="blue">Salary expenses are excluded because your role does not include salary access.</Notice></div>}
      <Card>
        <div className="no-print"><FilterBar><FilterInput label="From" name="from" type="date" defaultValue={from} /><FilterInput label="To" name="to" type="date" defaultValue={to} /><FilterSubmit /></FilterBar></div>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Building running costs: <strong><Money cents={r.runningCosts} /></strong></span>
          {!r.salariesHidden && <span>Staff salaries: <strong><Money cents={r.salaries} /></strong></span>}
          <span>Approved, not yet paid: <strong><Money cents={r.approvedUnpaid} /></strong></span>
          <span>Paid out in this period (by payment date): <strong><Money cents={r.paidInPeriod} /></strong></span>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {r.byCategory.map((c) => <span key={c.category}>{EXPENSE_CATEGORY_LABELS[c.category]}: <strong><Money cents={c.total} /></strong></span>)}
          <span>Costs approved: <strong><Money cents={r.total} /></strong></span>
        </div>
        <Table head={["Number", "Service month / date", "Recorded", "Paid on", "Category", "Payee", "Description", "Status", "Amount"]} empty="No approved expenses in this period.">
          {r.rows.map((e) => (
            <tr key={e.number}>
              <Td><Link href={e.href} className="text-primary-600 hover:underline">{e.number}</Link></Td>
              <Td>{formatDate(e.date)}</Td>
              <Td>{formatDate(e.recordedDate)}</Td>
              <Td>{formatDate(e.paidDate)}</Td>
              <Td>{EXPENSE_CATEGORY_LABELS[e.category]}</Td>
              <Td>{e.payee}</Td>
              <Td wrap>{e.description}</Td>
              <Td><StatusBadge kind="expense" status={e.status} /></Td>
              <Td><Money cents={e.amount} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
