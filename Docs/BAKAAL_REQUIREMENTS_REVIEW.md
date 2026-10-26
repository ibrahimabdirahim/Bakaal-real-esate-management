# Bakaal Real Estate Management System — Requirements Review

**Status:** PROPOSED. Awaiting owner approval. No code has been written.
**Date:** 2026-10-20
**Sources reviewed:**
- `Docs/BAKAAL_REAL_ESTATE_MANAGEMENT_SYSTEM_DEVELOPMENT_MASTER_PLAN.md` ("the Plan")
- `Docs/ updated Bakaal_Real_Estate_Management_System_Prototype_Revised (1).docx` ("the Prototype"). Note: the filename begins with a space character.

**How to read this report.** Every item is tagged:
- **[Both]**: explicitly stated in the Plan and the Prototype.
- **[Proto]**: explicitly stated only in the Prototype.
- **[Plan]**: explicitly stated only in the Plan.
- **[Rec]**: my recommendation. It is *not* in either document and needs your approval.
- **[?]**: not decided in either document. I have not invented an answer.

**Limits of this review.**
- The Prototype has 18 numbered "Design" sections. I checked the embedded images: only two are real screen mockups (the Admin Login and the Building Dashboard). The other design images are generic placeholder frames with the title "Screen content / workflow controls". Their *text* is the only real specification for those screens.
- All figures in the Prototype (48 units, KES 980K, etc.) are marked "Sample data is illustrative". I have treated them as examples, not requirements.
- The Prototype's text says "Recommended baseline" and "A practical stack is…". The stack is therefore a suggestion in both documents, not a fixed decision.

---

## 1. Executive Summary

The two documents agree on the big picture. This is an **internal, staff-only** system. Tenants and owners are records, not users. The system covers units, accounts (renters and owners), agreements, invoices, payments with verification, expenses with approval, staff and salaries, maintenance, notices, reports, settings and an audit trail. Financial history is never silently edited. Corrections are made by credit or reversal.

**What the Prototype adds beyond the Plan** (and which matters for the design):
- M-Pesa, bank and cash payments, with idempotent provider callbacks.
- Email/SMS notices through a background worker.
- Idempotent billing runs with rate snapshots.
- PDF/Excel export.
- Expense approval thresholds.
- A cost-centre field on expenses.
- Meter readings.
- Settings versioned by effective date.
- Kenya-specific currency (KES) and data-protection references.

**The most important conflicts and gaps:**
1. **One building or many?** The Plan says "properties, buildings, floors, and units". The Prototype's login screen says "One building • staff-managed records • no tenant login", and its data model has a single "Building" record ("One record for the property"). This changes the data model and must be decided first.
2. **Roles differ.** The Plan has seven provisional roles. The Prototype has five. They do not map one-to-one (see §3).
3. **Many billing rules are undefined in both documents**: due dates, grace periods, late fees, shared-expense allocation, partial payments, overpayments, final bills, and approval thresholds (see §7).
4. **The Plan's "Notifications" module is too thin** compared with the Prototype's queued, rechecked, logged email/SMS workflow.
5. **The Prototype does not describe salary payment mechanics in detail.** It says only that salary access is restricted and that salary is separate from task completion. Payroll scope (full payroll or just recording salary as an expense) is undecided.

**Verdict on the proposed stack:** Next.js + TypeScript + PostgreSQL + Prisma is suitable. The Plan needs additions to meet the financial-integrity requirements: a background job runner, private file storage, and a clear rule that business logic lives in a tested service layer rather than in route handlers. The Plan also needs a testing strategy for money calculations (see §8).

---

## 2. Confirmed Requirements

"Confirmed" means stated explicitly in the documents. It does **not** mean the owner has approved my interpretation.

### 2.1 Scope and access
| # | Requirement | Source |
|---|---|---|
| C1 | Internal staff-only application. Tenants and owners have **no login**; there is no public or tenant self-registration. | [Both] |
| C2 | "Account category" (renter, owner, etc.) is a billing classification, **not** a login role. | [Proto] |
| C3 | Every staff user has an assigned role. Permissions are enforced on the server, not only by hiding buttons. | [Both] |
| C4 | Unauthorised users cannot reach the application **or its APIs**. | [Both] |
| C5 | Secure cookies, password hashing, rate limiting on login, and password reset. | [Proto]; the Plan says "secure authentication/session management/password hashing" |

