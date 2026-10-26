import Link from "next/link";
import { requirePage } from "@/server/auth/session";
import { reconciliationCheck } from "@/server/services/reports";
import { Badge, Card, Money, Notice, PageHeader, Table, Td } from "@/components/ui";
import { Scale } from "lucide-react";

export const metadata = { title: "Balances owed check" };

export default async function ReconciliationPage() {
  const actor = await requirePage("reports.financial");
  const rows = await reconciliationCheck(actor);
  const mismatches = rows.filter((r) => !r.matches);

  return (
    <>
      <PageHeader icon={Scale}
        title="Balances owed check"
        description="For each tenant or owner: the amount owed on their statement (opening + charges − payments − credits + reversals) must equal their invoice balances minus unallocated payments. This checks amounts owed, not a bank or cash balance."
        back={{ href: "/reports", label: "Reports" }}
      />
      <div className="mb-4">
        {mismatches.length === 0 ? (
          <Notice tone="blue">All {rows.length} account(s) with activity reconcile.</Notice>
        ) : (
          <Notice tone="red">{mismatches.length} account(s) do not reconcile. Investigate before relying on the figures.</Notice>
        )}
      </div>
      <Card>
        <Table head={["Account", "Statement balance", "Invoice balances", "Unallocated payments", "Result"]} empty="No financial activity yet.">
          {rows.map((r) => (
            <tr key={r.partyId}>
              <Td><Link href={`/accounts/${r.partyId}/statement`} className="text-primary-600 hover:underline">{r.party}</Link></Td>
              <Td><Money cents={r.statementBalance} /></Td>
              <Td><Money cents={r.invoiceBalances} /></Td>
              <Td><Money cents={r.unallocated} /></Td>
              <Td>{r.matches ? <Badge tone="green">Reconciles</Badge> : <Badge tone="red">Mismatch</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
