// Normalised contact details for spotting possible duplicate accounts. These are used
// only for comparison; the values the user typed are stored unchanged.

export type ContactField = "email" | "phone" | "idNumber";

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  email: "e-mail",
  phone: "phone number",
  idNumber: "ID / registration number",
};

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Digits only, with the Kenyan international prefix folded into the national form:
 * "+254 757 079 441", "254757079441" and "0757-079-441" all become "0757079441".
 * Numbers with fewer than 7 digits are too short to compare and are ignored.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^254\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  return digits.length >= 7 ? digits : null;
}

/** Upper case without spaces or hyphens: "ab 123-45" and "AB12345" compare equal. */
export function normalizeIdNumber(value: string | null | undefined): string | null {
  const v = value?.replace(/[\s-]/g, "").toUpperCase();
  return v ? v : null;
}

export interface ContactDetails {
  email: string | null;
  phone: string | null;
  idNumber: string | null;
}

const NORMALIZERS: Record<ContactField, (v: string | null | undefined) => string | null> = {
  email: normalizeEmail,
  phone: normalizePhone,
  idNumber: normalizeIdNumber,
};

/** Which contact fields two records share (blank fields never match). */
export function matchingContactFields(a: ContactDetails, b: ContactDetails, only?: ContactField[]): ContactField[] {
  return (only ?? (Object.keys(NORMALIZERS) as ContactField[])).filter((field) => {
    const left = NORMALIZERS[field](a[field]);
    return left !== null && left === NORMALIZERS[field](b[field]);
  });
}

/** Fields whose normalised value differs between two versions of the same record. */
export function changedContactFields(before: ContactDetails, after: ContactDetails): ContactField[] {
  return (Object.keys(NORMALIZERS) as ContactField[]).filter((field) => NORMALIZERS[field](before[field]) !== NORMALIZERS[field](after[field]));
}
