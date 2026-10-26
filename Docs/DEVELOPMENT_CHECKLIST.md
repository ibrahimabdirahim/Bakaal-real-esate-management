# Bakaal Real Estate Management System — Development Checklist

Last updated: 2026-10-21. "Done" means implemented **and** verified by the tests listed in the README.

## Foundation

- [x] Next.js 16 + TypeScript + Tailwind project, ESLint, Vitest
- [x] Local PostgreSQL 18: separate development, test and migration-check databases; password authentication on TCP
- [x] Prisma 7 schema and migration with integrity constraints and protective triggers
- [x] Environment handling (`.env` ignored by Git, `.env.example` placeholders)
- [x] Decision register (`DECISIONS.md`) and this checklist

## Access and audit

- [x] Staff sign-in / sign-out, server-side sessions, idle and absolute timeouts
- [x] Failed sign-in lockout, scrypt password hashing, password change, admin password reset
- [x] Five prototype roles as permission bundles, checked on every page, action and export
- [x] Staff account management (create, change role, deactivate)
- [x] Append-only audit log with before/after summaries and reasons; viewer with filters
- [x] First-administrator command (`npm run user:create-admin`)

## Property records

- [x] Unit register (search, status filter, retire) and unit history
- [x] Accounts for tenants and owners (category derived from agreements; sensitive ID restricted)
- [x] Rental, ownership (purchased unit) and management agreements with effective dates
- [x] Overlapping agreements blocked; owners can never be charged rent; ownership needs evidence
- [x] Approved recurring charges per agreement (effective-dated, ended rather than deleted)
- [x] End agreement (billing stops, debts kept) and cancel (only before invoicing)

## Billing and finance

- [x] Monthly billing preview with exceptions, then issue; duplicate-proof
- [x] Policy hierarchy: agreement → approved building policy → held for review
- [x] Invoice ledger with paid / part-paid / past-due status; printable invoice
- [x] Manual invoices (e.g. final settlement) drafted, then issued by a second person
- [x] Credit notes (never above the balance)
- [x] Payments: record (pending) → verify by a second person → receipt; reject; reverse
- [x] Staff-chosen allocation with concurrency protection; unallocated money kept for review
- [x] Account statements (opening + charges − payments − credits + reversals = closing)

## Operations

- [x] Expenses: draft → submit → approve/reject (not by the submitter) → paid; never bills occupants
- [x] Service staff records; salaries restricted to salary-access roles; salary expenses linked
- [x] Service tasks and schedules (assign, complete, cancel)
- [x] Maintenance work orders: unit or common area, priority, assignment, quote approval, completion with outcome and cost treatment, linked expenses

## Reporting

- [x] Dashboard from live records (units, occupancy, collections, outstanding, queues, 12-month chart)
- [x] Occupancy, rent roll, arrears ageing, collections, expenses, reconciliation check
- [x] CSV (Excel) export with formula-injection protection; print / save as PDF
- [x] Notices page: past-due accounts (rechecked live) with suggested reminder text

## Quality

- [x] Unit tests (money, dates, billing rules, ledger, occupancy)
- [x] Database integration tests (duplicates, verification, concurrency, reversals, triggers, reconciliation)
- [x] Form-level workflow test through real server actions
- [x] Smoke test of every page for every role, including access denial
- [x] Desktop and phone layouts checked (no horizontal page overflow)

## Design and usability (2026-10-21)

- [x] Authentic BKL logo from the prototype applied (sidebar, sign-in, invoices, receipts, icons)
- [x] Design tokens and shared components; consistent status badges, empty states, confirmation dialogs
- [x] Dashboard with period filter, 9 live KPIs, collections/expenses, billed vs collected, occupancy and arrears charts, "needs attention" list, recent activity
- [x] Grouped sidebar with icons; slide-in navigation drawer on phones and tablets; user menu
- [x] Tables turn into record cards on phones; pagination and search/date filters on the main lists
- [x] No horizontal page overflow at 390, 768, 1024, 1280 and 1440 px (57 page/width combinations measured)
- [x] Link check: every internal link shown to each role opens for that role

## Reference design (prototype dashboard mockup, 2026-10-21)

- [x] Navy top bar with logo, BAKAAL wordmark, module title and user menu; breadcrumbs on every page
- [x] Compact navy sidebar with bright-blue active item; collapsible with tooltips; drawer on small screens
- [x] KPI cards with coloured accents (units, occupied/vacant with occupancy bar, collected, outstanding) and a second row of work queues
- [x] Monthly collections (blue bars) and monthly expenses (orange line with area) with period filter
- [x] Recent activity (icon, description, unit/account, amount, actor where permitted, time) and pending items (count, details, link)
- [x] Activity feed permissions covered by a database test
- [x] Rent billed, arrears (past due), billed-vs-collected, occupancy distribution and arrears ageing on the dashboard

## Not done / deferred (see DECISIONS.md)

- [ ] Private document uploads (evidence is recorded as text for now)
- [ ] E-mail / SMS delivery of notices (no provider approved)
- [ ] M-Pesa API integration (manual recording and verification only)
- [ ] Late fees, proration, deposits, refunds, overpayment credits, shared-expense allocation, expense approval thresholds — business rules not approved
- [ ] Final role matrix and session/password policy confirmation (provisional defaults in place)
- [ ] Payroll calculations (only salary amounts and salary expenses)
- [ ] Browser-automation tests of JavaScript-only interactions (confirmation dialogs, menu drawer, agreement type switching). Forms are tested without JavaScript; layouts were checked in headless Chrome screenshots.
- [ ] Phase 10: hosting, managed database, backups, monitoring, deployment
- [ ] `npm audit`: 5 high findings in lint tooling (`braces`, GHSA-vfj7-8cjw-p6xm) — no fix available upstream; not in the running app
