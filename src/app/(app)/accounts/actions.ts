"use server";

import { z } from "zod";
import { finish, parseForm, runAction, type ActionState } from "@/server/action";
import { BusinessError, type Actor } from "@/server/auth/actor";
import { ACCOUNT_TYPES, archiveParty, createAccount, deleteParty, DuplicateAccountError, updateParty, type NewAccountInput } from "@/server/services/property";
import { isoDate, money, optionalEmail, optionalInt, optionalIsoDate, optionalMoney, optionalNonNegativeMoney, optionalText, requiredText } from "@/server/validation";
import { CONTACT_FIELD_LABELS } from "@/lib/contact";

const partySchema = z.object({
  displayName: requiredText("Name", 150),
  phone: optionalText(40),
  email: optionalEmail,
  idNumber: optionalText(40),
  notes: optionalText(),
});

const FORM_FIELDS = ["displayName", "phone", "email", "idNumber", "notes"] as const;
/** Charge rows arrive as charge{n}Category/Description/Amount/From/To; n is any row number the form used. */
const CHARGE_FIELD = /^charge(\d+)(Category|Description|Amount|From|To)$/;
const MAX_CHARGES = 20;
const chargeRowsOf = (form: FormData) => [...new Set([...form.keys()].map((k) => k.match(CHARGE_FIELD)?.[1]).filter((n) => n != null).map(Number))].sort((a, b) => a - b);
const TYPE_FIELDS = [
  "accountType", "unitId",
  "startDate", "endDate", "rentAmount", "depositAmount", "dueDay", "graceDays", "reference", "lateFeeTerms", "allocationTerms", "agreementNotes",
  "ownerFrom", "purchaseDate", "ownershipEvidence", "ownershipReference", "ownerDueDay", "ownershipNotes",
  "mgmtStartDate", "mgmtEndDate", "managementFee", "mgmtDueDay", "mgmtGraceDays", "mgmtReference", "mgmtNotes",
] as const;

const unitSchema = z.object({
  accountType: z.enum(ACCOUNT_TYPES, { message: "Choose an account type." }),
  unitId: requiredText("Unit"),
});

/** Rent-paying tenant: the rental agreement (same rules as the agreement form). */
const tenancySchema = z.object({
  startDate: isoDate("Start date"),
  endDate: optionalIsoDate("End date"),
  rentAmount: money("Monthly rent"),
  depositAmount: optionalNonNegativeMoney("Deposit amount"),
  dueDay: optionalInt("Due day", 1, 28),
  graceDays: optionalInt("Grace period", 0, 60),
  reference: optionalText(80),
  lateFeeTerms: optionalText(1000),
  allocationTerms: optionalText(1000),
  agreementNotes: optionalText(),
});

/** Purchased unit (owner or managed): the ownership record. Evidence is required by the agreement rules. */
const ownershipSchema = z.object({
  ownerFrom: isoDate("Owner from"),
  purchaseDate: optionalIsoDate("Purchase date"),
  ownershipEvidence: optionalText(500),
  ownershipReference: optionalText(80),
  ownerDueDay: optionalInt("Due day for owner charges", 1, 28),
  ownershipNotes: optionalText(),
});

/** Managed by BAKAAL: the management agreement. A blank fee is allowed (flagged for review), never invented. */
const managementSchema = z.object({
  mgmtStartDate: isoDate("Management start date"),
  mgmtEndDate: optionalIsoDate("Management end date"),
  managementFee: optionalMoney("Monthly management fee"),
  mgmtDueDay: optionalInt("Due day for the management fee", 1, 28),
  mgmtGraceDays: optionalInt("Grace period", 0, 60),
  mgmtReference: optionalText(80),
  mgmtNotes: optionalText(),
});

/** Optional rows of approved service/shared charges; blank rows are ignored. */
function parseCharges(form: FormData) {
  const rows = [];
  const numbers = chargeRowsOf(form);
  if (numbers.length > MAX_CHARGES) throw new BusinessError(`Add at most ${MAX_CHARGES} charges at once; add more on the agreement afterwards.`);
  for (const i of numbers) {
    const get = (k: string) => String(form.get(`charge${i}${k}`) ?? "").trim();
    if (!get("Description") && !get("Amount")) continue;
    const row = parseForm(
      z.object({
        [`charge${i}Category`]: z.enum(["SERVICE_CHARGE", "SHARED_CHARGE"], { message: "Choose service or shared charge." }),
        [`charge${i}Description`]: requiredText("Charge description", 120),
        [`charge${i}Amount`]: money("Charge amount"),
        [`charge${i}From`]: isoDate("Charge start date"),
        [`charge${i}To`]: optionalIsoDate("Charge end date"),
      }),
      form,
    ) as Record<string, never>;
    rows.push({ category: row[`charge${i}Category`], description: row[`charge${i}Description`], amount: row[`charge${i}Amount`], effectiveFrom: row[`charge${i}From`], effectiveTo: row[`charge${i}To`] });
  }
  return rows;
}

