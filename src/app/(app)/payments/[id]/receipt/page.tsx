import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { getPayment } from "@/server/services/finance";
import { cents } from "@/server/services/common";
import { BrandLogo } from "@/components/brand";
import { Card, Money, Notice, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { formatDate, formatDateTime, fromDbDate } from "@/lib/dates";
import { METHOD_LABELS } from "../../labels";
import { ReceiptText } from "lucide-react";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/payments/[id]/receipt">) {
  const actor = await requirePage("payments.view");
  const { id } = await params;
  const data = await getPayment(actor, id);
  if (!data) notFound();
  const { payment: p, amount, unallocated } = data;
  if (p.status !== "VERIFIED" && p.status !== "REVERSED") {
    return (
      <>
        <PageHeader icon={ReceiptText} title="Receipt" back={{ href: `/payments/${id}`, label: "Payment" }} />
        <Notice>A receipt is issued only after the payment has been verified.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader icon={ReceiptText} title={`Receipt ${p.receiptNumber}`} back={{ href: `/payments/${id}`, label: "Payment" }} actions={<PrintButton />} />
      {p.status === "REVERSED" && <div className="mb-4"><Notice tone="red">This payment was REVERSED on {p.reversedAt ? formatDateTime(p.reversedAt) : ""}. The receipt is no longer valid.</Notice></div>}
      <Card className="mx-auto max-w-2xl">
        <div className="flex justify-between">
          <div>
            <BrandLogo width={110} />
            <p className="text-sm text-slate-600">{p.building.name}</p>
            {p.building.address && <p className="text-sm text-slate-600">{p.building.address}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-semibold">PAYMENT RECEIPT</p>
            <p>No. {p.receiptNumber}</p>
            <p>Issued {p.verifiedAt ? formatDateTime(p.verifiedAt) : ""}</p>
          </div>
        </div>
        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between border-b border-slate-100 pb-1"><dt>Received from</dt><dd className="font-medium">{p.party.displayName}</dd></div>
          <div className="flex justify-between border-b border-slate-100 pb-1"><dt>Amount</dt><dd className="font-bold"><Money cents={amount} /></dd></div>
          <div className="flex justify-between border-b border-slate-100 pb-1"><dt>Method</dt><dd>{METHOD_LABELS[p.method]}</dd></div>
          <div className="flex justify-between border-b border-slate-100 pb-1"><dt>Reference</dt><dd>{p.reference}</dd></div>
          <div className="flex justify-between border-b border-slate-100 pb-1"><dt>Date received</dt><dd>{formatDate(fromDbDate(p.receivedDate))}</dd></div>
        </dl>
        <h3 className="mt-6 text-sm font-semibold">Applied to</h3>
        <ul className="mt-1 text-sm">
          {p.allocations.filter((a) => !a.reversedAt).map((a) => (
            <li key={a.id} className="flex justify-between"><span>{a.invoice.number} (unit {a.invoice.unit.unitNumber})</span><Money cents={cents(a.amount)} /></li>
          ))}
          {unallocated > 0 && <li className="flex justify-between text-slate-600"><span>Not yet applied to an invoice</span><Money cents={unallocated} /></li>}
        </ul>
      </Card>
    </>
  );
}
