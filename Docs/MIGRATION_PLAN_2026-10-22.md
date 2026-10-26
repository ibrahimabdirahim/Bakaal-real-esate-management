# Migration plan — expense links and staff foreign keys (proposal, not applied)

Status: **for approval**. Nothing in this plan has been applied to any database. Findings below
come from read-only queries on 2026-10-22.

## 1. Findings

### Staff IDs on records

These columns store a staff user's ID but are not database foreign keys:

| Table | Columns |
|---|---|
| Payment | recordedById, verifiedById, rejectedById, reversedById |
| PaymentAllocation | createdById |
| Invoice | createdById, issuedById |
| CreditNote | createdById |
| BillingRun | issuedById |
| Expense | createdById, submittedById, decidedById, paidById |
| Agreement | createdById |
| BuildingPolicy | createdById, approvedById |
| WorkOrder, StaffTask | createdById, completedById |
| Document | uploadedById, removedById |

- **`bakaal_dev`: 0 orphaned values in every column**, so a database link could be added without changing any existing row.
- **`bakaal_test`: every value is orphaned.** The automated tests use invented staff IDs such as `admin-1`, through `actor()` in `src/server/testing.ts`.
- Staff users are never deleted; they are deactivated. The application has no delete-user path.

### Expenses

- `Expense` links to a work order (and, through it, to a unit) and to a staff member for salaries. It has no direct unit or account link.
- `bakaal_dev` has **no expenses yet**, so a new optional link affects no existing record.

## 2. Proposal A — staff foreign keys (data-preserving)

1. **Tests first.** Change `actor()` in `src/server/testing.ts` to create (upsert) a real `User` row for each synthetic actor. Run the full suite to confirm nothing depends on invented IDs.
2. **Migration**, one SQL file. For each column above:
   `ALTER TABLE … ADD CONSTRAINT …_fkey FOREIGN KEY (col) REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;`
   then `ALTER TABLE … VALIDATE CONSTRAINT …;`
   `NOT VALID` adds the rule without rewriting data; `VALIDATE` then checks the existing rows and fails safely, changing nothing, if any orphan appeared since this analysis.
3. **Prisma schema:** add the matching relations (for example `recordedBy User @relation("PaymentRecordedBy", …)`) so pages can show names without extra lookups.
4. **Not linked: `AuditEvent.actorId`.** The audit log is append-only evidence. It must keep entries by the system (null actor) and stay readable whatever happens to accounts. It already stores the actor's e-mail.
5. **Safety:** take a verified backup (procedure in `~/Bakaal-db-backups/*/RECOVERY.md`), run `npm run db:check`, apply to `bakaal_test`, then to `bakaal_dev`, then run `db:check` again. Rollback is `ALTER TABLE … DROP CONSTRAINT …`, which leaves the data untouched.

## 3. Proposal B — expense ↔ unit / account links

1. **Migration:** add nullable `Expense.unitId` → `Unit(id)` and `Expense.partyId` → `Party(id)`, both `ON DELETE RESTRICT`, with indexes. Existing rows stay null.
2. **Rules** (service layer, `createExpense` / `updateDraftExpense`):
   - The unit must belong to the building.
   - If the expense is linked to a work order that has a unit, the two units must match.
   - The account link is **informational only**: it never creates a charge, never changes a balance and is never counted as rent. Recovering a cost from an occupant stays a separate, approved charge or manual invoice.
   - Archived accounts cannot be newly linked.
3. **Backfill:** none by default. Optionally, set `unitId` from the linked work order's unit, as a reviewed one-off script that lists every row it would change, with an audit event per change. Today there are no rows to backfill.
4. **Screens:** a unit and an optional account selector on the expense form; expense lists filterable by unit; the unit and account pages list their linked expenses; expense reports by unit.
5. **Delete safety:** `deleteBlocker` must also count expenses linked to an account, so an account referenced by an expense cannot be deleted.

## 4. Decisions needed

1. Approve Proposal A (staff foreign keys).
2. Approve Proposal B (unit link and/or account link), and whether to backfill from work orders.
3. Still open from earlier: whether open maintenance should make a unit unavailable; agreement document templates.
