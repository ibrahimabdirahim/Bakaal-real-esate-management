import { getActor } from "@/server/auth/session";
import { PermissionError } from "@/server/auth/actor";
import { listInvoices } from "@/server/services/finance";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { centsToDecimalString } from "@/lib/money";
import { isISODate, todayISO } from "@/lib/dates";
import { toCsv } from "@/lib/csv";

// Billing report (F65): every invoice of the billing period (or all), one row each, from the same
// list and figures as Billing & Payments. Opens in Excel. Needs invoices.view; the export is audited.

const ACCOUNT_TYPE = { RENTAL: "Rent-paying tenant", OWNERSHIP: "Purchased unit owner", MANAGEMENT: "Managed by BAKAAL" } as const;
const CHARGE = { RENT: "Rent", SERVICE_CHARGE: "Service charge", SHARED_CHARGE: "Shared charge", MANAGEMENT_FEE: "Management fee", OTHER: "Other" } as const;
const STATUS = { DRAFT: "Draft", UNPAID: "Unpaid", PART_PAID: "Part-paid", PAID: "Paid" } as const;

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Not signed in", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const from = isISODate(sp.get("from") ?? "") ? sp.get("from")! : undefined;
  const to = isISODate(sp.get("to") ?? "") ? sp.get("to")! : undefined;
  try {
    const rows = await listInvoices(actor, { from, to, sort: "oldest" });
    const m = centsToDecimalString;
    const csv = toCsv(
      ["Invoice", "Account", "Account type", "Unit", "Charges", "Billing period", "Invoice date", "Due date", "Amount", "Paid (allocated)", "Credited", "Outstanding", "Status", "Past due"],
      rows.map((i) => [
        i.number ?? "Draft",
        i.party.displayName,
        i.agreementType ? ACCOUNT_TYPE[i.agreementType] : "No agreement",
        i.unit.unitNumber,
        i.chargeTypes.map((c) => CHARGE[c]).join(", "),
        i.periodStart ? i.periodStart.slice(0, 7) : "Manual",
        i.issueDate,
        i.dueDate,
        m(i.total),
        m(i.allocated),
        m(i.credited),
        m(i.balance),
        STATUS[i.paymentStatus],
        i.dueState === "OVERDUE" || i.dueState === "PAST_DUE_GRACE_UNKNOWN" || i.dueState === "WITHIN_GRACE" ? "Yes" : "No",
      ]),
    );
    await audit(db, actor, { action: "report.export", entityType: "Report", entityId: "billing", summary: `Exported the billing report (${from && to ? `${from} to ${to}` : "all periods"}, ${rows.length} invoices)` });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bakaal-billing-${from ? from.slice(0, 7) : "all"}-${todayISO()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof PermissionError) return new Response("Not permitted", { status: 403 });
    throw e;
  }
}
