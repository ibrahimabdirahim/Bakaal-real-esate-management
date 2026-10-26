-- F59: remove the unused isDemo flag (the demo environment was removed in F58). Only these three
-- columns are dropped; no rows change. Every dropped value was false, so re-adding each column with
-- `BOOLEAN NOT NULL DEFAULT false` restores the previous state exactly.
-- AlterTable
ALTER TABLE "Building" DROP COLUMN "isDemo";
-- AlterTable
ALTER TABLE "Party" DROP COLUMN "isDemo";
-- AlterTable
ALTER TABLE "StaffMember" DROP COLUMN "isDemo";