function submittedValues(form: FormData): Record<string, string> {
  const charges = chargeRowsOf(form).flatMap((i) => ["Category", "Description", "Amount", "From", "To"].map((k) => `charge${i}${k}`));
  return Object.fromEntries([...FORM_FIELDS, ...TYPE_FIELDS, ...charges, "billNow"].map((k) => [k, String(form.get(k) ?? "")]));
}

/** Runs a save; a duplicate becomes an error that names the matching accounts and keeps the entered values. */
async function saveParty(form: FormData, save: (actor: Actor) => Promise<unknown>, success?: string): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    try {
      await save(actor);
    } catch (e) {
      if (!(e instanceof DuplicateAccountError)) throw e;
      return {
        // Short headline; the form lists each matching account with a link and the matching field.
        error: "This account already exists, so nothing was saved.",
        fieldErrors: Object.fromEntries(
          e.matches.flatMap((m) => m.fields.map((f) => [f, `Already used by ${m.displayName}${m.archived ? " (archived)" : ""}.`] as const)).reverse(),
        ),
        values: submittedValues(form),
        duplicates: e.matches.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          archived: m.archived,
          reasons: m.fields.map((f) => `same ${CONTACT_FIELD_LABELS[f]}`),
        })),
      };
    }
    return success;
  });
  return state?.error ? { ...state, values: submittedValues(form) } : state;
}

/**
 * Add Account: one of three account types, with its agreements, approved charges and
 * documents, saved together in one transaction or not at all (see createAccount).
 */
export async function createPartyAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  let billed = "off";
  const state = await saveParty(form, async (actor) => {
    // Every section is checked before anything is reported, so all invalid fields are shown together.
    const issues: z.core.$ZodIssue[] = [];
    const collect = <T,>(parse: () => T): T | undefined => {
      try {
        return parse();
      } catch (e) {
        if (!(e instanceof z.ZodError)) throw e;
        issues.push(...e.issues);
      }
    };
    const check = <T extends z.ZodType>(schema: T) => collect(() => parseForm(schema, form));
    const party = check(partySchema);
    const kind = check(unitSchema);
    const accountType = kind?.accountType ?? z.enum(ACCOUNT_TYPES).safeParse(form.get("accountType")).data;
    const tenancy = accountType === "TENANT" ? check(tenancySchema) : undefined;
    const ownership = accountType && accountType !== "TENANT" ? check(ownershipSchema) : undefined;
    const management = accountType === "MANAGED" ? check(managementSchema) : undefined;
    const charges = collect(() => parseCharges(form));
    if (issues.length) throw new z.ZodError(issues);
    const ids = (name: string) => form.getAll(name).map(String);
    const input: NewAccountInput = {
      party: party!,
      accountType: kind!.accountType,
      unitId: kind!.unitId,
      charges: charges!,
      documents: { account: ids("documentIds"), agreement: ids("agreementDocumentIds"), management: ids("managementDocumentIds") },
      billNow: form.get("billNow") === "on",
    };
    if (tenancy) {
      const t = tenancy;
      input.tenancy = { startDate: t.startDate, endDate: t.endDate, rentAmount: t.rentAmount, depositAmount: t.depositAmount, dueDay: t.dueDay, graceDays: t.graceDays, reference: t.reference, lateFeeTerms: t.lateFeeTerms, allocationTerms: t.allocationTerms, notes: t.agreementNotes };
    }
    if (ownership) {
      const o = ownership;
      input.ownership = { startDate: o.ownerFrom, purchaseDate: o.purchaseDate, ownershipEvidence: o.ownershipEvidence, reference: o.ownershipReference, dueDay: o.ownerDueDay, notes: o.ownershipNotes };
    }
    if (management) {
      const m = management;
      input.management = { startDate: m.mgmtStartDate, endDate: m.mgmtEndDate, managementFeeAmount: m.managementFee, dueDay: m.mgmtDueDay, graceDays: m.mgmtGraceDays, reference: m.mgmtReference, notes: m.mgmtNotes };
    }
    const created = await createAccount(actor, input);
    id = created.party.id;
    billed = created.firstBilling ? String(created.firstBilling.invoices.length) : input.billNow ? "not-permitted" : "off";
  });
  if (!id) return state;
  finish(`/accounts/${id}?created=1&billing=${billed}`);
}

export async function updatePartyAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  return saveParty(
    form,
    (actor) => updateParty(actor, id, parseForm(partySchema, form)),
    "Account details saved. This existing account was updated; no new account was created.",
  );
}

export async function deletePartyAction(id: string, _: ActionState): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await deleteParty(actor, id);
  });
  if (state?.error) return state;
  finish("/accounts?deleted=1");
}

export async function archivePartyAction(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const state = await runAction(async (actor) => {
    await archiveParty(actor, id, String(form.get("archiveReason") ?? ""));
  });
  if (state?.error) return state;
  finish(`/accounts/${id}?archived=1`);
}
