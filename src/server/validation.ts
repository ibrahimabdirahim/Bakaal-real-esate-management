import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { tryCents } from "@/lib/money";

// Shared form field schemas. Form values arrive as strings.

const trimmed = z.string().trim();

export const requiredText = (label: string, max = 200) =>
  trimmed.min(1, `${label} is required.`).max(max, `${label} is too long.`);

export const optionalText = (max = 2000) =>
  z.string().trim().max(max, "Text is too long.").optional().transform((v) => (v ? v : null));

export const isoDate = (label: string) =>
  trimmed.refine((v) => isISODate(v), `${label} must be a valid date.`);

export const optionalIsoDate = (label: string) =>
  z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || isISODate(v), `${label} must be a valid date.`);

/** Positive money amount in cents. */
export const money = (label: string) =>
  trimmed.transform((v, ctx) => {
    const c = tryCents(v);
    if (c == null || c <= 0) {
      ctx.addIssue({ code: "custom", message: `${label} must be a positive amount with at most 2 decimals.` });
      return z.NEVER;
    }
    return c;
  });

export const optionalMoney = (label: string) =>
  z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const c = tryCents(v);
    if (c == null || c <= 0) {
      ctx.addIssue({ code: "custom", message: `${label} must be a positive amount with at most 2 decimals.` });
      return z.NEVER;
    }
    return c;
  });

/** An optional amount that may be zero (e.g. an agreed deposit of KES 0); blank = not recorded. */
export const optionalNonNegativeMoney = (label: string) =>
  z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const c = tryCents(v);
    if (c == null || c < 0) {
      ctx.addIssue({ code: "custom", message: `${label} must be zero or a positive amount with at most 2 decimals.` });
      return z.NEVER;
    }
    return c;
  });

export const optionalInt = (label: string, min: number, max: number) =>
  z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `${label} must be a whole number from ${min} to ${max}.` });
      return z.NEVER;
    }
    return n;
  });

export const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail address is not valid.");

/** Reads FormData into a plain object of strings (multi-value keys become arrays). */
export function formToObject(form: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}
