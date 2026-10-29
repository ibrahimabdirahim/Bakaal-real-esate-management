-- F65: one recurring charge is billed once per month, so charge types can be billed separately.
-- Existing invoices, lines, payments and credits are not changed.

-- 1. The identity of a recurring charge occurrence: agreement + month + charge source.
CREATE TABLE "BilledCharge" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "category" "ChargeCategory" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BilledCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BilledCharge_agreementId_periodStart_sourceType_sourceId_key" ON "BilledCharge"("agreementId", "periodStart", "sourceType", "sourceId");
CREATE INDEX "BilledCharge_invoiceId_idx" ON "BilledCharge"("invoiceId");
ALTER TABLE "BilledCharge" ADD CONSTRAINT "BilledCharge_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BilledCharge" ADD CONSTRAINT "BilledCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BilledCharge" ADD CONSTRAINT "BilledCharge_amount_check" CHECK ("amount" > 0);
ALTER TABLE "BilledCharge" ADD CONSTRAINT "BilledCharge_period_check" CHECK (EXTRACT(DAY FROM "periodStart") = 1);

-- 2. Every recurring charge already invoiced is recorded. No ON CONFLICT: if any charge was ever billed
--    twice for one month, this migration fails and changes nothing, so it can be reviewed first.
--    createdAt is the invoice's own time (written by the app in UTC), not the server's clock.
INSERT INTO "BilledCharge" ("id", "agreementId", "periodStart", "category", "sourceType", "sourceId", "invoiceId", "amount", "createdAt")
SELECT 'bc_' || l."id", i."agreementId", i."periodStart", l."category", l."sourceType", l."sourceId", i."id", l."amount", i."createdAt"
FROM "InvoiceLine" l
JOIN "Invoice" i ON i."id" = l."invoiceId"
WHERE i."kind" = 'RECURRING' AND i."agreementId" IS NOT NULL AND i."periodStart" IS NOT NULL AND l."sourceId" IS NOT NULL;

-- 3. Billed charges are a permanent record, like billing runs.
CREATE TRIGGER "BilledCharge_no_change" BEFORE UPDATE OR DELETE ON "BilledCharge"
  FOR EACH ROW EXECUTE FUNCTION bakaal_reject_change('billed charges are permanent');

-- 4. An agreement may now have several invoices for a month (one per separately billed charge type);
--    the per-charge rule above replaces the per-agreement one. Kept as an index for lookups.
DROP INDEX "Invoice_agreementId_periodStart_key";
CREATE INDEX "Invoice_agreementId_periodStart_idx" ON "Invoice"("agreementId", "periodStart");

-- 5. What each billing run covered and its outcome (null / empty on earlier runs).
ALTER TABLE "BillingRun" ADD COLUMN "chargeTypes" "ChargeCategory"[] NOT NULL DEFAULT ARRAY[]::"ChargeCategory"[],
ADD COLUMN "partyIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'BILLING_PAGE',
ADD COLUMN "totalAmount" DECIMAL(14,2),
ADD COLUMN "alreadyBilledCount" INTEGER,
ADD COLUMN "reviewCount" INTEGER,
ADD COLUMN "notApplicableCount" INTEGER;
ALTER TABLE "BillingRun" ADD CONSTRAINT "BillingRun_source_check" CHECK ("source" IN ('BILLING_PAGE', 'REGISTRATION'));
