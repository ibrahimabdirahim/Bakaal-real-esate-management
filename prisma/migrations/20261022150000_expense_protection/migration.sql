-- Expenses, including salary payments, follow Draft → Submitted → Approved / Rejected → Paid.
-- Database protection like that of payments and invoices:
--   * a draft may change freely;
--   * once submitted, what was asked for (payee, amounts, period, links, who submitted) is fixed;
--   * a submitted expense can only be approved or rejected; an approved one only marked paid;
--   * a paid or rejected expense never changes (a correction is a new record);
--   * only drafts can be deleted.
-- Trigger only: no table or row is changed by this migration.

CREATE FUNCTION bakaal_protect_expense() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'expense % cannot be deleted once submitted', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('PAID', 'REJECTED') THEN
    RAISE EXCEPTION 'a % expense cannot be changed (%)', lower(OLD."status"::text), OLD."number";
  END IF;
  IF OLD."status" <> 'DRAFT' AND ROW(
       NEW."number", NEW."buildingId", NEW."category", NEW."payee", NEW."description", NEW."amount",
       NEW."servicePeriodStart", NEW."servicePeriodEnd", NEW."costCentre", NEW."evidenceNote",
       NEW."workOrderId", NEW."staffMemberId", NEW."salaryGross", NEW."salaryAllowances", NEW."salaryDeductions",
       NEW."createdById", NEW."createdAt", NEW."submittedById", NEW."submittedAt")
     IS DISTINCT FROM ROW(
       OLD."number", OLD."buildingId", OLD."category", OLD."payee", OLD."description", OLD."amount",
       OLD."servicePeriodStart", OLD."servicePeriodEnd", OLD."costCentre", OLD."evidenceNote",
       OLD."workOrderId", OLD."staffMemberId", OLD."salaryGross", OLD."salaryAllowances", OLD."salaryDeductions",
       OLD."createdById", OLD."createdAt", OLD."submittedById", OLD."submittedAt") THEN
    RAISE EXCEPTION 'the details of a submitted expense cannot be changed (%)', OLD."number";
  END IF;
  IF OLD."status" = 'SUBMITTED' AND NEW."status" NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'a submitted expense can only be approved or rejected (%)', OLD."number";
  END IF;
  IF OLD."status" = 'APPROVED' AND (
       NEW."status" NOT IN ('APPROVED', 'PAID')
    OR ROW(NEW."decidedById", NEW."decidedAt", NEW."decisionReason") IS DISTINCT FROM ROW(OLD."decidedById", OLD."decidedAt", OLD."decisionReason")) THEN
    RAISE EXCEPTION 'an approved expense can only be marked as paid (%)', OLD."number";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Expense_protect" BEFORE UPDATE OR DELETE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_expense();
