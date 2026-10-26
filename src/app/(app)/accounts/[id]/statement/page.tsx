import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { getParty } from "@/server/services/property";
import { accountStatement } from "@/server/services/reports";
import { Card, FilterBar, FilterInput, FilterSubmit, Money, PageHeader, Table, Td } from "@/components/ui";
import { addMonths, formatDate, isISODate, monthStart, todayISO } from "@/lib/dates";
import { PrintButton } from "@/components/print-button";
import { ScrollText } from "lucide-react";
import { BillingPeriodCell } from "../../../finance/billing-period";

const KIND_LABELS = { INVOICE: "Invoice", CREDIT_NOTE: "Credit note", PAYMENT: "Payment", PAYMENT_REVERSAL: "Payment reversed" } as const;

export default async function StatementPage({ params, searchParams }: PageProps<"/accounts/[id]/statement">) {
  const actor = await requirePage("invoices.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getParty(actor, id);
  if (!data) notFound();
  const today = todayISO();
  const from = typeof sp.from === "string" && isISODate(sp.from) ? sp.from : addMonths(monthStart(today), -5);
  const to = typeof sp.to === "string" && isISODate(sp.to) ? sp.to : today;
  const s = await accountStatement(actor, id, from, to);

  return (
    <>
      <PageHeader icon={ScrollText} title={`Statement — ${data.party.displayName}`} back={{ href: `/accounts/${id}`, label: data.party.displayName }} actions={<PrintButton />} />
      <Card>
        <div className="no-print">
          <FilterBar>
            <FilterInput label="From" name="from" type="date" defaultValue={from} />
            <FilterInput label="To" name="to" type="date" defaultValue={to} />
            <FilterSubmit />
          </FilterBar>
        </div>
        <p className="mb-3 text-sm text-slate-600">{formatDate(from)} to {formatDate(to)}</p>
        <Table head={["Entry date", "Billing period", "Type", "Reference", "Description", "Charges", "Payments / credits", "Balance"]}>
          <tr className="bg-slate-50 font-medium">
            <Td>{formatDate(from)}</Td>
            <Td />
            <Td>Opening balance</Td>
            <Td />
            <Td>Unpaid amounts brought forward</Td>
            <Td />
            <Td />
            <Td><Money cents={s.opening} /></Td>
          </tr>
          {s.entries.map((e, i) => (
            <tr key={i}>
              <Td>{formatDate(e.date)}</Td>
              <Td><BillingPeriodCell entry={e} /></Td>
              <Td>{KIND_LABELS[e.kind]}</Td>
              <Td>{e.reference}</Td>
              <Td wrap>{e.description}</Td>
              <Td>{e.debit ? <Money cents={e.debit} /> : ""}</Td>
              <Td>{e.credit ? <Money cents={e.credit} /> : ""}</Td>
              <Td><Money cents={e.balance} /></Td>
            </tr>
          ))}
        </Table>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
          <div><dt className="text-slate-500">Opening</dt><dd><Money cents={s.opening} /></dd></div>
          <div><dt className="text-slate-500">+ Charges</dt><dd><Money cents={s.charges} /></dd></div>
          <div><dt className="text-slate-500">− Payments</dt><dd><Money cents={s.payments} /></dd></div>
          <div><dt className="text-slate-500">− Credits</dt><dd><Money cents={s.credits} /></dd></div>
          <div><dt className="text-slate-500">+ Reversals</dt><dd><Money cents={s.reversals} /></dd></div>
          <div><dt className="font-semibold">= Closing</dt><dd className="font-semibold"><Money cents={s.closing} /></dd></div>
        </dl>
      </Card>
    </>
  );
}
