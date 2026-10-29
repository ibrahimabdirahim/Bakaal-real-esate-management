import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { listAuditEvents } from "@/server/services/admin";
import { RECORD_LINKS } from "@/server/services/common";
import { Card, FilterBar, FilterInput, FilterSelect, FilterSubmit, PageHeader, Table, Td } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { History } from "lucide-react";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["", "User", "Unit", "Party", "Agreement", "BillingRun", "Invoice", "Payment", "Expense", "StaffMember", "StaffTask", "WorkOrder", "BuildingPolicy", "Building", "Report"];

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const actor = await requirePage("audit.view");
  const sp = await searchParams;
  const entityType = typeof sp.entityType === "string" ? sp.entityType : "";
  // One record's history (e.g. an invoice's "View audit history").
  const entityId = typeof sp.entityId === "string" && /^[a-z0-9_-]{1,64}$/i.test(sp.entityId) ? sp.entityId : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const { events, linkable, total, pages } = await listAuditEvents(actor, { entityType, entityId, q, page });
  const qs = (p: number) => `?${new URLSearchParams({ entityType, ...(entityId ? { entityId } : {}), q, page: String(p) })}`;

  return (
    <>
      <PageHeader icon={History} title="Audit log" description="Append-only record of important actions. Entries cannot be edited or deleted, including by administrators." />
      <Card>
        <FilterBar>
          {entityId && <input type="hidden" name="entityId" value={entityId} />}
          <FilterSelect label="Record type" name="entityType" defaultValue={entityType} options={ENTITY_TYPES.map((t) => ({ value: t, label: t || "All" }))} />
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Summary, user or action" />
          <FilterSubmit />
        </FilterBar>
        <Table head={["When", "Who", "Action", "Summary", "Record", "Details"]} empty="No audit events match.">
          {events.map((e) => (
            <tr key={String(e.id)}>
              <Td className="whitespace-nowrap">{formatDateTime(e.occurredAt)}</Td>
              <Td>{e.actorEmail ?? "system"}</Td>
              <Td className="font-mono text-xs">{e.action}</Td>
              <Td wrap>
                {e.summary}
                {e.reason && <span className="block text-xs text-slate-600">Reason: {e.reason}</span>}
              </Td>
              <Td>
                {e.entityId && RECORD_LINKS[e.entityType] && linkable.has(`${e.entityType}:${e.entityId}`) ? (
                  <Link href={linkable.get(`${e.entityType}:${e.entityId}`)!} className="text-primary-600 hover:underline">{e.entityType}</Link>
                ) : (
                  <>
                    {e.entityType}
                    {e.entityId && RECORD_LINKS[e.entityType] && <span className="block text-xs text-slate-500">(no longer exists)</span>}
                  </>
                )}
              </Td>
              <Td>
                {(e.before != null || e.after != null) && (
                  <details>
                    <summary className="cursor-pointer text-xs text-primary-600">Before / after</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} event(s)</span>
          <span className="flex gap-3">
            {page > 1 && <Link href={qs(page - 1)} className="text-primary-600 hover:underline">← Newer</Link>}
            <span>Page {page} of {pages}</span>
            {page < pages && <Link href={qs(page + 1)} className="text-primary-600 hover:underline">Older →</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
