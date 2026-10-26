# Bakaal Real Estate Management System

## Development Master Plan

**Project:** Bakaal Real Estate Management System  
**Document Type:** Development Master Plan  
**Status:** Planning and Initial Development  
**Purpose:** To guide the development of a secure, reliable, and responsive property management application using the approved project requirements.

---

## 1. Project Overview

Bakaal Real Estate Management System is an internal management application for managing properties, units, tenants, purchased-unit owners, agreements, billing, payments, expenses, staff, maintenance, reports, notifications, and audit records.

The system will be developed incrementally, with each module implemented and tested before moving to the next phase.

## 2. Source of Requirements

The primary requirements document is:

`Updated Bakaal Real Estate Management System Prototype Revised`

All implementation decisions must be checked against this document. Unconfirmed business rules must be clarified before implementation.

## 3. Development Principles

- Build the application step by step.
- Use real database records rather than hard-coded dashboard figures.
- Enforce authentication and role-based permissions on the server.
- Preserve historical financial records and audit trails.
- Validate business rules before saving or posting transactions.
- Test each feature before starting the next major module.
- Keep development progress and outstanding tasks documented.

## 4. Technology Stack

The following technologies are the proposed foundation for the application. Confirm compatibility and security before implementation.

### Frontend

- Next.js with the App Router
- React
- TypeScript
- Tailwind CSS
- Responsive design for desktop, tablet, and mobile

### Backend

- Next.js server-side features and Route Handlers where appropriate
- TypeScript for application logic
- Server-side validation and authorization

### Database

- PostgreSQL
- Prisma ORM
- Database migrations managed through Prisma

### Authentication and Security

- Secure staff authentication and session management
- Role-based access control
- Server-side permission checks
- Secure password hashing
- Environment variables for secrets
- Audit logging for important actions

### Development Tools

- Visual Studio Code
- Git and GitHub
- Node.js and npm

### Deployment

- Local development first
- Production hosting and managed PostgreSQL to be configured after local testing
- Private document storage and background jobs to be designed according to project requirements

## 5. Core System Modules

The application should include the following modules, subject to confirmation against the approved prototype.

1. **Dashboard** — Key property, occupancy, billing, collection, expense, and arrears summaries based on database records.
2. **Properties and Units** — Manage properties, floors, units, unit types, occupancy status, and unit history.
3. **Tenants** — Maintain tenant profiles, contact information, occupancy records, and rental history.
4. **Owners** — Manage purchased-unit owners and their ownership records.
5. **Agreements** — Manage rental agreements, management agreements, effective dates, terms, and supporting documents.
6. **Billing and Invoices** — Generate applicable rent, management fees, and approved shared charges.
7. **Payments and Receipts** — Record payments, verify them according to permissions, and issue receipts.
8. **Expenses** — Record expenses, maintain supporting evidence, and implement approval workflows.
9. **Staff and Permissions** — Manage staff accounts, roles, and access permissions.
10. **Maintenance and Work Orders** — Record maintenance requests, assignments, progress, and completion.
11. **Reports** — Provide financial, occupancy, collection, arrears, expense, and operational reports.
12. **Notifications and Communications** — Track relevant reminders and system notifications.
13. **Audit Log** — Record important actions, including financial changes and approvals.
14. **Settings** — Manage authorised system configuration.

Do not implement all modules at once. Build and test them in a controlled sequence.

## 6. Core Business and Billing Rules

### 6.1 Rental Units

- Tenants with valid rental agreements are billed according to the agreement terms.
- Rent and applicable approved shared or service charges must be shown separately on invoices.
- Billing must respect the agreement's effective start and end dates.

### 6.2 Purchased Units

- Purchased-unit owners must not be charged rent by default.
- Only applicable, authorised shared expenses or other charges supported by the relevant agreement may be billed.

### 6.3 Units Managed by Bakaal

- A purchased unit managed by Bakaal must not be charged rent by default.
- Management fees must follow the applicable management agreement.
- Applicable shared expenses must follow the approved allocation rules.

### 6.4 Vacant Units

- Do not generate tenant rent invoices for vacant units without a valid agreement or another explicitly authorised billing basis.

### 6.5 Ended Agreements

