import { getActor } from "@/server/auth/session";
import { PermissionError } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { REPORT_DEFS, runReport, type FilterKey, type ReportKey } from "@/server/reports/catalog";
import { reportPdf } from "@/server/reports/pdf";
import { reportXlsx } from "@/server/reports/xlsx";
import { todayISO } from "@/lib/dates";

// PDF or Excel of a report (F55): the same calculation and filters as the Reports page shows
// (?report=…&format=pdf|xlsx&…filters). Permissions are checked by runReport.
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Not signed in", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const key = sp.get("report") as ReportKey;
  const format = sp.get("format");
  const def = REPORT_DEFS.find((d) => d.key === key);
  if (!def || (format !== "pdf" && format !== "xlsx")) return new Response("Unknown report or format", { status: 400 });
  const params = Object.fromEntries(def.filters.map((f) => [f, sp.get(f) ?? undefined])) as Partial<Record<FilterKey, string>>;
  try {
    const result = await runReport(actor, key, params);
    if (!("doc" in result)) return new Response("error" in result ? result.error : result.needs, { status: 400 });
    const body = format === "pdf" ? reportPdf(result.doc) : reportXlsx(result.doc);
    await audit(db, actor, { action: "report.export", entityType: "Report", entityId: key, summary: `Downloaded ${def.label} (${format.toUpperCase()}) for ${result.doc.period}`, after: params });
    const name = `bakaal-${key}-${todayISO()}.${format}`;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof PermissionError) return new Response("Not permitted", { status: 403 });
    throw e;
  }
}
