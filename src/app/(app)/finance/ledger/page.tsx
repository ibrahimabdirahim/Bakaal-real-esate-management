import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { financeLedger } from "@/server/services/reports";
import { Card, FilterBar, FilterInput, FilterSubmit, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/dates";
import { readPeriod } from "../../reports/period";
import { FinanceTabs } from "../finance-tabs";
import { LEDGER_KIND_LABELS } from "../labels";
import { BillingPeriodCell } from "../billing-period";
import { METHOD_LABELS } from "../../payments/labels";

export const metadata = { title: "Amounts owed ledger" };

export default async function LedgerPage({ searchParams }: PageProps<"/finance/ledger">) {
  const actor = await requirePage("invoices.view");
  const sp = await searchParams;
  const { from, to } = readPeriod(sp);
  if (!can(actor.role, "payments.view")) return <Notice>The ledger combines invoices and payments; your role cannot see payments.</Notice>;
  const l = await financeLedger(actor, from, to);

  return (
    <>
      <PageHeader title="Billing & Payments" description="Amounts owed by tenants and owners: invoices, credit notes, payments and reversals in one view, each kept as its own record. This is not a cash or bank balance." />
      <FinanceTabs actor={actor} current="overview" />
      <Card>
        <FilterBar>
          <FilterInput label="From" name="from" type="date" defaultValue={from} />
          <FilterInput label="To" name="to" type="date" defaultValue={to} />
          <FilterSubmit />
        </FilterBar>
        <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Owed at start", l.opening],
            ["Invoiced", l.charges],
            ["Credit notes", -l.credits],
            ["Verified payments", -l.payments],
            ["Reversals", l.reversals],
            ["Owed at end", l.closing],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs text-muted">{label}</p>
              <p className="font-semibold text-ink"><Money cents={value as number} /></p>
            </div>
          ))}
        </div>
        <Table head={["Entry date", "Billing period", "Type", "Reference", "Account", "Description", "Charge", "Payment / credit", "Balance owed"]} empty="No ledger entries in this period.">
          {l.entries.map((e, i) => (
            <tr key={`${e.reference}-${e.kind}-${i}`}>
              <Td>{formatDate(e.date)}</Td>
              <Td><BillingPeriodCell entry={e} /></Td>
              <Td>{LEDGER_KIND_LABELS[e.kind]}</Td>
              <Td>{e.href ? <Link href={e.href} className="text-primary-600 hover:underline">{e.reference}</Link> : e.reference}</Td>
              <Td>{e.party ? <Link href={`/accounts/${e.party.id}`} className="hover:underline">{e.party.name}</Link> : "—"}</Td>
              <Td wrap className="text-slate-600">{e.description}</Td>
              <Td>{e.debit ? <Money cents={e.debit} /> : "—"}</Td>
              <Td>{e.credit ? <Money cents={e.credit} /> : "—"}</Td>
              <Td className="font-medium"><Money cents={e.balance} /></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          Owed at end = owed at start + invoiced − credit notes − verified payments + reversals. Entry dates follow the statement policy: invoices and credit notes by issue date, payments
          by the date received, reversals by the reversal date. Billing-period summaries (dashboard, overview &quot;Billed&quot;) group invoices by their billing month instead, shown in its own column. Each account&apos;s statement uses the same entries.
        </p>
      </Card>

      <Card title="Payments not counted" description="Recorded in the period but pending verification or rejected. They change no balance." className="mt-6">
        <Table head={["Received", "Account", "Method", "Reference", "Amount", "Status"]} empty="None in this period.">
          {l.notCounted.map((p) => (
            <tr key={p.id}>
              <Td>{formatDate(p.date)}</Td>
              <Td><Link href={`/accounts/${p.party.id}`} className="hover:underline">{p.party.name}</Link></Td>
              <Td>{METHOD_LABELS[p.method]}</Td>
              <Td><Link href={`/payments/${p.id}`} className="text-primary-600 hover:underline">{p.reference}</Link></Td>
              <Td><Money cents={p.amount} /></Td>
              <Td><StatusBadge kind="payment" status={p.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
