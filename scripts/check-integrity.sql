-- Read-only integrity checks (SELECT only). Every query must return 0 rows/0.
SELECT 'invoice total differs from its lines' AS check, count(*) AS problems FROM "Invoice" i
  WHERE i.total <> (SELECT coalesce(sum(l.amount), 0) FROM "InvoiceLine" l WHERE l."invoiceId" = i.id)
UNION ALL SELECT 'payment over-allocated', count(*) FROM "Payment" p
  WHERE (SELECT coalesce(sum(a.amount), 0) FROM "PaymentAllocation" a WHERE a."paymentId" = p.id AND a."reversedAt" IS NULL) > p.amount
UNION ALL SELECT 'invoice paid/credited beyond its total', count(*) FROM "Invoice" i
  WHERE (SELECT coalesce(sum(a.amount), 0) FROM "PaymentAllocation" a WHERE a."invoiceId" = i.id AND a."reversedAt" IS NULL)
      + (SELECT coalesce(sum(c.amount), 0) FROM "CreditNote" c WHERE c."invoiceId" = i.id) > i.total
UNION ALL SELECT 'active allocation on a payment that is not verified', count(*) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId"
  WHERE a."reversedAt" IS NULL AND p.status <> 'VERIFIED'
UNION ALL SELECT 'allocation to a draft invoice', count(*) FROM "PaymentAllocation" a JOIN "Invoice" i ON i.id = a."invoiceId" WHERE i.status <> 'ISSUED'
UNION ALL SELECT 'allocation across different accounts', count(*) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" JOIN "Invoice" i ON i.id = a."invoiceId" WHERE p."partyId" <> i."partyId"
UNION ALL SELECT 'verified payment without receipt number', count(*) FROM "Payment" WHERE status IN ('VERIFIED', 'REVERSED') AND "receiptNumber" IS NULL
UNION ALL SELECT 'issued invoice without number or issue date', count(*) FROM "Invoice" WHERE status = 'ISSUED' AND (number IS NULL OR "issueDate" IS NULL)
UNION ALL SELECT 'invoice unit/account differs from its agreement', count(*) FROM "Invoice" i JOIN "Agreement" g ON g.id = i."agreementId" WHERE i."unitId" <> g."unitId" OR i."partyId" <> g."partyId"
UNION ALL SELECT 'rent on an ownership or management agreement', count(*) FROM "Agreement" WHERE type <> 'RENTAL' AND "rentAmount" IS NOT NULL
UNION ALL SELECT 'management fee outside a management agreement', count(*) FROM "Agreement" WHERE type <> 'MANAGEMENT' AND "managementFeeAmount" IS NOT NULL
UNION ALL SELECT 'RENT line from a non-rental agreement', count(*) FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" JOIN "Agreement" g ON g.id = i."agreementId" WHERE l.category = 'RENT' AND g.type <> 'RENTAL'
UNION ALL SELECT 'MANAGEMENT_FEE line from a non-management agreement', count(*) FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" JOIN "Agreement" g ON g.id = i."agreementId" WHERE l.category = 'MANAGEMENT_FEE' AND g.type <> 'MANAGEMENT'
UNION ALL SELECT 'management agreement without an ownership record', count(*) FROM "Agreement" m WHERE m.type = 'MANAGEMENT' AND m.status <> 'CANCELLED'
  AND NOT EXISTS (SELECT 1 FROM "Agreement" o WHERE o.type = 'OWNERSHIP' AND o.status <> 'CANCELLED' AND o."unitId" = m."unitId" AND o."partyId" = m."partyId" AND o."startDate" <= m."startDate")
UNION ALL SELECT 'recurring charge billed twice in one month', count(*) FROM (SELECT i."agreementId", i."periodStart", l."sourceType", l."sourceId" FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE i.kind = 'RECURRING' GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d
UNION ALL SELECT 'recurring invoice line without its billed-charge record', count(*) FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE i.kind = 'RECURRING'
  AND NOT EXISTS (SELECT 1 FROM "BilledCharge" b WHERE b."invoiceId" = i.id AND b."sourceType" = l."sourceType" AND b."sourceId" = l."sourceId" AND b.amount = l.amount AND b.category = l.category)
UNION ALL SELECT 'billed-charge record without its invoice line', count(*) FROM "BilledCharge" b JOIN "Invoice" i ON i.id = b."invoiceId"
  WHERE i."agreementId" IS DISTINCT FROM b."agreementId" OR i."periodStart" IS DISTINCT FROM b."periodStart"
  OR NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i.id AND l."sourceType" = b."sourceType" AND l."sourceId" = b."sourceId")
UNION ALL SELECT 'agreement or charge on an archived account', count(*) FROM "Agreement" g JOIN "Party" p ON p.id = g."partyId" WHERE p."archivedAt" IS NOT NULL AND g."createdAt" > p."archivedAt"
UNION ALL SELECT 'attached document whose record is missing', count(*) FROM "Document" d WHERE d."ownerType" IS NOT NULL AND NOT (
     (d."ownerType" = 'PARTY' AND (EXISTS (SELECT 1 FROM "Party" x WHERE x.id = d."ownerId") OR EXISTS (SELECT 1 FROM "AuditEvent" e WHERE e."entityId" = d."ownerId" AND e.action = 'account.delete')))
  OR (d."ownerType" = 'AGREEMENT' AND EXISTS (SELECT 1 FROM "Agreement" x WHERE x.id = d."ownerId"))
  OR (d."ownerType" = 'UNIT' AND EXISTS (SELECT 1 FROM "Unit" x WHERE x.id = d."ownerId"))
  OR (d."ownerType" = 'PAYMENT' AND EXISTS (SELECT 1 FROM "Payment" x WHERE x.id = d."ownerId"))
  OR (d."ownerType" = 'EXPENSE' AND EXISTS (SELECT 1 FROM "Expense" x WHERE x.id = d."ownerId"))
  OR (d."ownerType" = 'WORK_ORDER' AND EXISTS (SELECT 1 FROM "WorkOrder" x WHERE x.id = d."ownerId"))
  OR (d."ownerType" = 'STAFF_MEMBER' AND EXISTS (SELECT 1 FROM "StaffMember" x WHERE x.id = d."ownerId")))
UNION ALL SELECT 'paid expense that was never approved', count(*) FROM "Expense" WHERE status = 'PAID' AND "decidedById" IS NULL;
