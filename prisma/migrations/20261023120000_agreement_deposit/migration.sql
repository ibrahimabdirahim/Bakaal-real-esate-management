-- F52: the deposit agreed in a rental agreement (owner approval, 2026-10-23). An agreed term only:
-- it is not billed, not money received and not part of any balance. Nullable = no deposit recorded.
ALTER TABLE "Agreement" ADD COLUMN "depositAmount" DECIMAL(14,2);
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_depositAmount_check"
  CHECK ("depositAmount" IS NULL OR ("depositAmount" >= 0 AND "type" = 'RENTAL'));