### 2.2 Units and accounts
| # | Requirement | Source |
|---|---|---|
| C6 | Unit has a unique unit number, floor, type, status, and meters. Dated occupancy history is kept. | [Proto]; the Plan lists "floors, units, unit types, occupancy status, history" |
| C7 | The system must reject conflicting **active** assignments on one unit. | [Proto] |
| C8 | A unit's status (occupied/vacant/purchased) must be consistent with its account type. | [Proto] |
| C9 | Record categories: rent-paying tenant, purchased unit owner, purchased unit managed by Bakaal, vacant unit, former occupant/owner. | [Both] (names differ slightly) |
| C10 | Former occupants and past transactions remain available. Future changes must not rewrite issued invoices. | [Both] |
| C11 | A rental agreement requires dates, rent amount and fee policy. An owner record requires **ownership evidence** (purchase date and documents). | [Proto] |
| C12 | Previous owner history is preserved. | [Proto] |
| C13 | Sensitive documents are protected (private storage). | [Both] |

### 2.3 Billing and payments
| # | Requirement | Source |
|---|---|---|
| C14 | Rent is billed only to accounts with an active rent-paying agreement. Rent and shared/service charges are shown separately. | [Both] |
| C15 | Purchased unit owners pay **no rent by default**. Only approved, applicable shared expenses apply. | [Both] |
| C16 | Units managed by Bakaal: no rent by default. Charge the agreed management fee plus applicable shared expenses per the management agreement. | [Both] |
| C17 | Vacant units: no invoice without a valid agreement. | [Both] |
| C18 | After an agreement ends, stop future billing after the effective end date but retain history. | [Both] |
| C19 | Billing runs are **idempotent**: re-running a period never creates duplicate invoices. | [Both] |
| C20 | Billing snapshots rates and rule references on invoices. | [Proto] |
| C21 | The billing run has a preview and an exception/validation list before invoices are issued. | [Proto] |
| C22 | Payments must be **verified** before balances update. Partial allocations are supported. Uploaded proof alone is not confirmation. | [Proto]; the Plan says "verify according to permissions" |
| C23 | Provider callbacks (M-Pesa) are idempotent. A duplicate callback cannot create a duplicate receipt. | [Proto] |
| C24 | Payment methods: M-Pesa, bank, cash. Each payment has a unique reference and a received date. | [Proto] |
| C25 | Invoice balance must equal the sum of payment allocations. | [Proto] |
| C26 | Posted financial records are never silently edited or deleted. They are corrected through credit or reversal. | [Both] |
| C27 | Reports reconcile: opening + charges − payments − credits = closing. | [Proto] |

### 2.4 Expenses, staff, maintenance
| # | Requirement | Source |
|---|---|---|
| C28 | Expense outflow is separate from charge income. Recording an expense **does not automatically bill occupants**. | [Proto] |
| C29 | Expense workflow: draft → submit → approver approves/rejects (with a reason) → finance marks paid after verification → appears in reports. | [Proto] |
| C30 | Expense fields: category, payee, amount, service period, cost centre, evidence, approval route, payment method. | [Proto] |
| C31 | Role and **threshold** checks apply to approvals. All decisions are logged. | [Proto] |
| C32 | Staff records (cleaners, guards, caretakers) have assignments, salary period/status and recurring schedules. | [Proto] |
| C33 | Salary access is restricted. Task completion is separate from salary payment. Operations staff cannot see unrestricted salary details. | [Proto] |
| C34 | Work orders cover units and shared areas, with priority, assignee/vendor, quote approval, completion evidence and cost. A closed work order must have an outcome and cost treatment. | [Proto] |
| C35 | Staff record issues that arrive by phone, email or in person. | [Proto] |

