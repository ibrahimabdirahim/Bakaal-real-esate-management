import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { Card, PageHeader } from "@/components/ui";
import { StaffForm } from "../staff-form";
import { createStaffAction } from "../actions";
import { UserCog } from "lucide-react";

export const metadata = { title: "Add staff member" };

export default async function NewStaffPage() {
  const actor = await requirePage("staff.manage");
  return (
    <>
      <PageHeader icon={UserCog} title="Add staff member" back={{ href: "/staff", label: "Staff" }} />
      <Card>
        <StaffForm action={createStaffAction} canSalary={can(actor.role, "salary.manage")} />
      </Card>
    </>
  );
}
