import { getActor } from "@/server/auth/session";
import { PermissionError } from "@/server/auth/actor";
import { arrearsReport, collectionsReport, expenseReport, occupancyReport, rentRoll } from "@/server/services/reports";
import { AGEING_BUCKETS } from "@/server/ledger";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { centsToDecimalString } from "@/lib/money";
import { isISODate, todayISO } from "@/lib/dates";
import { readPeriod } from "../../period";
import { toCsv } from "@/lib/csv";

// CSV exports (open in Excel). Permissions are checked by each report function.

const m = centsToDecimalString;

export async function GET(request: Request, ctx: RouteContext<"/reports/export/[report]">) {
  const actor = await getActor();
  if (!actor) return new Response("Not signed in", { status: 401 });
  const { report } = await ctx.params;
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const on = sp.on && isISODate(sp.on) ? sp.on : todayISO();
  const { from, to } = readPeriod(sp);

  try {
    let csv: string;
    switch (report) {
      case "occupancy": {
        const rows = await occupancyReport(actor, on);
        csv = toCsv(["Unit", "Floor", "Type", "Status", "Tenant", "Owner"], rows.map((r) => [r.unitNumber, r.floor, r.unitType, r.status, r.tenant, r.owner]));
        break;
      }
      case "rent-roll": {
        const rows = await rentRoll(actor, on);
        csv = toCsv(
          ["Unit", "Account", "Type", "From", "To", "Due day", "Rent", "Management fee", "Other charges", "Monthly total"],
          rows.map((r) => [r.unitNumber, r.party, r.type, r.startDate, r.endDate, r.dueDay, m(r.rent), m(r.managementFee), m(r.otherCharges), m(r.monthlyTotal)]),
        );
        break;
      }
      case "arrears": {
        const r = await arrearsReport(actor);
        // ?detail=invoices: the same balances invoice by invoice.
        csv =
          sp.detail === "invoices"
            ? toCsv(["Invoice", "Account", "Unit", "Due date", "Days overdue", "Original amount", "Paid", "Credited", "Remaining"], r.invoices.map((i) => [i.number, i.party, i.unit, i.dueDate, String(i.daysOverdue), m(i.total), m(i.paid), m(i.credited), m(i.balance)]))
            : toCsv(["Account", "Units", "Oldest due date", ...AGEING_BUCKETS, "Total"], r.rows.map((x) => [x.party, x.units, x.oldestDue, ...AGEING_BUCKETS.map((b) => m(x.buckets[b])), m(x.total)]));
        break;
      }
      case "collections": {
        const r = await collectionsReport(actor, from, to);
        csv = toCsv(
          ["Date", "Entry", "Receipt", "Account", "Method", "Reference", "Amount", "Allocated", "Unallocated"],
          r.rows.map((p) => [p.date, p.kind === "REVERSAL" ? "Reversal" : "Received", p.receiptNumber, p.party, p.method, p.reference, m(p.amount), p.allocated == null ? "" : m(p.allocated), p.unallocated == null ? "" : m(p.unallocated)]),
        );
        break;
      }
      case "expenses": {
        const r = await expenseReport(actor, from, to);
        csv = toCsv(
          ["Number", "Service month / date", "Recorded", "Paid on", "Category", "Payee", "Description", "Status", "Amount"],
          r.rows.map((e) => [e.number, e.date, e.recordedDate, e.paidDate, e.category, e.payee, e.description, e.status, m(e.amount)]),
        );
        break;
      }
      default:
        return new Response("Unknown report", { status: 404 });
    }
    await audit(db, actor, { action: "report.export", entityType: "Report", entityId: report, summary: `Exported ${report} report` });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bakaal-${report}-${todayISO()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof PermissionError) return new Response("Not permitted", { status: 403 });
    throw e;
  }
}
