import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/actor";
import { allowedNextStatuses, listWorkOrders, workOrderCounts } from "@/server/services/operations";
import { ButtonLink, CollapsibleCard, FilterBar, FilterSelect, FilterSubmit, Notice, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/row-actions";
import { StatusBadge } from "@/components/status";
import { formatDate, todayISO } from "@/lib/dates";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { STATUS_LABELS } from "./labels";
import { approveAction } from "@/components/row-action-items";
import { APPROVALS, currentListPath } from "@/lib/approval";
import { approveQuoteAction } from "./actions";

export const metadata = { title: "Maintenance" };

export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  const actor = await requirePage("workorders.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "OPEN_ALL";
  const [all, counts] = await Promise.all([listWorkOrders(actor, status), workOrderCounts(actor)]);
  const { items: orders, ...pg } = paginate(all, sp.page);
  // Summary of every work order by its status (each figure opens that list). "Open" includes those assigned but not started.
  const metrics = [
    { label: "Total Requests", value: counts.total, tone: "text-primary-600", href: "/maintenance?status=ALL", current: status === "ALL" },
    { label: "Open", value: counts.open + counts.assigned, tone: "text-amber-600", href: "/maintenance?status=NOT_STARTED", current: status === "NOT_STARTED", note: counts.assigned ? `incl. ${counts.assigned} assigned` : undefined },
    { label: "In Progress", value: counts.inProgress, tone: "text-violet-600", href: "/maintenance?status=IN_PROGRESS", current: status === "IN_PROGRESS" },
    { label: "Completed", value: counts.completed, tone: "text-emerald-600", href: "/maintenance?status=COMPLETED", current: status === "COMPLETED" },
    { label: "Cancelled", value: counts.cancelled, tone: "text-slate-500", href: "/maintenance?status=CANCELLED", current: status === "CANCELLED" },
  ];

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Manage maintenance requests and work orders"
        actions={can(actor.role, "workorders.manage") ? <ButtonLink href="/maintenance/new" icon={Plus}>New Maintenance</ButtonLink> : null}
      />
      {sp.approved === "1" && <div className="mb-4"><Notice tone="green">{APPROVALS.maintenance.success}</Notice></div>}
      <CollapsibleCard title="Summary" className="mb-6" padded={false}>
        <ul className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x" data-maintenance-summary>
          {metrics.map((m) => (
            <li key={m.label} className="text-center">
              <Link href={m.href} aria-current={m.current ? "true" : undefined} className={`block px-3 py-4 hover:bg-surface ${m.current ? "bg-surface" : ""}`} data-metric={m.label}>
                <span className={`block text-3xl font-semibold tabular-nums ${m.tone}`}>{m.value}</span>
                <span className="block text-sm text-muted">{m.label}</span>
                {m.note && <span className="block text-[11px] text-muted">{m.note}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </CollapsibleCard>
      <CollapsibleCard title="Maintenance Requests">
        <FilterBar>
          <FilterSelect label="Show" name="status" defaultValue={status} options={[{ value: "OPEN_ALL", label: "All open" }, { value: "NOT_STARTED", label: "Open or assigned (not started)" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: "ALL", label: "Everything" }]} />
          <FilterSubmit />
        </FilterBar>
        {/* Work orders have no category field; their priority is shown instead. */}
        <Table head={["Date", "Property (Unit)", "Title / Issue", "Priority", "Status", "Assigned To", <span key="a">Action</span>]} empty={counts.total ? "No work orders in this view." : "No maintenance requests yet. Use New Maintenance to record the first one."}>
          {orders.map((w) => (
            <tr key={w.id}>
              <Td>
                {formatDate(todayISO(w.createdAt))}
                <span className="block text-xs text-muted">{w.number}</span>
              </Td>
              <Td>{w.unit ? <Link href={`/units/${w.unit.id}`} className="hover:underline">{w.unit.unitNumber}</Link> : (w.location ?? "Common area")}</Td>
              <Td wrap className="max-w-72"><Link href={`/maintenance/${w.id}`} className="font-medium text-ink hover:underline">{w.title}</Link></Td>
              <Td><StatusBadge kind="priority" status={w.priority} /></Td>
              <Td><StatusBadge kind="workorder" status={w.status} /></Td>
              <Td>{w.assignee ?? <span className="text-muted">Unassigned</span>}</Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${w.number}`} items={workOrderActions(actor, w, currentListPath("/maintenance", sp))} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} shown={orders.length} path="/maintenance" query={queryWithoutPage(sp)} />
      </CollapsibleCard>
    </>
  );
}

/**
 * What can be done with a work order from the list (F53), following its allowed status path; every
 * change is made on the work order's page, where the server checks the step and its closing details.
 */
function workOrderActions(actor: Actor, w: { id: string; number: string; status: string; quoteAmount: unknown; quoteApproved: boolean | null }, listPath: string): RowAction[] {
  const href = `/maintenance/${w.id}`;
  const items: RowAction[] = [{ label: "View details", href }];
  const closed = w.status === "COMPLETED" || w.status === "CANCELLED";
  if (closed) {
    items.push({ label: "Edit or update", unavailable: "Completed and cancelled work orders are kept as history and no longer change." });
  } else if (can(actor.role, "workorders.manage")) {
    const next = allowedNextStatuses(w.status);
    items.push({ label: "Edit, assign or update status", href: `${href}#update` });
    if (next.includes("COMPLETED")) items.push({ label: "Mark completed", href: `${href}?set=COMPLETED#update` });
    else items.push({ label: "Mark completed", unavailable: "Start the work (In progress) before completing it." });
    if (next.includes("CANCELLED")) items.push({ label: "Cancel request", href: `${href}?set=CANCELLED#update`, tone: "danger" });
  }
  // Approving is the quote (one confirmation in place, F61); the work order's status does not change.
  if (!closed && w.quoteAmount != null && w.quoteApproved == null && can(actor.role, "workorders.approve_quote")) {
    items.push(approveAction("Approve quote", approveQuoteAction.bind(null, w.id), "maintenance", listPath));
    items.push({ label: "Reject quote", href: `${href}#quote`, tone: "danger" });
  }
  if (can(actor.role, "expenses.submit")) items.push({ label: "Record linked expense", href: `/expenses/new?workOrderId=${w.id}&category=REPAIRS` });
  return items;
}
