import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { listInvoices } from "@/server/services/finance";
import { findBuilding } from "@/server/services/common";
import { Card, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney, sumCents } from "@/lib/money";
import { Bell } from "lucide-react";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";

export const metadata = { title: "Messages" };

export default async function NoticesPage() {
  const actor = await requirePage("notices.view");
  const today = todayISO();
  const building = await findBuilding();
  // Balances are rechecked every time the page loads, so settled accounts never appear.
  const pastDue = (await listInvoices(actor, { status: "PAST_DUE" })).filter((i) => i.balance > 0);
  const byParty = new Map<string, { id: string; name: string; invoices: typeof pastDue }>();
  for (const i of pastDue) {
    const row = byParty.get(i.party.id) ?? { id: i.party.id, name: i.party.displayName, invoices: [] };
    row.invoices.push(i);
    byParty.set(i.party.id, row);
  }

  return (
    <>
      <PageHeader
        icon={Bell}
        title="Messages: notices and reminders"
        description="Arrears notices for accounts with balances past their due date, rechecked live; paid accounts drop off automatically. Use the figures here to contact the account holder: the system does not send messages itself, so there is no delivery history."
      />
      <FinanceTabs actor={actor} current="billing" />
      <BillingSections actor={actor} current="notices" />
      <div className="mb-4">
        <Notice tone="blue">
          The system does not send e-mail or SMS: message delivery is deferred until a provider is approved. Copy the suggested text below to send a reminder manually, and keep a record of what was sent.
        </Notice>
      </div>
      {byParty.size === 0 ? (
        <Card><p className="text-sm text-slate-600">No accounts have a balance past its due date.</p></Card>
      ) : (
        <div className="space-y-4">
          {[...byParty.values()].map((p) => {
            const total = sumCents(p.invoices.map((i) => i.balance));
            const text = `Dear ${p.name}, our records show an outstanding balance of ${formatMoney(total)} on invoice(s) ${p.invoices.map((i) => i.number).join(", ")}, due on ${p.invoices.map((i) => formatDate(i.dueDate)).join(", ")}. If you have already paid, please share the payment reference so we can update your account. — ${building?.name ?? "Bakaal Real Estate"}`;
            return (
              <Card key={p.id} title={p.name} actions={<Link href={`/accounts/${p.id}`} className="text-sm text-primary-600 hover:underline">Open account</Link>}>
                <Table head={["Invoice", "Unit", "Due date", "Balance"]}>
                  {p.invoices.map((i) => (
                    <tr key={i.id}>
                      <Td><Link href={`/invoices/${i.id}`} className="text-primary-600 hover:underline">{i.number}</Link></Td>
                      <Td>{i.unit.unitNumber}</Td>
                      <Td>{formatDate(i.dueDate)} {i.dueDate && i.dueDate < today}</Td>
                      <Td><Money cents={i.balance} /></Td>
                    </tr>
                  ))}
                </Table>
                <label className="mt-3 block text-xs font-medium text-slate-500" htmlFor={`msg-${p.id}`}>Suggested reminder text</label>
                <textarea id={`msg-${p.id}`} readOnly rows={3} defaultValue={text} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none" />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
