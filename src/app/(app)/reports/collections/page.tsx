import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { collectionsReport } from "@/server/services/reports";
import { Card, FilterBar, FilterInput, FilterSubmit, Money, PageHeader, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { ReportActions } from "../report-tools";
import { readPeriod } from "../period";
import { METHOD_LABELS } from "../../payments/labels";
import { Banknote } from "lucide-react";

export const metadata = { title: "Collections" };

export default async function CollectionsPage({ searchParams }: PageProps<"/reports/collections">) {
  const actor = await requirePage("reports.financial");
  const { from, to } = readPeriod(await searchParams);
  const r = await collectionsReport(actor, from, to);

  return (
    <>
      <PageHeader icon={Banknote} title="Collections" description={`Money received ${formatDate(from)} – ${formatDate(to)}, less payments reversed in the same period. Each reversal is shown on the day it was made; the original receipt stays in its own period.`} back={{ href: "/reports", label: "Reports" }} actions={<ReportActions exportHref={`/reports/export/collections?from=${from}&to=${to}`} />} />
      <Card>
        <div className="no-print"><FilterBar><FilterInput label="From" name="from" type="date" defaultValue={from} /><FilterInput label="To" name="to" type="date" defaultValue={to} /><FilterSubmit /></FilterBar></div>
        <div className="mb-4 flex flex-wrap gap-6 text-sm">
          {r.byMethod.map((m) => <span key={m.method}>{METHOD_LABELS[m.method as keyof typeof METHOD_LABELS]}: <strong><Money cents={m.total} /></strong></span>)}
          <span>Received: <strong><Money cents={r.received} /></strong></span>
          <span>Reversed: <strong><Money cents={-r.reversed} /></strong></span>
          <span>Net collected: <strong><Money cents={r.total} /></strong></span>
        </div>
        <Table head={["Date", "Entry", "Receipt", "Account", "Method", "Reference", "Amount", "Allocated", "Unallocated"]} empty="No payments received or reversed in this period.">
          {r.rows.map((p, i) => (
            <tr key={i}>
              <Td>{formatDate(p.date)}</Td>
              <Td>{p.kind === "REVERSAL" ? <span className="text-red-700">Reversal</span> : p.reversedLater ? "Received (reversed later)" : "Received"}</Td>
              <Td><Link href={p.href} className="text-primary-600 hover:underline">{p.receiptNumber || "—"}</Link></Td>
              <Td>{p.party}</Td>
              <Td>{METHOD_LABELS[p.method]}</Td>
              <Td>{p.reference}</Td>
              <Td><Money cents={p.amount} /></Td>
              <Td>{p.allocated == null ? "—" : <Money cents={p.allocated} />}</Td>
              <Td>{p.unallocated == null ? "—" : <Money cents={p.unallocated} />}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
