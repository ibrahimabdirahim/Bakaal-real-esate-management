import { requirePage } from "@/server/auth/session";
import { findBuilding } from "@/server/services/common";
import { occupancyReport } from "@/server/services/reports";
import { OCCUPANCY_LABELS, type Occupancy } from "@/server/services/occupancy";
import { Badge, Card, FilterBar, FilterInput, FilterSubmit, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, isISODate, todayISO } from "@/lib/dates";
import { ReportActions } from "../report-tools";
import { occupancyTone } from "../../units/labels";
import { Building2 } from "lucide-react";
import { NoBuilding } from "@/components/no-building";

export const metadata = { title: "Occupancy report" };

export default async function OccupancyReportPage({ searchParams }: PageProps<"/reports/occupancy">) {
  const actor = await requirePage("reports.operational");
  if (!(await findBuilding())) return <NoBuilding actor={actor} icon={Building2} title="Occupancy and vacant units" back={{ href: "/reports", label: "Reports" }} />;
  const sp = await searchParams;
  const on = typeof sp.on === "string" && isISODate(sp.on) ? sp.on : todayISO();
  const rows = await occupancyReport(actor, on);
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.occupancy]: (acc[r.occupancy] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader icon={Building2} title="Occupancy and vacant units" description={`As at ${formatDate(on)}`} back={{ href: "/reports", label: "Reports" }} actions={<ReportActions exportHref={`/reports/export/occupancy?on=${on}`} />} />
      <Card>
        <div className="no-print"><FilterBar><FilterInput label="As at" name="on" type="date" defaultValue={on} /><FilterSubmit /></FilterBar></div>
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          {(Object.keys(OCCUPANCY_LABELS) as Occupancy[]).map((k) => (
            <span key={k}>{OCCUPANCY_LABELS[k]}: <strong>{counts[k] ?? 0}</strong></span>
          ))}
        </div>
        <Table head={["Unit", "Floor", "Type", "Status", "Tenant", "Owner"]}>
          {rows.map((r) => (
            <tr key={r.unitNumber}>
              <Td>{r.unitNumber}{!r.isActive && " (inactive)"}</Td>
              <Td>{r.floor}</Td>
              <Td>{r.unitType}</Td>
              <Td><Badge tone={occupancyTone(r.occupancy)}>{r.status}</Badge></Td>
              <Td>{r.tenant}</Td>
              <Td>{r.owner}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
