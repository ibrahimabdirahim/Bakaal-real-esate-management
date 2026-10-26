import { requirePage } from "@/server/auth/session";
import { db } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { WorkOrderForm } from "./work-order-form";
import { Wrench } from "lucide-react";

export const metadata = { title: "New work order" };

export default async function NewWorkOrderPage({ searchParams }: PageProps<"/maintenance/new">) {
  await requirePage("workorders.manage");
  const sp = await searchParams;
  const units = await db.unit.findMany({ select: { id: true, unitNumber: true } });
  units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return (
    <>
      <PageHeader icon={Wrench} title="New work order" back={{ href: "/maintenance", label: "Maintenance" }} />
      <Card>
        <WorkOrderForm units={units.map((u) => ({ value: u.id, label: u.unitNumber }))} unitId={typeof sp.unitId === "string" ? sp.unitId : ""} />
      </Card>
    </>
  );
}