### 2.5 Notices, reports, settings, audit
| # | Requirement | Source |
|---|---|---|
| C36 | Notices: invoice notice, due reminder, overdue reminder, receipt. Delivery via email/SMS, with a log (queued/sent/failed/suppressed) and retries. | [Proto] |
| C37 | The overdue reminder rechecks the balance **at dispatch**. Reminders are suppressed once paid. | [Proto] |
| C38 | Reports: occupancy/vacant units, rent roll and owner shared charges, collections and arrears ageing, expenses/maintenance/staff. PDF and Excel export. Permission-controlled. | [Proto]; the Plan lists reports more generally |
| C39 | Dashboard KPIs come from source records, with documented formulas. Totals match detail ledgers and reports. | [Both] |
| C40 | Settings: building profile and currency, billing day, grace period, shared charge rules, roles and permissions. Settings that affect billing are versioned with an effective date. | [Proto] |
| C41 | Audit trail: actor, timestamp, action, record ID, before/after summary. Covers invoice, payment, expense and permission changes. Never logs passwords or secrets. Audit history is protected. | [Both] |
| C42 | Navigation (from the dashboard mockup): Overview, Units, Accounts, Billing & Payments, Expenses, Staff & Services, Maintenance, Reports, Messages, Settings, Audit Log. | [Proto] |

---

## 3. User Roles and Permissions

### 3.1 Role comparison

| Prototype role [Proto] | Prototype access | Closest Plan role [Plan] | Notes |
|---|---|---|---|
| System administrator / building owner | All modules, configuration, staff accounts, permissions, audit log | System Administrator | Equivalent. The Prototype merges "building owner" into this role. |
| Building manager | Units, accounts, occupancy, billing review, maintenance, notices, operational reports | Property Manager | Equivalent. |
| Finance officer | Invoices, payment verification, receipts, expenses, finance reports | Finance Officer | Equivalent. |
| Operations staff | Assigned tasks and expense submissions; restricted salary/finance access | Maintenance Staff | **Not equivalent.** The Prototype's role also submits expenses and has task duties. |
| Read-only auditor | Approved reports and audit trail; no editing | Read-Only User | The Prototype's role also reads the **audit trail**, which the Plan does not mention. |
| *(none)* | | Cashier / Payment Recorder | **Plan only.** |
| *(none)* | | Approver | **Plan only.** In the Prototype, approval is performed by an unnamed "approver" in the expense workflow. |

### 3.2 Permission rules stated in the documents
- Least privilege. [Both]
- Payment *recording* is separate from payment *verification*. [Plan: "where required"; Proto: "record pending payment → verify"]
- Only administrators manage staff accounts, roles and sensitive settings. [Plan]
- The operations role cannot edit finance settings. [Proto]
- Operations staff cannot see unrestricted salary details. [Proto]
- Unauthorised staff cannot approve restricted expenses. [Proto]
- Permission changes and privileged actions are audited. [Both]

### 3.3 Recommendations
- **[Rec]** Use a **permission-based** model: each action has a permission string such as `payment.verify` or `expense.approve`, and roles are named bundles of permissions. This lets "Approver" and "Cashier" be permissions rather than separate people. It handles a small team where one person holds several duties.
- **[Rec]** Enforce **separation of duties** in code: the person who records a payment cannot verify it, and the person who submits an expense cannot approve it. Neither document says whether this is absolute. This is question Q10.
- **[Rec]** Keep the role list at the Prototype's five roles, plus the Plan's "Approver" and "Cashier" as optional permission bundles, pending your decision (Q3).

---

## 4. Core Workflows

All steps below are from the Prototype unless marked.

### 4.1 Staff login [Both]
Staff enters credentials → server validates the account is active and has a role → opens the authorised workspace. Reset-password link and rate limits apply.

### 4.2 Register a renter or owner and assign a unit [Proto]
Search or create the person → choose account type → assign a unit and dates → validate (no conflicting active assignment, type consistent with unit status) → save.
- Rent requires an active rental agreement.
- An owner requires ownership evidence.

### 4.3 Purchased unit and owner [Proto]
Mark the unit purchased or owner-occupied → attach ownership evidence → set the applicable shared-charge policy → the owner generates no rent line by default.

### 4.4 Monthly billing run [Proto]
Run billing for a period → apply active agreements and fee rules → check duplicates and exceptions → preview → issue invoices. Retrying the same period does not duplicate invoices.

### 4.5 Invoice, arrears and corrections [Proto]
Open an invoice → review line items and allocations → correct through credit or reversal. Filters: unpaid, part-paid, overdue.

### 4.6 Payment verification [Proto]
Record a pending payment → verify provider, bank or cash evidence → allocate to invoice(s) → confirm → issue a receipt.

### 4.7 Expense approval [Proto]
Save as draft or submit → approver approves or rejects with a reason → finance marks paid after verification → posted expense appears in reports.

