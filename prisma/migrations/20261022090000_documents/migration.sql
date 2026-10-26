-- Documents: metadata of uploaded files (PDF, JPEG, PNG). Files live in private storage,
-- never in the database. Attached documents are never deleted, only soft-removed.

-- CreateEnum
CREATE TYPE "DocumentOwner" AS ENUM ('PARTY', 'AGREEMENT', 'UNIT', 'PAYMENT', 'EXPENSE', 'WORK_ORDER', 'STAFF_MEMBER');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('ID_DOCUMENT', 'SIGNED_AGREEMENT', 'PHOTO', 'PROOF_OF_PAYMENT', 'RECEIPT', 'SUPPLIER_INVOICE', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "ownerType" "DocumentOwner",
    "ownerId" TEXT,
    "category" "DocumentCategory" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removeReason" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_ownerType_ownerId_idx" ON "Document"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Document_uploadedById_attachedAt_idx" ON "Document"("uploadedById", "attachedAt");


-- A document is either staged (no owner yet) or attached to exactly one record.
ALTER TABLE "Document" ADD CONSTRAINT "Document_owner_pair" CHECK (("ownerType" IS NULL) = ("ownerId" IS NULL));
ALTER TABLE "Document" ADD CONSTRAINT "Document_attached_has_time" CHECK ("ownerType" IS NULL OR "attachedAt" IS NOT NULL);
ALTER TABLE "Document" ADD CONSTRAINT "Document_size_positive" CHECK ("sizeBytes" > 0);
ALTER TABLE "Document" ADD CONSTRAINT "Document_allowed_type" CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png'));
ALTER TABLE "Document" ADD CONSTRAINT "Document_removal_complete" CHECK (("removedAt" IS NULL) = ("removedById" IS NULL));

-- Attached documents are evidence: they may be soft-removed but never deleted, moved to another
-- record or have their stored file swapped. Only never-attached (staged) uploads may be deleted.
CREATE FUNCTION bakaal_protect_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."ownerType" IS NOT NULL THEN RAISE EXCEPTION 'attached documents are never deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."ownerType" IS NOT NULL AND (
       NEW."ownerType" IS DISTINCT FROM OLD."ownerType" OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."storageKey" <> OLD."storageKey" OR NEW."sha256" <> OLD."sha256" OR NEW."sizeBytes" <> OLD."sizeBytes"
    OR NEW."mimeType" <> OLD."mimeType" OR NEW."uploadedById" <> OLD."uploadedById"
    OR (OLD."removedAt" IS NOT NULL AND NEW."removedAt" IS DISTINCT FROM OLD."removedAt")) THEN
    RAISE EXCEPTION 'attached document details cannot change; documents is not allowed to be moved or restored';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Document_protect" BEFORE UPDATE OR DELETE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION bakaal_protect_document();
