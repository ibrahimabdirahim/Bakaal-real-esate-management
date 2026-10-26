import { requirePage } from "@/server/auth/session";
import { rentRoll } from "@/server/services/reports";
import { Card, FilterBar, FilterInput, FilterSubmit, Money, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, isISODate, todayISO } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { ReportActions } from "../report-tools";
import { AGREEMENT_TYPE_LABELS } from "../../agreements/labels";
import { ScrollText } from "lucide-react";

export const metadata = { title: "Rent roll" };

export default async function RentRollPage({ searchParams }: PageProps<"/reports/rent-roll">) {
  const actor = await requirePage("reports.financial");
  const sp = await searchParams;
  const on = typeof sp.on === "string" && isISODate(sp.on) ? sp.on : todayISO();
  const rows = await rentRoll(actor, on);

  return (
    <>
      <PageHeader icon={ScrollText} title="Rent roll and owner charges" description={`Agreements in force on ${formatDate(on)}. Owners show no rent by design.`} back={{ href: "/reports", label: "Reports" }} actions={<ReportActions exportHref={`/reports/export/rent-roll?on=${on}`} />} />
      <Card>
        <div className="no-print"><FilterBar><FilterInput label="As at" name="on" type="date" defaultValue={on} /><FilterSubmit /></FilterBar></div>
        <Table head={["Unit", "Account", "Type", "From", "To", "Due day", "Rent", "Mgmt fee", "Other charges", "Monthly total"]}>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td>{r.unitNumber}</Td>
              <Td>{r.party}</Td>
              <Td>{AGREEMENT_TYPE_LABELS[r.type]}</Td>
              <Td>{formatDate(r.startDate)}</Td>
              <Td>{formatDate(r.endDate)}</Td>
              <Td>{r.dueDay ?? "—"}</Td>
              <Td><Money cents={r.rent} /></Td>
              <Td><Money cents={r.managementFee} /></Td>
              <Td><Money cents={r.otherCharges} /></Td>
              <Td className="font-medium"><Money cents={r.monthlyTotal} /></Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <Td>Total</Td><Td /><Td /><Td /><Td /><Td />
              <Td><Money cents={sumCents(rows.map((r) => r.rent))} /></Td>
              <Td><Money cents={sumCents(rows.map((r) => r.managementFee))} /></Td>
              <Td><Money cents={sumCents(rows.map((r) => r.otherCharges))} /></Td>
              <Td><Money cents={sumCents(rows.map((r) => r.monthlyTotal))} /></Td>
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}
