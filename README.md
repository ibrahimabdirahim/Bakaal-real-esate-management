# Bakaal Real Estate Management System

An internal, staff-only web application for managing one building: units, tenants and
purchased-unit owners, agreements, monthly billing, invoices, verified payments and
receipts, expenses with approvals, service staff and salaries, maintenance work orders,
reports, notices and an append-only audit log.

Tenants and owners are records managed by staff; they do not log in.

- Requirements: `Docs/BAKAAL_REAL_ESTATE_MANAGEMENT_SYSTEM_DEVELOPMENT_MASTER_PLAN.md`, the prototype in `Docs/`, `Docs/BAKAAL_REQUIREMENTS_REVIEW.md`
- Decisions (approved / proposed / deferred / unresolved): `Docs/DECISIONS.md`
- Progress and known limitations: `Docs/DEVELOPMENT_CHECKLIST.md`

## Technology

Next.js 16 (App Router, server actions) · React 19 · TypeScript · Tailwind CSS 4 ·
PostgreSQL 18 · Prisma 7 (with the `pg` driver adapter) · zod · lucide-react (icons) · Vitest.
Charts are dependency-free SVG components (`src/components/charts.tsx`).
No external services: sessions, password hashing (scrypt), CSV export and printing use
built-in Node/browser features.

## Requirements

- Node.js **24 or newer** and npm
- PostgreSQL 18 running locally (this machine uses Homebrew PostgreSQL 18 on port 5432)

## First-time setup

```bash
npm install                      # also generates the Prisma client
cp .env.example .env             # then fill in the three database URLs (see below)
npm run db:migrate               # creates the tables, constraints and safety triggers
```

You need three PostgreSQL databases owned by one login role, for example `bakaal_dev`,
`bakaal_test` and `bakaal_shadow`. On this machine they already exist and `.env` is
already configured (owner-only file permissions, ignored by Git).

The development database starts empty: there is no sample data and no seed script. Create the
first administrator in a terminal (the password is typed hidden and must be at least 12
characters):

```bash
npm run user:create-admin        # prompts for e-mail, full name and password
```

Then sign in as that administrator, create the building profile in **Settings**, and add staff
accounts, units and accounts through the application.

The development database was emptied on 2026-10-21 to remove the old demo data. A verified
backup of its previous contents is kept outside the repository in
`~/Bakaal-db-backups/2026-10-21_bakaal_dev_before-demo-removal/`; its `RECOVERY.md` explains
how to restore it. Do not delete that folder.

## Running the application

Start PostgreSQL if it is not running (Homebrew PostgreSQL does not auto-start on this machine):

```bash
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start
```

Then:

```bash
npm run dev                      # development, http://localhost:3001
# or
npm run build && npm start       # production build, http://localhost:3001
```

Sign in at <http://localhost:3001/login>.

Uploaded documents are stored privately in `storage/documents/` (ignored by Git, never served
publicly). **Back this folder up together with the database**; the database holds only their
metadata. Settings: `DOCUMENT_MAX_MB` (default 10) and `DOCUMENT_STORAGE_DIR` (optional path).

After `npm run db:migrate` or `npm run db:generate`, **restart `npm run dev`**: the running server
keeps its database client in memory across reloads and would otherwise fail with errors such as
"Unknown argument" for new fields.

