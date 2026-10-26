-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'FINANCE', 'OPERATIONS', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AgreementType" AS ENUM ('RENTAL', 'OWNERSHIP', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeCategory" AS ENUM ('RENT', 'MANAGEMENT_FEE', 'SERVICE_CHARGE', 'SHARED_CHARGE', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyKey" AS ENUM ('DEFAULT_DUE_DAY');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('RECURRING', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MPESA', 'BANK', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('WATER', 'ELECTRICITY', 'SECURITY', 'CLEANING', 'GARBAGE', 'SALARIES', 'REPAIRS', 'MAINTENANCE', 'ADMINISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "floor" TEXT,
    "unitType" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "idNumber" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" "AgreementType" NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'ACTIVE',
    "reference" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "rentAmount" DECIMAL(14,2),
    "managementFeeAmount" DECIMAL(14,2),
    "dueDay" INTEGER,
    "graceDays" INTEGER,
    "purchaseDate" DATE,
    "ownershipEvidence" TEXT,
    "lateFeeTerms" TEXT,
    "allocationTerms" TEXT,
    "notes" TEXT,
    "endReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementCharge" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "category" "ChargeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingPolicy" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "key" "PolicyKey" NOT NULL,
    "value" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "BuildingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "BillingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "buildingId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "agreementId" TEXT,
    "billingRunId" TEXT,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE,
    "periodEnd" DATE,
    "issueDate" DATE,
    "dueDate" DATE,
    "total" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "category" "ChargeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "buildingId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedDate" DATE NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceNote" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "payee" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "servicePeriodStart" DATE,
    "servicePeriodEnd" DATE,
    "costCentre" TEXT,
    "evidenceNote" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "workOrderId" TEXT,
    "staffMemberId" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT,
    "salaryAmount" DECIMAL(14,2),
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "staffMemberId" TEXT,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT,
    "location" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "reportedVia" TEXT,
    "assignee" TEXT,
    "quoteAmount" DECIMAL(14,2),
    "quoteApproved" BOOLEAN,
    "outcome" TEXT,
    "costTreatment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_unitNumber_key" ON "Unit"("buildingId", "unitNumber");

-- CreateIndex
CREATE INDEX "Agreement_unitId_type_idx" ON "Agreement"("unitId", "type");

-- CreateIndex
CREATE INDEX "Agreement_partyId_idx" ON "Agreement"("partyId");

-- CreateIndex
CREATE INDEX "AgreementCharge_agreementId_idx" ON "AgreementCharge"("agreementId");

-- CreateIndex
CREATE INDEX "BuildingPolicy_buildingId_key_effectiveFrom_idx" ON "BuildingPolicy"("buildingId", "key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");

-- CreateIndex
CREATE INDEX "Invoice_unitId_idx" ON "Invoice"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_agreementId_periodStart_key" ON "Invoice"("agreementId", "periodStart");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_method_reference_key" ON "Payment"("method", "reference");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_number_key" ON "Expense"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_number_key" ON "WorkOrder"("number");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementCharge" ADD CONSTRAINT "AgreementCharge_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingPolicy" ADD CONSTRAINT "BuildingPolicy_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRun" ADD CONSTRAINT "BillingRun_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Integrity safeguards (hand-written; Prisma cannot express these)
-- ===========================================================================

-- One active agreement of each type per unit at any time.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_no_overlap"
  EXCLUDE USING gist (
    "unitId" WITH =,
    "type" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("status" <> 'CANCELLED');

ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_dates_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_due_day_check"
  CHECK ("dueDay" IS NULL OR "dueDay" BETWEEN 1 AND 28);
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_grace_check"
  CHECK ("graceDays" IS NULL OR "graceDays" >= 0);
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_rent_check"
  CHECK ("type" <> 'RENTAL' OR ("rentAmount" IS NOT NULL AND "rentAmount" > 0));
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_rent_only_rental_check"
  CHECK ("type" = 'RENTAL' OR "rentAmount" IS NULL);
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_fee_check"
  CHECK ("managementFeeAmount" IS NULL OR ("type" = 'MANAGEMENT' AND "managementFeeAmount" > 0));

ALTER TABLE "AgreementCharge" ADD CONSTRAINT "AgreementCharge_amount_check" CHECK ("amount" > 0);
ALTER TABLE "AgreementCharge" ADD CONSTRAINT "AgreementCharge_dates_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "AgreementCharge" ADD CONSTRAINT "AgreementCharge_category_check"
  CHECK ("category" NOT IN ('RENT', 'MANAGEMENT_FEE'));

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_total_check" CHECK ("total" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issued_fields_check"
  CHECK ("status" = 'DRAFT' OR ("number" IS NOT NULL AND "issueDate" IS NOT NULL AND "dueDate" IS NOT NULL));
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amount_check" CHECK ("amount" > 0);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amount" > 0);
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_salary_check" CHECK ("salaryAmount" IS NULL OR "salaryAmount" >= 0);
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_quote_check" CHECK ("quoteAmount" IS NULL OR "quoteAmount" >= 0);
ALTER TABLE "BuildingPolicy" ADD CONSTRAINT "BuildingPolicy_due_day_check"
  CHECK ("key" <> 'DEFAULT_DUE_DAY' OR "value" ~ '^([1-9]|1[0-9]|2[0-8])$');

-- Audit events are append-only.
CREATE FUNCTION bakaal_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: %', TG_OP, TG_TABLE_NAME, TG_ARGV[0];
END $$;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('audit events are append-only');
CREATE TRIGGER "AuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION bakaal_reject_change('audit events are append-only');

-- Posted financial records are never deleted.
CREATE TRIGGER "Payment_no_delete" BEFORE DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('payments are never deleted');
CREATE TRIGGER "PaymentAllocation_no_delete" BEFORE DELETE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('allocations are reversed, not deleted');
CREATE TRIGGER "CreditNote_no_change" BEFORE UPDATE OR DELETE ON "CreditNote"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('credit notes are immutable');
CREATE TRIGGER "BillingRun_no_change" BEFORE UPDATE OR DELETE ON "BillingRun"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('billing runs are immutable');

-- Issued invoices and their lines are immutable; only drafts may change.
CREATE FUNCTION bakaal_protect_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'ISSUED' THEN
      RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'ISSUED' THEN
    RAISE EXCEPTION 'issued invoice % cannot be changed', OLD."number";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Invoice_protect" BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_invoice();

CREATE FUNCTION bakaal_protect_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv_status text;
BEGIN
  SELECT "status" INTO inv_status FROM "Invoice"
   WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF inv_status = 'ISSUED' THEN
    RAISE EXCEPTION 'lines of an issued invoice cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "InvoiceLine_protect" BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_invoice_line();

-- A payment's amount, party, method and reference are fixed once it leaves PENDING.
CREATE FUNCTION bakaal_protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING' AND (
       NEW."amount" <> OLD."amount" OR NEW."partyId" <> OLD."partyId"
    OR NEW."method" <> OLD."method" OR NEW."reference" <> OLD."reference"
    OR NEW."receivedDate" <> OLD."receivedDate") THEN
    RAISE EXCEPTION 'payment details cannot change after verification or rejection';
  END IF;
  IF OLD."status" IN ('REJECTED', 'REVERSED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'a % payment cannot change status', OLD."status";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_protect" BEFORE UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_payment();

-- An allocation's amount and targets never change; it can only be marked reversed once.
CREATE FUNCTION bakaal_protect_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amount" <> OLD."amount" OR NEW."paymentId" <> OLD."paymentId"
     OR NEW."invoiceId" <> OLD."invoiceId" OR OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'allocations cannot be edited';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PaymentAllocation_protect" BEFORE UPDATE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_allocation();