- Preserve historical agreements, invoices, payments, and account records.
- Stop future recurring billing after the effective end date, subject to authorised final billing and outstanding balances.

### 6.6 Financial Controls

- Keep rent, management fees, shared expenses, and other charges distinguishable.
- Record the source and period of every charge.
- Prevent duplicate recurring invoices for the same agreement and billing period.
- Require appropriate permissions for payment verification, financial adjustments, and approvals.
- Never silently delete posted financial records; use authorised correction or reversal procedures.
- Record important financial actions in the audit log.

### 6.7 Rules Requiring Confirmation

- Shared-expense allocation methods.
- Rent due dates, grace periods, and late-payment rules.
- Partial-payment and overpayment handling.
- Invoice cancellation, credit notes, and reversal procedures.
- Final billing when an agreement ends.

Do not invent values for unconfirmed rules. Confirm them against the approved prototype and business requirements before implementation.

## 7. Staff Roles and Permissions

### 7.1 General Access Rules

- The application is an internal staff management system.
- Tenants and property owners do not have login access unless explicitly approved in the requirements.
- Every staff account must have an assigned role and appropriate permissions.
- Enforce permissions on the server, not only by hiding buttons in the user interface.
- Only authorised administrators may manage staff accounts, roles, and sensitive system settings.

### 7.2 Proposed Roles

The following roles are provisional and must be confirmed against the approved prototype.

- **System Administrator:** Manage system configuration, staff access, and authorised administrative operations.
- **Property Manager:** Manage properties, units, occupancy, agreements, and operational activities within assigned permissions.
- **Finance Officer:** Manage billing, invoices, payment records, and financial reports within assigned permissions.
- **Cashier or Payment Recorder:** Record payments and issue receipts where authorised.
- **Approver:** Review and approve designated payments, expenses, or financial adjustments.
- **Maintenance Staff:** Access assigned maintenance requests and work orders.
- **Read-Only User:** View permitted records and reports without changing data.

### 7.3 Permission Requirements

- Apply the principle of least privilege.
- Separate payment recording from payment verification where required.
- Restrict sensitive financial adjustments and approvals to authorised roles.
- Prevent unauthorised access to confidential tenant, owner, staff, and financial records.
- Record important permission changes and privileged actions in the audit log.

### 7.4 Implementation Requirements

- Define permissions by action and resource.
- Protect pages, server actions, and API endpoints.
- Validate the authenticated user's permissions for every protected operation.
- Test both authorised and unauthorised access scenarios.
- Never rely on the frontend alone to enforce security.

## 8. Development Roadmap

Development must proceed in phases. Complete and test each phase before moving to the next.

### Phase 1: Project Foundation

- Inspect the existing project directory before making changes.
- Confirm the installed Node.js and npm versions.
- Initialise the Next.js project with TypeScript, Tailwind CSS, and the App Router if the project has not already been initialised.
- Establish a consistent folder structure and coding conventions.
- Configure environment variables and safe defaults.
- Initialise Git and create a README.
- Confirm that the application runs locally.

### Phase 2: Database Foundation

- Configure PostgreSQL and Prisma.
- Design the database schema based on confirmed requirements.
- Define relationships, constraints, indexes, and monetary data types.
- Create and test database migrations.
- Establish a safe development seed strategy.
- Never use sample records as real business data.

### Phase 3: Authentication and Access Control

- Implement secure staff login and logout.
- Implement session management.
- Define roles and granular permissions.
- Protect pages and server-side operations.
- Test unauthorised access and session expiration.

### Phase 4: Application Layout

- Implement the navigation sidebar, header, page layout, and responsive design.
- Apply the approved Bakaal branding and prototype as UI references.
- Build reusable form, table, dialog, notification, and status components.
- Ensure accessible labels, loading states, empty states, and error messages.

### Phase 5: Property and Account Management

- Implement properties, floors, and units.
- Implement tenant and purchased-unit owner records.
- Implement rental and management agreements.
- Preserve historical relationships and agreement dates.

### Phase 6: Billing and Financial Workflows

- Implement billing rules and invoice generation.
- Implement payment recording, verification, receipts, and outstanding balances.
- Implement expense recording and approval workflows.
- Add duplicate-prevention and financial validation controls.
- Test billing and payment calculations thoroughly.

