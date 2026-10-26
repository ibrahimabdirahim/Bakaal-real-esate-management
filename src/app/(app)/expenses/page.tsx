import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { canDecideExpense, listExpenses } from "@/server/services/operations";
import { cents } from "@/server/services/common";
import { ButtonLink, CollapsibleCard, FilterBar, FilterPills, FilterInput, FilterSelect, FilterSubmit, Money, Notice, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/row-actions";
import { findBuilding } from "@/server/services/common";
import { sumCents } from "@/lib/money";
import type { Actor } from "@/server/auth/actor";
import { StatusBadge } from "@/components/status";
import { formatDate, isISODate } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { expensePaidDate, expenseServiceDate } from "@/server/money-dates";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { EXPENSE_CATEGORY_LABELS } from "./labels";
import { approveAction, deleteAction } from "@/components/row-action-items";
import { APPROVALS, currentListPath } from "@/lib/approval";
import { approveExpenseAction, deleteDraftExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const actor = await requirePage("expenses.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const category = typeof sp.category === "string" ? sp.category : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  // A period on the service month (costs) or on the payment date (paid out), as used by the dashboard links.
  const from = typeof sp.from === "string" && isISODate(sp.from) ? sp.from : undefined;
  const to = typeof sp.to === "string" && isISODate(sp.to) ? sp.to : undefined;
  const basis = sp.basis === "paid" ? "paid" : "service";
  const all = (await listExpenses(actor, { status, category, from, to, basis })).filter(
    (e) => !q || e.payee.toLowerCase().includes(q) || e.number.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
  );
  const { items: expenses, ...pg } = paginate(all, sp.page);
  // Status shortcuts with counts (the other filters kept), so each stage is one click away.
  const everyStatus = (await listExpenses(actor, { category, from, to, basis })).filter(
    (e) => !q || e.payee.toLowerCase().includes(q) || e.number.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
  );
  // Summary (F35 rules): costs are approved or paid expenses; drafts, pending and rejected ones are not costs.
  const amountOf = (st: string[]) => sumCents(everyStatus.filter((e) => st.includes(e.status)).map((e) => cents(e.amount)!));
  const summary = { total: amountOf(["APPROVED", "PAID"]), paid: amountOf(["PAID"]), unpaid: amountOf(["APPROVED"]), awaiting: amountOf(["SUBMITTED"]) };
  const building = await findBuilding();
  const countOf = (st: string) => everyStatus.filter((e) => (st === "COSTS" ? e.status === "APPROVED" || e.status === "PAID" : e.status === st)).length;
  const withStatus = (st: string) => {
    const qs = new URLSearchParams(Object.entries({ status: st, category, from: from ?? "", to: to ?? "", basis: from || to ? basis : "" }).filter(([, v]) => v) as [string, string][]);
    return `/expenses${qs.size ? `?${qs}` : ""}`;
  };
  const pills = [
    { status: "", label: "All", count: everyStatus.length },
    { status: "SUBMITTED", label: "Awaiting approval", count: countOf("SUBMITTED") },
    { status: "APPROVED", label: "Approved, not yet paid", count: countOf("APPROVED") },
    { status: "PAID", label: "Paid", count: countOf("PAID") },
    { status: "COSTS", label: "All approved costs", count: countOf("COSTS") },
    { status: "REJECTED", label: "Rejected", count: countOf("REJECTED") },
    { status: "DRAFT", label: "Drafts", count: countOf("DRAFT") },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Record and manage property expenses"
        actions={can(actor.role, "expenses.submit") ? <ButtonLink href="/expenses/new" icon={Plus}>Record Expense</ButtonLink> : null}
      />
      {sp.deleted === "1" && <div className="mb-4"><Notice tone="green">The draft expense was deleted. The deletion is recorded in the audit log.</Notice></div>}
      {sp.approved === "1" && <div className="mb-4"><Notice tone="green">{APPROVALS.expense.success}</Notice></div>}
      <CollapsibleCard title="Summary" className="mb-6">
        <div className="flex flex-col items-center gap-1 py-2 text-center" data-expense-total>
          <p className="flex items-center gap-3 text-sm text-muted before:h-px before:w-16 before:bg-line after:h-px after:w-16 after:bg-line sm:before:w-24 sm:after:w-24">Total</p>
          <p className="text-3xl font-semibold text-navy-900 tabular-nums"><Money cents={summary.total} /></p>
          <p className="text-xs text-muted">
            {`Approved and paid costs${from && to ? (basis === "paid" ? " paid in the period" : " for the period") : ""}${category ? ` · ${EXPENSE_CATEGORY_LABELS[category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? ""}` : ""} · paid `}
            <Money cents={summary.paid} />
            {" · approved, not yet paid "}
            <Money cents={summary.unpaid} />
          </p>
          {summary.awaiting > 0 && <p className="text-xs text-amber-700">Awaiting approval (not counted): <Money cents={summary.awaiting} /></p>}
        </div>
      </CollapsibleCard>
      <CollapsibleCard title="Expenses">
        <FilterPills label="Expense status" items={pills.map((p) => ({ href: withStatus(p.status), label: p.label, count: p.count, current: status === p.status }))} />
        <FilterBar>
          {/* The status is chosen with the buttons above; filtering keeps it. */}
          {status && <input type="hidden" name="status" value={status} />}
          <FilterSelect label="Category" name="category" defaultValue={category} options={[{ value: "", label: "All" }, ...Object.entries(EXPENSE_CATEGORY_LABELS).filter(([v]) => v !== "SALARIES" || can(actor.role, "salary.view")).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect label="Dates by" name="basis" defaultValue={basis} options={[{ value: "service", label: "Service month" }, { value: "paid", label: "Payment date" }]} />
          <FilterInput label="From" name="from" type="date" defaultValue={from ?? ""} />
          <FilterInput label="To" name="to" type="date" defaultValue={to ?? ""} />
          <FilterInput label="Search" name="q" defaultValue={typeof sp.q === "string" ? sp.q : ""} placeholder="Payee, number or description" />
          <FilterSubmit />
        </FilterBar>
        <Table head={["Date", "Property (Unit)", "Category", "Status", "Amount (KES)", <span key="a">Action</span>]} empty={everyStatus.length ? "No expenses match these filters." : "No expenses recorded yet. Use Record Expense to add the first one."}>
          {expenses.map((e) => (
            <tr key={e.id}>
              <Td>
                {formatDate(expenseServiceDate(e))}
                <span className="block text-xs text-muted">{e.number}{e.status === "PAID" ? ` · paid ${formatDate(expensePaidDate(e))}` : ""}</span>
              </Td>
              <Td>{e.workOrder?.unit ? <Link href={`/units/${e.workOrder.unit.id}`} className="hover:underline">{e.workOrder.unit.unitNumber}</Link> : (building?.name ?? "Building")}</Td>
              <Td wrap className="max-w-64">
                {EXPENSE_CATEGORY_LABELS[e.category]}
                <span className="block truncate text-xs text-muted" title={`${e.payee} — ${e.description}`}>{`${e.payee} · ${e.description}`}</span>
              </Td>
              <Td><StatusBadge kind="expense" status={e.status} /></Td>
              <Td className="tabular-nums">{centsToDecimalString(cents(e.amount)!).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}</Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${e.number}`} items={expenseActions(actor, e, currentListPath("/expenses", sp))} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} shown={expenses.length} path="/expenses" query={queryWithoutPage(sp)} />
      </CollapsibleCard>
    </>
  );
}

/**
 * What can be done with an expense from the list (F53), by its status and the existing rules: a draft
 * is edited or deleted; a submitted expense is approved in place (one confirmation, F61) or rejected on
 * its page (a reason is needed); an approved one is paid; a rejected one is
 * corrected with a new copy. Submitted, decided and paid expenses are never edited or deleted (database rule).
 */
function expenseActions(actor: Actor, e: { id: string; number: string; status: string; category: string; staffMemberId: string | null; createdById: string; submittedById: string | null; workOrder: { id: string; number: string } | null }, listPath: string): RowAction[] {
  if (e.category === "SALARIES" && e.staffMemberId) return [{ label: "View salary payment", href: `/staff/salary-payments/${e.id}` }, { label: "Edit or delete", unavailable: "Salary payments are managed under Staff & Tasks → Staff Payments." }];
  const href = `/expenses/${e.id}`;
  const items: RowAction[] = [{ label: "View expense", href }];
  const mayEditDraft = can(actor.role, "expenses.submit") && (e.createdById === actor.id || can(actor.role, "expenses.approve"));
  if (e.status === "DRAFT") {
    items.push(mayEditDraft ? { label: "Edit expense", href: `${href}#edit` } : { label: "Edit expense", unavailable: "Only the person who created this draft can edit it." });
    if (mayEditDraft) items.push(deleteAction("Delete draft", deleteDraftExpenseAction.bind(null, e.id), "draft expense"));
  } else {
    items.push({ label: "Edit expense", unavailable: "Details are fixed once submitted (database rule); a rejected expense is corrected with a new copy." });
  }
  if (e.status === "SUBMITTED" && canDecideExpense(actor, e)) {
    items.push(approveAction("Approve", approveExpenseAction.bind(null, e.id), "expense", listPath));
    items.push({ label: "Reject", href: `${href}#approval`, tone: "danger" });
  }
  if (e.status === "APPROVED" && can(actor.role, "expenses.pay")) items.push({ label: "Record payment", href: `${href}#pay` });
  if (e.status === "REJECTED" && can(actor.role, "expenses.submit")) items.push({ label: "Record a corrected copy", href: `/expenses/new?copy=${e.id}` });
  if (e.workOrder) items.push({ label: `View work order ${e.workOrder.number}`, href: `/maintenance/${e.workOrder.id}` });
  if (e.status !== "DRAFT") items.push({ label: "Delete expense", unavailable: "Submitted, approved, rejected and paid expenses are kept for the record." });
  return items;
}
