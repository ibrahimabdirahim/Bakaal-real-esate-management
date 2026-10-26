-- Salary payments are salary expenses (category SALARIES) linked to a staff member and a month,
-- with their gross / allowances / deductions breakdown, and the date the money was actually paid.
-- Additive only: existing rows are unchanged (the new columns are empty for them).

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "paidDate" DATE,
ADD COLUMN "salaryAllowances" DECIMAL(14,2),
ADD COLUMN "salaryDeductions" DECIMAL(14,2),
ADD COLUMN "salaryGross" DECIMAL(14,2);

-- The breakdown is only for salaries, never negative, and always adds up to the amount paid (net).
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_salary_breakdown_check" CHECK (
  "salaryGross" IS NULL
  OR (
    "category" = 'SALARIES'
    AND "salaryGross" > 0
    AND COALESCE("salaryAllowances", 0) >= 0
    AND COALESCE("salaryDeductions", 0) >= 0
    AND "amount" = "salaryGross" + COALESCE("salaryAllowances", 0) - COALESCE("salaryDeductions", 0)
  )
);

-- One salary payment per staff member and salary month; a rejected one frees the month.
-- (An exclusion constraint, like Agreement_no_overlap, so concurrent saves cannot both succeed.)
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_one_salary_per_staff_month"
  EXCLUDE USING btree ("staffMemberId" WITH =, "servicePeriodStart" WITH =)
  WHERE ("category" = 'SALARIES' AND "status" <> 'REJECTED');
