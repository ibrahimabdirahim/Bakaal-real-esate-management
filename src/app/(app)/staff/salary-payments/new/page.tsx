import { Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { listStaff } from "@/server/services/operations";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { Card, Notice, PageHeader } from "@/components/ui";
import { centsToDecimalString } from "@/lib/money";
import { monthStart, todayISO } from "@/lib/dates";
import { recordSalaryAction } from "../actions";
import { getSalaryPayment } from "@/server/services/salaries";
import { SalaryForm } from "../salary-form";

export const metadata = { title: "Record salary payment" };

export default async function NewSalaryPaymentPage({ searchParams }: PageProps<"/staff/salary-payments/new">) {
  const actor = await requirePage("salary.manage");
  const sp = await searchParams;
  const thisMonth = monthStart(todayISO());
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : thisMonth;
  // All staff, former ones too (a final salary may still be due); the server checks the employment dates.
  const staff = await listStaff(actor);
  // "Record a corrected copy" of a rejected salary payment: start from its details.
  const copy = typeof sp.copy === "string" ? await getSalaryPayment(actor, sp.copy) : null;
  const from = copy && copy.expense.status === "REJECTED" ? copy : null;
  const amount = (c: number | null) => (c != null ? centsToDecimalString(c) : undefined);

  return (
    <>
      <PageHeader icon={Wallet} title="Record Salary Payment" back={{ href: "/staff/salary-payments", label: "Staff Payments" }} description={from ? `Corrected copy of rejected salary payment ${from.expense.number}; the rejected one is kept unchanged.` : "Records what is owed for one staff member and month. It is not approved or paid until those steps are done separately."} />
      <Card>
        {staff.length === 0 ? (
          <Notice>No staff records yet. Add one under Staff Directory first.</Notice>
        ) : (
          <SalaryForm
            action={recordSalaryAction}
            staff={staff.map((s) => ({ value: s.id, label: `${s.fullName} — ${s.position}`, salary: s.salaryAmount != null ? centsToDecimalString(s.salaryAmount) : null }))}
            defaults={
              from
                ? { staffMemberId: from.expense.staffMemberId ?? undefined, month: from.row.month ?? month, gross: amount(from.row.gross), allowances: amount(from.row.allowances), deductions: amount(from.row.deductions), notes: from.expense.description, evidenceNote: from.expense.evidenceNote ?? undefined }
                : { staffMemberId: typeof sp.staff === "string" ? sp.staff : undefined, month }
            }
            maxMonth={thisMonth.slice(0, 7)}
            uploadMaxBytes={MAX_DOCUMENT_BYTES}
            cancelHref="/staff/salary-payments"
          />
        )}
      </Card>
    </>
  );
}