### 4.8 Staff, tasks and salary [Proto]
Create a staff record → assign schedules and tasks → record completion → review salary expense and exceptions. Salary payment is separate from task completion.

### 4.9 Maintenance [Proto]
Create a work order from an inspection or report → assign a worker or vendor → approve the quote if needed → record completion and the expense link.

### 4.10 Notices [Proto]
An event queues a message → a worker checks eligibility and sends → the balance is rechecked before an overdue reminder → the result and any retries are logged.

### 4.11 Settings change [Proto]
Admin changes a setting → validated and saved **with an effective date** → audit event written.

### 4.12 Audit review [Proto]
The system logs material actions → an authorised reviewer investigates → errors are corrected through reversal or adjustment.

---

## 5. Financial and Billing Rules

### 5.1 Rules the documents state (see C14–C27)
1. Rent is only for active rent-paying agreements.
2. Owners: no rent by default; approved shared charges only.
3. Bakaal-managed purchased units: no rent; management fee plus shared charges per the management agreement.
4. Vacant units: no invoices without a valid agreement.
5. Ended agreements: stop future billing after the effective end date; keep history.
6. Rent, management fees, shared expenses and other charges stay distinguishable on invoices. [Plan: "distinguishable"; Proto: "Rent + approved shared/service charges"]
7. Each charge records its source and period. [Plan]
8. No duplicate recurring invoices for the same agreement and period. [Both]
9. Payments are verified before balances change; partial allocations are supported. [Proto]
10. No silent deletion or edits of posted records; use credit/reversal. [Both]
11. Operating expenses and charge income are separate records. Expenses do not auto-bill occupants. [Proto]
12. Reports reconcile to the ledger: opening + charges − payments − credits = closing. [Proto]
13. Use database transactions where needed, and decimal types for money. Never trust client-submitted totals. [Plan]

### 5.2 Recommendations for implementing those rules
- **[Rec] Store money as integer minor units or as `Decimal(18,2)`. Never as floating-point.** The Plan already says "decimal". I recommend confirming `Decimal` in Prisma and doing all arithmetic with a decimal library, not JavaScript `number`.
- **[Rec] Ledger model.** Treat invoices, payment allocations, credit notes and reversals as **append-only** rows. Derive balances by summing, rather than keeping an editable "balance" field. Any cached balance must be reproducible from the ledger.
- **[Rec] Database constraints as a second line of defence.** Add a unique constraint on (agreement, billing period, charge type) to enforce idempotent billing. Add a unique constraint on (payment method, external reference) to enforce duplicate-payment protection. Add a check that an allocation cannot exceed the payment or the invoice balance.
- **[Rec] Immutability after issue.** Once an invoice is issued, its lines, amounts and rule snapshot are frozen. Corrections create new linked records.
- **[Rec] Concurrency.** Wrap payment allocation and invoice issuing in transactions with row-level locking, so two staff members cannot over-allocate the same payment.
- **[Rec] Use a single currency (KES)** unless you say otherwise. The Prototype mentions "currency" as a setting but shows only KES.

### 5.3 Rules NOT defined (not invented here)
See §7: due dates, grace period, late fees, shared-expense allocation methods, overpayments, credit-note procedure, final bills, deposit handling, expense approval thresholds.

---

## 6. Prototype and Master Plan Differences

### 6.1 In both documents
Staff-only access; the no-rent rule for owners; management fee rule; vacant/ended-agreement rules; idempotent billing; payment verification and receipts; expense approval; audit log; server-side permissions; PostgreSQL + Prisma + Next.js; incremental delivery; use of real data rather than hard-coded dashboard numbers.

### 6.2 Only in the Prototype
| Item | Why it matters |
|---|---|
| M-Pesa integration and idempotent webhooks | A real external integration with its own credentials, callback security and testing. |
| Email/SMS notices with queue, worker, retries, suppression | Needs a job runner and a message provider. |
| Background queue for billing and notifications | The Plan lists "background jobs to be designed", but not a choice. |
| Meter and utility policy on units | Possible metered billing. Not explained (Q9). |
| Cost centre field on expenses | Unclear what cost centres exist. |
| Approval thresholds on expenses | Amounts not given (Q11). |
| Vendor/quote approval on work orders | Extra workflow state. |
| Settings versioning by effective date | Affects the design of every billing rule. |
| PDF and Excel export | Needs a library or service. |
| Rate snapshots on invoices | Affects the invoice data model. |
| Auditor may read the audit trail | Adds a permission. |
| Kenya-specific references (Daraja, ODPC data protection) | Compliance obligations (see §8). |
| Dashboard KPIs click-through to lists | A UX requirement. |
| Pilot with sample records and reconcile a full billing period before sign-off | A formal acceptance step. |

