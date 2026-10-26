import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { arrearsReport } from "@/server/services/reports";
import { AGEING_BUCKETS } from "@/server/ledger";
import { Card, Money, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/dates";
import { ReportActions } from "../report-tools";
import { AlertTriangle } from "lucide-react";

export const metadata = { title: "Arrears ageing" };

export default async function ArrearsPage() {
  const actor = await requirePage("reports.financial");
  const { rows, totals, grandTotal, invoices } = await arrearsReport(actor);

  return (
    <>
      <PageHeader icon={AlertTriangle} title="Arrears ageing" description={`Unpaid invoice balances as at ${formatDate(todayISO())}, grouped by days past the due date. No penalties are implied.`} back={{ href: "/reports", label: "Reports" }} actions={<ReportActions exportHref="/reports/export/arrears" />} />
      <Card>
        <Table head={["Account", "Units", "Oldest due date", ...AGEING_BUCKETS, "Total"]} empty="No outstanding balances.">
          {rows.map((r) => (
            <tr key={r.partyId}>
              <Td><Link href={`/accounts/${r.partyId}`} className="text-primary-600 hover:underline">{r.party}</Link></Td>
              <Td>{r.units}</Td>
              <Td>{formatDate(r.oldestDue)}</Td>
              {AGEING_BUCKETS.map((b) => <Td key={b}><Money cents={r.buckets[b]} /></Td>)}
              <Td className="font-medium"><Money cents={r.total} /></Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <Td>Total</Td><Td /><Td />
              {AGEING_BUCKETS.map((b) => <Td key={b}><Money cents={totals[b]} /></Td>)}
              <Td><Money cents={grandTotal} /></Td>
            </tr>
          )}
        </Table>
      </Card>
      {invoices.length > 0 && (
        <Card
          className="mt-6"
          title="Unpaid invoices"
          description="The same balances invoice by invoice, oldest due date first. Paid = verified payments allocated to the invoice."
          actions={<Link href="/reports/export/arrears?detail=invoices" prefetch={false} className="no-print text-sm font-medium text-primary-600 hover:underline">Export CSV</Link>}
        >
          <Table head={["Invoice", "Account", "Unit", "Due date", "Days overdue", "Original amount", "Paid", "Credited", "Remaining"]}>
            {invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></Td>
                <Td><Link href={`/accounts/${i.partyId}`} className="hover:underline">{i.party}</Link></Td>
                <Td>{i.unit}</Td>
                <Td>{formatDate(i.dueDate)}</Td>
                <Td>{i.daysOverdue > 0 ? i.daysOverdue : "Not yet due"}</Td>
                <Td><Money cents={i.total} /></Td>
                <Td><Money cents={i.paid} /></Td>
                <Td>{i.credited > 0 ? <Money cents={i.credited} /> : "—"}</Td>
                <Td className="font-medium"><Money cents={i.balance} /></Td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <Td>Total</Td><Td /><Td /><Td /><Td /><Td /><Td /><Td />
              <Td><Money cents={grandTotal} /></Td>
            </tr>
          </Table>
        </Card>
      )}
    </>
  );
}