### Phase 7: Operations and Reporting

- Implement maintenance requests and work orders.
- Implement staff management and notifications.
- Implement reports using actual authorised database records.
- Implement audit log views and relevant system settings.

### Phase 8: Quality Assurance

- Test business rules and critical financial calculations.
- Test authentication, permissions, and data isolation.
- Test validation, errors, and unusual scenarios.
- Test responsive layouts and accessibility.
- Fix critical issues before deployment.

### Phase 9: Deployment and Operations

- Configure production environment variables and secrets.
- Configure managed PostgreSQL and secure document storage.
- Apply database migrations through a controlled deployment process.
- Configure backups, logging, and monitoring.
- Deploy only after successful testing and security review.

### Phase 10: Future Enhancements

- Consider offline-capable workflows and synchronisation only after the core system is stable.
- Design conflict handling, duplicate prevention, and recovery before enabling offline financial operations.

### Phase Completion Rule

For every phase, document completed tasks, files changed, tests executed, known issues, and the next approved task. Do not claim a feature is complete until it has been implemented and verified.

## 9. Instructions for the AI Coding Editor

### 9.1 Before Making Changes

- Read this master plan and the approved Bakaal prototype before implementing features.
- Inspect the existing project structure, `package.json`, dependencies, and configuration.
- Identify what already exists before creating or replacing files.
- Ask for clarification when an important business rule is unclear.
- Explain the proposed changes before performing major refactoring.

### 9.2 Implementation Approach

- Work on one clearly defined task at a time.
- Prefer small, reviewable changes over large, uncontrolled code generation.
- Reuse existing components and patterns where appropriate.
- Use TypeScript with clear types and avoid unnecessary use of `any`.
- Follow the project's established conventions.
- Do not install unnecessary dependencies.
- Do not overwrite existing files without understanding their purpose.
- Never remove working functionality merely to simplify an implementation.

### 9.3 Security Requirements

- Never expose secrets, database credentials, or private environment variables in frontend code.
- Never commit `.env` files containing secrets.
- Validate and authorise sensitive operations on the server.
- Validate all user input at appropriate trust boundaries.
- Protect confidential records and uploaded documents.
- Use transactions where required to maintain financial data consistency.

### 9.4 Database and Financial Integrity

- Use version-controlled database migrations.
- Never reset or delete a database containing important data without explicit approval and a verified backup.
- Preserve historical agreements, invoices, payments, and audit records.
- Prevent duplicate invoices and duplicate payment processing.
- Use appropriate decimal database types for monetary amounts.
- Do not calculate important financial totals using untrusted client-submitted values.
- Implement financial corrections through authorised, traceable procedures.

### 9.5 Testing and Verification

- Run relevant linting, type checks, and tests after changes.
- Test important business rules and failure scenarios.
- Report commands executed and their actual results.
- Clearly identify tests that could not be run.
- Never claim a feature works without evidence from implementation and testing.

### 9.6 Reporting Progress

After each task, report:

1. What was implemented.
2. Which files were created or changed.
3. Which commands and tests were run.
4. Any errors, risks, or unresolved questions.
5. The recommended next task.

Do not proceed to a new major phase without reviewing the current phase's results.

## 10. Development Progress Tracker

### Current Project Status

- [x] Create the project folder.
- [x] Create the `docs` folder.
- [x] Create the development master plan.
- [ ] Inspect the existing project structure.
- [ ] Confirm the development environment.
- [ ] Initialise or verify the Next.js application.
- [ ] Configure Git.
- [ ] Configure PostgreSQL and Prisma.
- [ ] Implement authentication and permissions.
- [ ] Implement property and account management.
- [ ] Implement billing and financial workflows.
- [ ] Implement operations and reporting.
- [ ] Complete testing and security review.
- [ ] Prepare production deployment.

### Current Phase

Phase 1: Project Foundation

### Next Approved Task

Inspect the existing project directory and development environment before creating, replacing, or installing project files.

### Development Notes

- Keep this tracker updated as tasks are completed and verified.
- Record important decisions and unresolved questions.
- Do not mark a task complete until its result has been checked.
- Use the approved Bakaal prototype as the primary requirements reference.
