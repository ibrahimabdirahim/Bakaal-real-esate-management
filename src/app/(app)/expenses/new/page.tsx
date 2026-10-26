import { redirect } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { Card, PageHeader } from "@/components/ui";
import { ExpenseForm } from "../expense-form";
import { MAX_DOCUMENT_BYTES } from "@/server/storage";
import { createExpenseAction } from "../actions";
import { expenseFormOptions } from "../options";
import { getExpense } from "@/server/services/operations";
import { cents } from "@/server/services/common";
import { centsToDecimalString } from "@/lib/money";
import { optionalFromDbDate } from "@/lib/dates";
import { Receipt } from "lucide-react";

export const metadata = { title: "Record expense" };

export default async function NewExpensePage({ searchParams }: PageProps<"/expenses/new">) {
  const actor = await requirePage("expenses.submit");
  const sp = await searchParams;
  if (sp.category === "SALARIES") redirect("/staff/salary-payments/new");
  const allowSalaries = can(actor.role, "salary.view");
  const options = await expenseFormOptions();
  // "Record a corrected copy" of a rejected expense: start from its details; the rejected one stays as it is.
  const copy = typeof sp.copy === "string" ? (await getExpense(actor, sp.copy))?.expense : null;
  const fromCopy = copy && copy.status === "REJECTED" && copy.category !== "SALARIES" ? copy : null;
  return (
    <>
      <PageHeader
        icon={Receipt}
        title="Record expense"
        back={{ href: "/expenses", label: "Expenses" }}
        description={fromCopy ? `Corrected copy of rejected expense ${fromCopy.number}. Change what was wrong, then save or submit; the rejected expense is kept unchanged.` : undefined}
      />
      <Card>
        <ExpenseForm
          uploadMaxBytes={MAX_DOCUMENT_BYTES}
          action={createExpenseAction}
          allowSalaries={allowSalaries}
          {...options}
          defaults={
            fromCopy
              ? {
                  category: fromCopy.category,
                  payee: fromCopy.payee,
                  description: fromCopy.description,
                  amount: centsToDecimalString(cents(fromCopy.amount)!),
                  servicePeriodStart: optionalFromDbDate(fromCopy.servicePeriodStart) ?? undefined,
                  servicePeriodEnd: optionalFromDbDate(fromCopy.servicePeriodEnd) ?? undefined,
                  costCentre: fromCopy.costCentre ?? undefined,
                  evidenceNote: fromCopy.evidenceNote ?? undefined,
                  workOrderId: fromCopy.workOrderId ?? undefined,
                }
              : { workOrderId: typeof sp.workOrderId === "string" ? sp.workOrderId : undefined, category: typeof sp.category === "string" ? sp.category : undefined }
          }
        />
      </Card>
    </>
  );
}