### 6.3 Only in the Master Plan
| Item | Comment |
|---|---|
| "Properties, buildings" (multiple) | Conflicts with the Prototype's single building (see D1 below). |
| Seven roles, including Cashier and Approver | See §3. |
| Ten development phases, including Phase 10 offline mode | A sequencing aid; see §9. |
| Visual Studio Code, Git, GitHub | Tooling. |
| Hosting and managed PostgreSQL, deployment | Phase 9. |
| Rule: never reset a database holding real data without a verified backup | A process rule. |
| Rule: record each phase's tasks, tests and known issues | A process rule. |
| "Salaries" as a staff concern and "Staff and Permissions" as a module | Both documents mention staff; the Plan does not discuss salaries at all. |

### 6.4 Conflicts and ambiguities

| ID | Topic | Plan says | Prototype says | Needs decision |
|---|---|---|---|---|
| D1 | Number of buildings | "Properties, floors, and units"; "Manage properties" | "One building"; entity "Building – one record for the property" | **Yes. Q1.** |
| D2 | Roles | 7 provisional roles | 5 roles | **Yes. Q3.** |
| D3 | Operations vs Maintenance staff | "Maintenance Staff: assigned requests/work orders" | "Operations staff: assigned tasks and expense submissions" | Yes. Q3. |
| D4 | Tracker folder name | `docs` | actual folder is `Docs` | Cosmetic. |
| D5 | Rent "by default" | "No rent by default" | "No rent by default" | Both leave open **who may override** and how. Q8. |
| D6 | Prototype recommends a "background queue"; the Plan lists no such component | Plan: "background jobs to be designed" | | Choose a tool (§8). |
| D7 | Prototype input list says "Owner, unit ownership record, purchase date/documents" but never states whether owners can have **multiple units** or **joint owners** | | | Q7. |
| D8 | "Person / AccountRecord" in the data model vs "Account register" in the UI | | | Consistent, but the term "account" is overloaded. See Q12. |
| D9 | Prototype says "Rent-paying tenant" has "fee policy", but never describes the policy | | | Q9. |
| D10 | Plan has a "Notifications" module; Prototype separates "Notices and message log" with a delivery log | | | Treat the Prototype as authoritative. |

---

## 7. Unresolved Questions

Grouped by priority. Items marked **BLOCKER** must be answered before the related phase begins.

### 7.1 Structure
- **Q1 (BLOCKER, Phase 2).** One building or several properties? Prototype implies one. If there is only one, I recommend a single `Building` record plus unit rows, with the data model leaving room to add buildings later.
- **Q2.** Does the building have separate blocks or wings (the sample unit numbers "A-101", "B-205", "C-302" suggest blocks A, B and C)? The Prototype calls this illustrative data.
- **Q3 (BLOCKER, Phase 3).** Which role list is final? Specifically: do you want separate Cashier and Approver roles?