**For everyday use run `npm run serve`** (stops a running Bakaal dev server, builds, then starts the
fast production server on http://localhost:3001). `npm run dev` compiles each page the first
time it is opened, which is slow on a machine short of memory; use it only while changing code.
After code changes, run `npm run serve` again.

Bakaal always runs on port **3001**. Port 3000 is left to another project on this machine, so a
browser tab of that project can never reach Bakaal by mistake. Before starting, `npm run dev` and
`npm start` check the port:

- If Bakaal is already running, they say so: just open the URL, or run **`npm run dev:restart`**
  to stop that Bakaal server and start a fresh one.
- If another program holds port 3001, they name it and stop nothing; close it yourself.

`npm run dev:restart` only ever stops a server started from this project folder. Bakaal's database is Homebrew
PostgreSQL 18 on port **5432**; the Postgres.app server on port 5433 belongs to another project
and is not used by Bakaal.

To stop PostgreSQL: `/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 stop`.

## Tests and checks

```bash
npm test                         # unit tests: money, dates, billing rules, ledger, occupancy
npm run test:integration         # services against the real TEST database (emptied first)
npm run lint                     # ESLint
npm run typecheck                # TypeScript
npm run build                    # production build
npm run test:workflow            # needs a build: starts a server on :3100 against the TEST
                                 # database and submits the real forms end to end
npm run db:check                 # read-only integrity checks of the development database (-- --test for the test database)
npm run test:smoke               # needs a build; run after test:workflow. Starts its own server on :3200
                                 # against the TEST database: every page for every role, and every
                                 # internal link shown to that role must open for it
```

Integration and workflow tests refuse to run unless the test database name ends in `_test`.

## Manual testing

There is no demo environment (removed 2026-10-23, F58). For manual testing, use the TEST database:

```bash
npm run build && npm run test:server   # serves the app on http://localhost:3300 against the TEST database only
```

`npm run test:integration` and `npm run test:workflow` empty the test database; run them before or
after a manual testing session, not during it.

## Production database (Neon)

Production uses a Neon PostgreSQL database, separate from the local `bakaal_dev` and `bakaal_test`
(which are never touched by the Neon tools). Nothing in the repository holds a Neon credential.

**Two connection strings** (Neon console → *Connect*, same branch and database):

| Variable on the host | Neon string | Used by |
|---|---|---|
| `DATABASE_URL` | **pooled** (host contains `-pooler`), ending `?sslmode=verify-full` | the app at runtime |
| `DIRECT_DATABASE_URL` | **direct** (no `-pooler`), ending `?sslmode=require` | `prisma migrate deploy` only (migrations cannot run through the pooler) |

Set them as encrypted environment variables on the hosting platform. Locally, only `DATABASE_URL`
is set (in `.env`), so nothing changes for development.

**Checks from this computer** — put the same two strings in a git-ignored `.env.neon` as
`NEON_DATABASE_URL` and `NEON_DIRECT_URL` (never in `.env`, chat or a committed file), then:

```bash
npm run db:neon:check     # read-only: connection, TLS, PostgreSQL version, time zone (must be UTC), btree_gist, privileges, existing tables
npm run db:neon:status    # read-only: which of the 7 migrations Neon has
npm run db:neon:deploy -- --confirm   # applies pending migrations — only with the owner's approval
```

The tool refuses non-Neon hosts, the local database names, a pooled string for migrations and
strings without `sslmode`, and never prints a password.

**First deploy (after approval):** create the Neon database (an empty one; Neon's time zone is UTC),
run `db:neon:check`, then `db:neon:deploy -- --confirm`, then `db:neon:status`; create the first
administrator with `DATABASE_URL=<direct string> npm run user:create-admin`. Never run
`prisma migrate dev` or `prisma migrate reset` against Neon, and never point the test commands at it
(they refuse any database whose name does not end in `_test`, and wipe it). Uploaded documents are
stored on the server's disk (`storage/`): production needs persistent storage for them, decided
before going live.

## Project structure

```text
prisma/schema.prisma            data model
prisma/migrations/              migrations, incl. hand-written constraints and triggers
src/lib/                        money (integer cents) and date helpers
src/server/billing/compute.ts   monthly billing rules (pure, unit-tested)
src/server/ledger.ts            balances, statuses, ageing, statements (pure, unit-tested)
src/server/services/            business operations; every one checks permissions and writes audit events
src/server/auth/                sessions, password hashing, role permissions
src/app/(app)/                  pages and server actions (thin; call the services)
scripts/                        admin bootstrap, test runners
```

## Brand and design system

- Logo: the BKL Development Limited mark from the approved prototype (first image in the
  document, `word/media/image1.png`). Kept byte-for-byte as `public/brand/bkl-logo-original.png`;
  `public/brand/bkl-logo.png` is the same image with a 2-pixel white crop artifact removed.
  `src/app/icon.png` and `apple-icon.png` are the logo centred on its own background colour.
- Visual reference: the prototype's own dashboard mockup (navy top bar with the BAKAAL
  wordmark, compact navy sidebar with a bright-blue active item, light blue-grey page, white
  cards with coloured left accents, blue collection bars and an orange expense line).
- Colour tokens (`src/app/globals.css`) were sampled from that mockup: `navy-*` (top bar
  #0a2c4c, sidebar #0e3052), `primary-*` (#0c60e7), `accent-*` (blue, green, amber, red),
  `surface`, `line`, `ink`, `muted`; `brand-*` is the logo's slate-teal.
- Shell (`src/app/(app)/layout.tsx`, `nav-links.tsx`): top bar, collapsible sidebar with
  tooltips (preference kept in the browser), drawer on phones/tablets, automatic breadcrumbs.
- Shared components: `src/components/ui.tsx` (cards, tables that become record cards on
  phones, stats, pagination, empty states), `forms.tsx` (inputs, confirmation dialogs),
  `status.tsx` (one status-badge vocabulary), `charts.tsx`, `brand.tsx`.

## How money and history are protected

- Amounts are stored as `Decimal(14,2)` and calculated in integer cents (never floating point).
- One invoice per agreement per month (unique constraint); billing the same month twice creates nothing new.
- Issued invoices and their lines cannot be changed or deleted (database triggers); corrections use credit notes.
- Payments count only after verification by a different person; they can be rejected or reversed, never deleted.
- Allocations are chosen by staff, locked against concurrent over-allocation, and reversed rather than deleted.
- The audit log is append-only at the database level.
- Expenses never create tenant charges.
