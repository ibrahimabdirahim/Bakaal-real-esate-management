import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { canDecideExpense, listStaff } from "@/server/services/operations";
import { listSalaryPayments, SALARY_STATUSES, type SalaryRow, type SalaryStatus } from "@/server/services/salaries";
import { ButtonLink, Card, FilterBar, FilterInput, FilterPills, FilterSelect, FilterSubmit, Money, Notice, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/row-actions";
import { StatusBadge } from "@/components/status";
import { formatDate, formatMonth, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import type { Actor } from "@/server/auth/actor";
import { METHOD_LABELS } from "../../payments/labels";
import { StaffTabs } from "../staff-tabs";
import { approveSalaryAction, deleteSalaryDraftAction } from "./actions";
import { APPROVALS, currentListPath } from "@/lib/approval";
import { approveAction, deleteAction } from "@/components/row-action-items";

export const metadata = { title: "Staff payments" };

/**
 * The Actions for a salary payment, as the current user may take them (F54). Approving is one
 * confirmation in place (F61); rejecting (needs a reason) and recording the payment open the record's
 * page. Only drafts are edited or deleted; the server checks everything again.
 */
function salaryActions(r: SalaryRow, actor: Actor, listPath: string): RowAction[] {
  const page = `/staff/salary-payments/${r.id}`;
  const canRecord = can(actor.role, "salary.manage") && can(actor.role, "expenses.submit");
  const items: RowAction[] = [{ label: "View salary payment", href: page }];
  if (r.status === "SUBMITTED" && canDecideExpense(actor, { category: "SALARIES", createdById: r.createdById, submittedById: r.submittedById })) {
    items.push(approveAction("Approve", approveSalaryAction.bind(null, r.id), "salary", listPath));
    items.push({ label: "Reject", href: `${page}#decide`, tone: "danger" });
  }
  if (r.status === "APPROVED" && can(actor.role, "expenses.pay")) items.push({ label: "Record payment", href: `${page}#pay` });
  if (r.status === "DRAFT" && canRecord) {
    items.push({ label: "Edit draft", href: `${page}#edit` });
    items.push(deleteAction("Delete draft", deleteSalaryDraftAction.bind(null, r.id), "draft salary payment"));
  } else {
    items.push({ label: "Edit", unavailable: "Only a draft is edited. A submitted salary payment keeps its amounts; a rejected one is corrected with a new copy." });
    items.push({ label: "Delete", unavailable: "Submitted, approved, paid and rejected salary payments are kept for the record." });
  }
  if (r.status === "REJECTED" && canRecord) items.push({ label: "Record a corrected copy", href: `/staff/salary-payments/new?copy=${r.id}` });
  return items;
}

/** Staff Payments: every salary record with its status, and the next step for each. */
export default async function StaffPaymentsPage({ searchParams }: PageProps<"/staff/salary-payments">) {
  const actor = await requirePage("salary.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const staffMemberId = str("staff");
  const month = /^\d{4}-\d{2}$/.test(str("month")) ? `${str("month")}-01` : "";
  const status = (SALARY_STATUSES as readonly string[]).includes(str("status")) ? (str("status") as SalaryStatus) : undefined;
  const q = str("q").trim().toLowerCase();
  const [{ rows: inPeriod }, staff] = await Promise.all([listSalaryPayments(actor, { staffMemberId: staffMemberId || undefined, month: month || undefined }), listStaff(actor)]);
  // Search by staff member, salary payment number or payment reference.
  const matching = inPeriod.filter((r) => !q || [r.staff?.fullName ?? r.payee, r.number, r.paymentReference ?? ""].some((v) => v.toLowerCase().includes(q)));
  const rows = status ? matching.filter((r) => r.status === status) : matching;
  const { items, ...pg } = paginate(rows, sp.page);
  const canRecord = can(actor.role, "salary.manage") && can(actor.role, "expenses.submit");
  const recorded = str("recorded") ? inPeriod.find((r) => r.id === str("recorded")) : undefined;
  const withStatus = (st: string) => {
    const qs = new URLSearchParams(Object.entries({ status: st, staff: staffMemberId, month: str("month"), q: str("q") }).filter(([, v]) => v));
    return `/staff/salary-payments${qs.size ? `?${qs}` : ""}`;
  };
  const pills = [
    { status: "", label: "All" },
    { status: "SUBMITTED", label: "Pending approval" },
    { status: "APPROVED", label: "Approved, not yet paid" },
    { status: "PAID", label: "Paid" },
    { status: "REJECTED", label: "Rejected" },
    { status: "DRAFT", label: "Drafts" },
  ].map((p) => ({ href: withStatus(p.status), label: p.label, count: p.status ? matching.filter((r) => r.status === p.status).length : matching.length, current: (status ?? "") === p.status }));

  return (
    <>
      <PageHeader
        icon={Wallet}
        title="Staff Payments"
        description="Every salary record and where it stands: recorded, approved or rejected, then paid. Approval is not payment: a salary is marked paid only when the actual payment date, method and reference are recorded."
        actions={canRecord ? <ButtonLink href="/staff/salary-payments/new" icon={Plus}>Record Payment</ButtonLink> : null}
      />
      <StaffTabs actor={actor} current="payments" />
      {recorded && (
        <div className="mb-4">
          <Notice tone="green">
            {`Salary of ${formatMoney(recorded.net)} for ${recorded.staff?.fullName ?? recorded.payee}, ${recorded.month ? formatMonth(recorded.month) : ""} was ${recorded.status === "DRAFT" ? "saved as a draft" : "recorded and is pending approval"}. It is not paid yet.`}{" "}
            <Link href={`/staff/salary-payments/${recorded.id}`} className="font-medium underline">Open it</Link>
          </Notice>
        </div>
      )}
      {sp.approved === "1" && <div className="mb-4"><Notice tone="green">{APPROVALS.salary.success}</Notice></div>}
      <FilterPills label="Salary status" items={pills} />
      <Card>
        <FilterBar>
          {status && <input type="hidden" name="status" value={status} />}
          <FilterInput label="Search" name="q" defaultValue={str("q")} placeholder="Staff member, number or reference" />
          <FilterSelect label="Staff member" name="staff" defaultValue={staffMemberId} options={[{ value: "", label: "All" }, ...staff.map((s) => ({ value: s.id, label: s.fullName }))]} />
          <FilterInput label="Salary month" name="month" type="month" defaultValue={str("month")} />
          <FilterSubmit />
        </FilterBar>
        <Table
          head={["Staff member", "Salary month", "Gross / allowances / deductions", "Net", "Status", "Submitted", "Paid on", <span key="a" className="sr-only">Actions</span>]}
          empty="No salary records match these filters."
        >
          {items.map((r) => (
            <tr key={r.id}>
              <Td>
                {r.staff ? <Link href={`/staff/${r.staff.id}`} className="font-medium text-ink hover:underline">{r.staff.fullName}</Link> : r.payee}
                <Link href={`/staff/salary-payments/${r.id}`} className="block text-xs text-primary-600 hover:underline">{r.number}</Link>
              </Td>
              <Td>{r.month ? formatMonth(r.month) : "—"}</Td>
              <Td>
                <Money cents={r.gross} />
                <span className="block text-xs text-muted">
                  +<Money cents={r.allowances} /> −<Money cents={r.deductions} />
                </span>
              </Td>
              <Td className="font-medium"><Money cents={r.net} /></Td>
              <Td><StatusBadge kind="salary" status={r.status} /></Td>
              <Td>{r.submittedAt ? formatDate(todayISO(r.submittedAt)) : "—"}</Td>
              <Td>
                {r.paidDate ? formatDate(r.paidDate) : "Not paid"}
                {r.paymentMethod && <span className="block text-xs text-muted">{`${METHOD_LABELS[r.paymentMethod]} · ${r.paymentReference ?? "no reference"}`}</span>}
              </Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${r.number}`} items={salaryActions(r, actor, currentListPath("/staff/salary-payments", sp))} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/staff/salary-payments" query={queryWithoutPage(sp)} />
      </Card>
    </>
  );
}