### 7.2 Billing and finance
- **Q4 (BLOCKER, Phase 6).** What is the billing day, and when is each invoice due? What is the grace period? (The Prototype lists these as settings but gives no values.)
- **Q5 (BLOCKER, Phase 6).** Are late fees or penalties charged? If so, how are they calculated?
- **Q6 (BLOCKER, Phase 6).** How are shared charges (water, cleaning, garbage, security) allocated: equally per unit, by floor area, by meter reading, by occupancy, or by a fixed fee? Are they different for tenants, owners and managed units?
- **Q7.** Can one owner own several units? Can a unit have joint owners? What happens on resale (the previous owner's history is preserved per the Prototype)?
- **Q8.** Who may override the "no rent by default" rule for an owner, and how is the override recorded?
- **Q9.** What is a "meter and shared charge policy"? Are there utility meters per unit that are read and billed?
- **Q10.** Is separation of duties absolute (a person can never verify their own recorded payment, or approve their own expense), or can a small team have exceptions?
- **Q11.** What are the expense approval thresholds (amounts), and who approves above each?
- **Q12.** What happens with overpayments: carry forward as credit, refund, or reject? What happens with partial payments: oldest invoice first, or staff-chosen allocation?
- **Q13.** What is the process when an agreement ends: final invoice, deposit refund, pro-rating for part months?
- **Q14.** Are security deposits collected? How are they recorded? (Not mentioned in either document.)
- **Q15.** Are rent increases scheduled within an agreement? How are they applied mid-term?
- **Q16.** Pro-rating: is the first month billed in full or pro-rated when an agreement starts mid-month?

### 7.3 Payments
- **Q17.** Is M-Pesa integration (Daraja callbacks) required for the first release, or is manual entry of M-Pesa reference codes acceptable at first? Callback integration requires a Safaricom developer account and a public HTTPS endpoint, which are not available on a local machine.
- **Q18.** Will the system accept bank transfers via manual entry only, or does it need bank statement import?
- **Q19.** What do receipts look like (numbering format, branding, PDF or print)?

### 7.4 Staff and salaries
- **Q20.** How far should salary handling go? Options: (a) record a salary as an expense only, (b) maintain per-staff salary records and periods, (c) full payroll with statutory deductions (e.g. PAYE, NSSF, SHIF). The Prototype implies (b) at most.
- **Q21.** Who can see salary figures? (The Prototype says "restricted" and names only operations staff as excluded.)

### 7.5 Notices
- **Q22.** Which message provider will be used for email and SMS? Who pays for it?
- **Q23.** Are message templates fixed or editable? In what languages (English, Somali, Swahili)?

### 7.6 Data and compliance
- **Q24.** Which tenant/owner identity documents will be stored (national ID, passport, KRA PIN)? The Prototype cites the Kenya Data Protection guidelines (ODPC). You need a retention and consent position.
- **Q25.** Required retention period for financial records and audit logs?
- **Q26.** Are any existing records (a spreadsheet of tenants, a unit list) to be imported? If yes, from where, and in what format?
- **Q27.** Is there an agreed unit inventory (the Prototype lists "Confirm unit inventory" as step one of the build order)?

### 7.7 Operations
- **Q28.** Who will actually use the system, and on which devices (desktop only, or phones too)? The Plan says responsive design.
- **Q29.** Where will it be hosted for production? Is there a budget?
- **Q30.** Does the system need Somali-language or bilingual screens? (Not stated in either document.)

---

## 8. Recommended Technology and Architecture Adjustments

### 8.1 Verdict on the stated stack
**Suitable.** Next.js (App Router) + TypeScript + Tailwind + PostgreSQL + Prisma is a mainstream choice that matches the Prototype's own "practical stack". It supports server-side validation and a solid developer experience. The adjustments below are additions, not replacements.

### 8.2 Adjustments and additions

| # | Adjustment | Why | Source |
|---|---|---|---|
| T1 | **Put business logic in a separate server-side "service" layer** (billing, payments, expenses, permissions), not inside page components or route handlers. Write automated tests against that layer. | Financial accuracy. Route handlers and server actions can then stay thin and be replaced without rewriting rules. | [Rec] |
| T2 | **Choose a background job tool before Phase 6.** Candidates: a Postgres-backed queue (e.g. pg-boss), or a hosted queue. Avoid relying on serverless request timeouts. | The Prototype requires idempotent billing runs and message workers with retries. Next.js alone has no job runner. | [Proto requires queue]; choice is [Rec] |
| T3 | **Choose how the app is hosted before choosing the queue.** A long-running Node host (VPS, container platform) suits workers better than a purely serverless host. | The worker must run continuously. | [Rec] |
| T4 | **Private file storage** (S3-compatible, private buckets, signed short-lived URLs) for ownership documents, agreements, expense evidence. Never store them in the public web folder. | Both documents require protected documents. | [Both require]; the service is [Rec] |
| T5 | **Authentication**: use a well-maintained library (e.g. Auth.js or Lucia-style sessions) or carefully built session handling, with Argon2id or bcrypt hashing, HttpOnly + Secure + SameSite cookies, login rate limiting and optional MFA for admin and finance roles. | Documents require secure cookies, hashing and rate limits. Do not write our own crypto. | [Proto requires]; library choice and MFA are [Rec] |
| T6 | **Audit log as an append-only table**, written in the same database transaction as the change it records. Restrict the database account so the application can insert but not update or delete audit rows. | "Protect audit history" and "Material financial changes create audit events" must be guaranteed, not best-effort. | [Both require]; method is [Rec] |
| T7 | **Money handling**: Prisma `Decimal` (or integer minor units); a decimal library for calculations; tests for rounding. | The Plan requires decimals. Rounding errors on invoices are a classic defect. | [Plan]; details [Rec] |
| T8 | **Database constraints** for duplicate billing, duplicate payment references, non-overlapping active assignments, and non-negative amounts (see §5.2). PostgreSQL exclusion constraints can enforce "no overlapping active assignments per unit". Prisma cannot express these directly, so they go in hand-written SQL inside migrations. | Prototype requires "No conflicting active unit assignment". The database is the most reliable place to enforce it. | [Rec] |
| T9 | **Validation library** (e.g. Zod) at every server boundary (forms, APIs, webhooks). | Plan requires validating user input at trust boundaries. | [Plan]; library is [Rec] |
| T10 | **PDF and Excel export libraries** chosen in the reporting phase. Generate on the server and apply permission checks first. | Prototype requires PDF/Excel. | [Proto]; tools [Rec] |
| T11 | **M-Pesa (Daraja) integration deferred until manual payment recording is working and tested**; use the Safaricom sandbox for development. Webhook endpoints must verify the source, be idempotent, and never trust the payload as proof without confirmation. | A callback needs a public HTTPS URL and credentials. The Prototype says uploaded proof alone is not confirmation. | [Proto requires idempotency]; sequencing is [Rec] |
| T12 | **Secrets**: `.env.local` is never committed; production secrets live in the host's secret manager. Provide a `.env.example` with placeholder names only. | Plan forbids committing secrets. | [Plan]; method [Rec] |
| T13 | **Database access**: use one PostgreSQL install only (Homebrew *or* Postgres.app, not both), on a non-conflicting port, with a dedicated least-privilege application role and a separate migration role. Use separate databases for development and tests. | The earlier inspection found both installed and neither running. | [Rec] |
| T14 | **Backups and restore tests** before real data is entered. Include point-in-time recovery for production. | Plan requires a verified backup before any destructive operation. Financial records need recovery. | [Plan partly]; details [Rec] |
| T15 | **Time zone**: store timestamps in UTC, and compute billing periods and due dates in the building's time zone (Africa/Nairobi). | Month boundaries decide which invoices exist. | [Rec] |
| T16 | **Testing stack**: a unit test runner (Vitest or Jest), integration tests against a real test PostgreSQL, and end-to-end tests (Playwright) for the critical paths. | Plan requires testing money logic and permissions. | [Plan requires testing]; tools [Rec] |
| T17 | **Concurrency and idempotency keys** for payment recording and billing runs. | Prototype requires idempotent behaviour. | [Proto]; mechanism [Rec] |
| T18 | **Observability**: structured logs without secrets or personal data, and error tracking. | OWASP Logging reference in the Prototype. | [Proto reference]; tools [Rec] |
| T19 | **Data protection**: record the legal basis for personal data, limit who sees ID documents, define retention. | The Prototype cites the Kenya ODPC guidelines. A legal review is advisable. | [Proto reference]; action is [Rec] |
| T20 | **Phase 10 "offline mode"** should remain out of scope. Offline financial writes conflict with idempotency and ledger integrity. | The Plan itself says only after the core is stable. | [Plan]; I agree. |

### 8.3 Things I'd keep exactly as proposed
Next.js App Router, TypeScript, Tailwind, PostgreSQL, Prisma migrations, server-side permission checks, incremental phases, no hard-coded dashboard numbers.

---

## 9. Recommended Development Sequence

The Plan's 9 phases are reasonable. The Prototype's own build order is similar. I recommend the following adjusted sequence. Changes from the Plan are marked **(changed)**.

| Phase | Content | Change |
|---|---|---|
| 0 | **Requirements sign-off**: answer the BLOCKER questions that apply, confirm the unit inventory | **(new)** The Prototype itself lists this as step 1. |
| 1 | **Project foundation**: create the Next.js app, Git, `.gitignore`, `.env.example`, lint, format, test runner, README | As in the Plan, plus the test tooling set up early. **(changed)** |
| 2 | **Database foundation**: one PostgreSQL, Prisma, core schema (Building, Unit, StaffUser, Role, Permission, AuditEvent), seed script with fake data only | As in the Plan. Audit table is created early. **(changed)** |
| 3 | **Authentication and permissions**, including login rate limiting, the permission matrix, and the first audit events | As in the Plan. |
| 4 | **Application shell**: layout, navigation (matching §2.5 C42), reusable components | As in the Plan. |
| 5 | **Units, people/accounts, agreements and ownership records**, with overlap prevention and document upload | As in the Plan, with document storage added. **(changed)** |
| 6a | **Charge policies and settings with effective dates** | **(new/split)**: billing cannot be designed until the shared-charge rules (Q6) are decided. |
| 6b | **Invoices, the billing run and the ledger** (idempotent, snapshots, credits and reversals) | Split from Plan Phase 6. |
| 6c | **Payments: manual recording, verification, allocation, receipts** | Split from Plan Phase 6. |
| 6d | **Expenses and approvals** | Split from Plan Phase 6. |
| 6e | **M-Pesa callback integration** (Daraja sandbox first) | **(changed)**: moved after manual payments are stable. |
| 7a | **Maintenance and work orders; staff and service tasks; salary records** | As in the Plan. |
| 7b | **Notices (queue, worker, message log)** | Needs the job runner chosen in T2. |
| 7c | **Reports, exports, dashboard KPIs with documented formulas** | The dashboard is built *late* so that its numbers come from real ledgers. **(changed)** |
| 8 | **QA and security review**, including a **full pilot billing period reconciled** to the ledger | Pilot is from the Prototype's step 7. |
| 9 | **Deployment, backups, monitoring** | As in the Plan. |
| 10 | Future enhancements | Unchanged. |

**Why the dashboard moves later [Rec].** The Prototype requires "dashboard totals match detail ledgers". A dashboard built first would have to show fake numbers, which the Plan forbids ("use real database records rather than hard-coded dashboard figures"). An empty-state shell in Phase 4 is fine.

---

## 10. Approval Checklist Before Coding

Tick when decided. Items marked * are required before **Phase 1** can begin; the others can be answered when their phase approaches, but each must be answered *before* that phase.

### Decisions needed now (before Phase 1–2)
- [ ] * **A1.** Single building (Prototype) or multiple properties (Plan)? (Q1)
- [ ] * **A2.** Approve the permission-based role model and the final role list. (Q3, §3.3)
- [ ] * **A3.** Approve the adjusted development sequence in §9, including the new Phase 0.
- [ ] * **A4.** Approve the stack with the additions in §8.2 (service layer, job queue, private file storage, audit table design, testing tools).
- [ ] * **A5.** Choose **one** PostgreSQL installation for development (Homebrew PostgreSQL 18 *or* Postgres.app), and confirm that fake seed data only will be used until pilot. (T13)
- [ ] * **A6.** Confirm that the prototype file in `Docs/` is the approved version, and rename it later without the leading space if you agree. (I have not renamed it.)
- [ ] * **A7.** Confirm the approach for the sample figures in the Prototype (48 units, KES 980K, etc.): treat them as illustrative only.

### Decisions needed before billing (Phase 6)
- [ ] **B1.** Billing day, due date and grace period. (Q4)
- [ ] **B2.** Late fee policy. (Q5)
- [ ] **B3.** Shared-charge allocation methods. (Q6)
- [ ] **B4.** Rent-override rule for owners. (Q8)
- [ ] **B5.** Meters and utility billing. (Q9)
- [ ] **B6.** Partial payment, overpayment and credit rules. (Q12)
- [ ] **B7.** Agreement-end/final-bill/pro-rating/deposit rules. (Q13–Q16)
- [ ] **B8.** Expense approval thresholds and approvers. (Q11)
- [ ] **B9.** Separation-of-duties strictness. (Q10)
- [ ] **B10.** Whether M-Pesa callbacks are in release 1. (Q17)

### Decisions needed later
- [ ] **C1.** Salary scope. (Q20, Q21)
- [ ] **C2.** Message providers and templates. (Q22, Q23)
- [ ] **C3.** Data protection, ID documents and retention. (Q24, Q25)
- [ ] **C4.** Data import from existing records. (Q26, Q27)
- [ ] **C5.** Hosting and budget. (Q29)
- [ ] **C6.** Language and device requirements. (Q28, Q30)
- [ ] **C7.** Receipt format and numbering. (Q19)

---
*End of report. No source document was modified and no application, repository or database configuration has been created.*
