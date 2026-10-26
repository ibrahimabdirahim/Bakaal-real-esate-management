import Link from "next/link";
import { DocumentsCard } from "../../documents/documents-card";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getStaffMember } from "@/server/services/operations";
import { cents } from "@/server/services/common";
import { ButtonLink, Card, DescriptionList, Money, PageHeader, Table, Td } from "@/components/ui";
import { formatDate, formatMonth, optionalFromDbDate, fromDbDate } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { StaffForm } from "../staff-form";
import { setSalaryAction, updateStaffAction } from "../actions";
import { ActionForm, SubmitButton, TextInput } from "@/components/forms";

import { StatusBadge } from "@/components/status";
import { UserCog } from "lucide-react";

export default async function StaffMemberPage({ params }: PageProps<"/staff/[id]">) {
  const actor = await requirePage("staff.view");
  const { id } = await params;
  const data = await getStaffMember(actor, id);
  if (!data) notFound();
  const { staff: s, salaryExpenses, showSalary } = data;

  return (
    <>
      <PageHeader icon={UserCog}
        title={s.fullName}
        back={{ href: "/staff", label: "Staff" }}
        description={s.position}
        actions={showSalary && can(actor.role, "salary.manage") && can(actor.role, "expenses.submit") ? <ButtonLink variant="secondary" href={`/staff/salary-payments/new?staff=${s.id}`}>Record salary payment</ButtonLink> : null}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Details">
          <DescriptionList
            items={[
              ["Phone", s.phone],
              ["Start date", formatDate(optionalFromDbDate(s.startDate))],
              ["End date", formatDate(optionalFromDbDate(s.endDate))],
              ["Monthly salary", showSalary ? <Money key="s" cents={s.salaryAmount} /> : "Restricted"],
              ["Notes / duties", s.notes],
            ]}
          />
        </Card>
        {can(actor.role, "staff.manage") && (
          <Card title="Edit" className="scroll-mt-20" id="edit">
            <StaffForm
              action={updateStaffAction.bind(null, s.id)}
              canSalary={can(actor.role, "salary.manage")}
              defaults={{
                fullName: s.fullName,
                position: s.position,
                phone: s.phone ?? undefined,
                startDate: optionalFromDbDate(s.startDate) ?? undefined,
                endDate: optionalFromDbDate(s.endDate) ?? undefined,
                notes: s.notes ?? undefined,
                salaryAmount: s.salaryAmount != null ? centsToDecimalString(s.salaryAmount) : undefined,
              }}
            />
          </Card>
        )}
        {!can(actor.role, "staff.manage") && can(actor.role, "salary.manage") && (
          <Card title="Salary (restricted)">
            <ActionForm action={setSalaryAction.bind(null, s.id)}>
              <TextInput label="Monthly salary (KES)" name="salaryAmount" inputMode="decimal" defaultValue={s.salaryAmount != null ? centsToDecimalString(s.salaryAmount) : ""} />
              <SubmitButton>Save salary</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <Card title="Tasks and schedule" className="mt-6" actions={<Link href="/staff/tasks" className="text-sm text-primary-600 hover:underline">All tasks</Link>}>
        <Table head={["Task", "Due", "Status"]} empty="No tasks assigned.">
          {s.tasks.map((t) => (
            <tr key={t.id}>
              <Td>{t.title}</Td>
              <Td>{formatDate(optionalFromDbDate(t.dueDate))}</Td>
              <Td><StatusBadge kind="task" status={t.status} /></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Task completion is recorded separately from salary payment.</p>
      </Card>

      {showSalary && (
        <Card title="Salary payments (restricted)" className="mt-6" actions={<Link href={`/staff/salary-payments?staff=${s.id}`} className="text-sm text-primary-600 hover:underline">Full history</Link>}>
          <Table head={["Payment", "Salary month", "Net", "Status", "Paid on"]} empty="No salary payments recorded for this staff member.">
            {salaryExpenses.map((e) => (
              <tr key={e.id}>
                <Td><Link href={`/staff/salary-payments/${e.id}`} className="text-primary-600 hover:underline">{e.number}</Link></Td>
                <Td>{e.servicePeriodStart ? formatMonth(fromDbDate(e.servicePeriodStart)) : formatDate(fromDbDate(e.createdAt))}</Td>
                <Td><Money cents={cents(e.amount)} /></Td>
                <Td><StatusBadge kind="salary" status={e.status} /></Td>
                <Td>{formatDate(optionalFromDbDate(e.paidDate))}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <DocumentsCard actor={actor} ownerType="STAFF_MEMBER" ownerId={s.id} title="Staff file" className="mt-6" slots={[{ category: "ID_DOCUMENT", label: "Identification", multiple: true }, { category: "PHOTO", multiple: true }, { category: "OTHER", label: "Contract or other documents", multiple: true }]} />
    </>
  );
}
