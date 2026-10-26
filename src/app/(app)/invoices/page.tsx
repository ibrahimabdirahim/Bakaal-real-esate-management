import Link from "next/link";
import { BillingSections, FinanceTabs } from "../finance/finance-tabs";
import { CalendarClock, FileText, Plus } from "lucide-react";
import { AccountBanner } from "../finance/account-banner";
import { RowActions } from "@/components/row-actions";
import { invoiceActions } from "../finance/record-actions";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { listCreditNotes, listInvoices, type InvoiceFilter } from "@/server/services/finance";
import { ButtonLink, Card, Notice, FilterBar, FilterInput, FilterSelect, FilterSubmit, Money, PageHeader, Pagination, Table, Td } from "@/components/ui";
import { formatDate, formatMonth, isISODate } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { paginate, queryWithoutPage } from "@/lib/paginate";
import { InvoiceStatusBadge } from "./badges";

export const metadata = { title: "Invoices" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open balance" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PART_PAID", label: "Part-paid" },
  { value: "PAST_DUE", label: "Past due date" },
  { value: "PAID", label: "Paid" },
  { value: "DRAFT", label: "Drafts (not issued)" },
];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const actor = await requirePage("invoices.view");
  const sp = await searchParams;
  const status = (typeof sp.status === "string" ? sp.status : "") as InvoiceFilter;
  const q = typeof sp.q === "string" ? sp.q : "";
  const from = typeof sp.from === "string" && isISODate(sp.from) ? sp.from : "";
  const to = typeof sp.to === "string" && isISODate(sp.to) ? sp.to : "";
  // "Credit notes" view: the existing credit notes, each linked to its invoice (no separate records).
  const creditView = sp.view === "credit-notes";
  // Opened for one account (e.g. from its outstanding balance in the account register).
  const partyId = typeof sp.partyId === "string" && sp.partyId ? sp.partyId : undefined;
  const all = creditView ? [] : await listInvoices(actor, { status, partyId, q: q || undefined, from: from || undefined, to: to || undefined });
  const notes = creditView ? await listCreditNotes(actor, { q: q || undefined, from: from || undefined, to: to || undefined }) : [];
  const { items: invoices, ...pg } = paginate(all, sp.page);
  const issued = all.filter((i) => i.status === "ISSUED");
  const canUnits = can(actor.role, "units.view");

  return (
    <>
      <PageHeader
        title="Invoices"
        icon={FileText}
        description="Every invoice, one per row. Issued invoices are never edited: corrections use credit notes. Payments reduce an invoice's balance by the amount allocated to it."
        actions={
          <>
            {can(actor.role, "billing.preview") && <ButtonLink variant="secondary" href="/billing" icon={CalendarClock}>Run billing</ButtonLink>}
            {can(actor.role, "payments.record") && <ButtonLink variant="secondary" href={partyId ? `/payments/new?partyId=${partyId}` : "/payments/new"} icon={Plus}>Record Payment</ButtonLink>}
            {can(actor.role, "invoices.create_manual") && <ButtonLink href={partyId ? `/invoices/new?partyId=${partyId}` : "/invoices/new"} icon={Plus}>Create Invoice</ButtonLink>}
          </>
        }
      />
      <FinanceTabs actor={actor} current="billing" partyId={partyId} />
      {partyId && <AccountBanner actor={actor} partyId={partyId} clearHref="/invoices" />}
      {sp.discarded === "1" && <div className="mb-4"><Notice tone="green">The draft invoice was deleted. The deletion is recorded in the audit log.</Notice></div>}
      <BillingSections actor={actor} current={creditView ? "credit-notes" : "invoices"} />
      {creditView ? (
        <Card>
          <FilterBar>
            <input type="hidden" name="view" value="credit-notes" />
            <FilterInput label="Search" name="q" defaultValue={q} placeholder="Credit note, invoice, account, unit or reason" />
            <FilterInput label="Issued from" name="from" type="date" defaultValue={from} />
            <FilterInput label="Issued to" name="to" type="date" defaultValue={to} />
            <FilterSubmit />
          </FilterBar>
          {notes.length > 0 && (
            <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
              Total credited <span className="block font-semibold text-navy-900"><Money cents={sumCents(notes.map((n) => n.amount))} /></span>
              <span className="text-xs text-muted">Credit notes reduce what is owed on their invoice. No money is paid out.</span>
            </p>
          )}
          <Table head={["Credit note", "Issued", "Invoice", "Account", "Unit", "Reason", "By", "Amount", <span key="a" className="sr-only">Actions</span>]} empty="No credit notes match these filters.">
            {notes.map((n) => (
              <tr key={n.id}>
                <Td>{n.number}</Td>
                <Td>{formatDate(n.date)}</Td>
                <Td><Link href={`/invoices/${n.invoice.id}`} className="font-medium text-primary-600 hover:underline">{n.invoice.number}</Link></Td>
                <Td><Link href={`/accounts/${n.party.id}`} className="hover:underline">{n.party.displayName}</Link></Td>
                <Td>{n.unitNumber}</Td>
                <Td wrap>{n.reason}</Td>
                <Td>{n.createdBy}</Td>
                <Td><Money cents={n.amount} /></Td>
                <Td className="w-px text-right">
                  <RowActions
                    label={`Actions for ${n.number}`}
                    items={[
                      { label: `View invoice ${n.invoice.number}`, href: `/invoices/${n.invoice.id}` },
                      { label: "View account", href: `/invoices?partyId=${n.party.id}` },
                      { label: "Edit or delete", unavailable: "Credit notes are fixed once recorded (database rule). Correct a mistake with a further invoice or credit note." },
                    ]}
                  />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
      <Card>
        <FilterBar>
          {partyId && <input type="hidden" name="partyId" value={partyId} />}
          <FilterSelect label="Show" name="status" defaultValue={status} options={FILTERS} />
          <FilterInput label="Search" name="q" defaultValue={q} placeholder="Invoice no., account or unit" />
          <FilterInput label="Billing period from" name="from" type="date" defaultValue={from} />
          <FilterInput label="Billing period to" name="to" type="date" defaultValue={to} />
          <FilterSubmit />
        </FilterBar>
        {issued.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <p>Total billed <span className="block font-semibold text-navy-900"><Money cents={sumCents(issued.map((i) => i.total))} /></span></p>
            <p>Paid or credited <span className="block font-semibold text-navy-900"><Money cents={sumCents(issued.map((i) => i.allocated + i.credited))} /></span></p>
            <p>Balance <span className="block font-semibold text-navy-900"><Money cents={sumCents(issued.map((i) => i.balance))} /></span></p>
          </div>
        )}
        <Table head={["Invoice", "Account / unit", "Invoice date / due", "Amount", "Paid / credits", "Outstanding", "Status", <span key="a" className="sr-only">Actions</span>]} empty="No invoices match these filters.">
          {invoices.map((i) => (
            <tr key={i.id}>
              <Td>
                <Link href={`/invoices/${i.id}`} className="font-medium text-primary-600 hover:underline">{i.number ?? "Draft"}</Link>
                <span className="block text-xs text-muted">{i.periodStart ? formatMonth(i.periodStart) : "Manual"}</span>
              </Td>
              <Td>
                <Link href={`/invoices?partyId=${i.party.id}`} className="hover:underline">{i.party.displayName}</Link>
                <span className="block text-xs text-muted">
                  {"Unit "}
                  {canUnits ? <Link href={`/units/${i.unit.id}`} className="hover:underline">{i.unit.unitNumber}</Link> : i.unit.unitNumber}
                  {" · "}
                  {i.agreementId ? <Link href={`/agreements/${i.agreementId}`} className="hover:underline">{AGREEMENT_SHORT[i.agreementType!]}</Link> : "no agreement"}
                </span>
              </Td>
              <Td>
                {i.issueDate ? formatDate(i.issueDate) : <span className="text-slate-500">Not issued</span>}
                <span className="block text-xs text-muted">{`due ${formatDate(i.dueDate)}`}</span>
              </Td>
              <Td><Money cents={i.total} /></Td>
              <Td>
                {i.status === "ISSUED" ? <Money cents={i.allocated} /> : "—"}
                {i.credited > 0 && <span className="block text-xs text-muted">credits <Money cents={i.credited} /></span>}
              </Td>
              <Td className="font-medium text-navy-900"><Money cents={i.balance} /></Td>
              <Td><InvoiceStatusBadge s={i} /></Td>
              <Td className="w-px text-right"><RowActions label={`Actions for ${i.number ?? "draft invoice"}`} items={invoiceActions(actor, i)} /></Td>
            </tr>
          ))}
        </Table>
        <Pagination {...pg} path="/invoices" query={queryWithoutPage(sp)} />
      </Card>
      )}
    </>
  );
}

const AGREEMENT_SHORT = { RENTAL: "Rental", OWNERSHIP: "Ownership", MANAGEMENT: "Management" } as const;
