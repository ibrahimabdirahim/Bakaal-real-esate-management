import { describe, expect, it } from "vitest";
import { changedContactFields, matchingContactFields, normalizeEmail, normalizeIdNumber, normalizePhone } from "./contact";

const blank = { email: null, phone: null, idNumber: null };

describe("contact normalisation", () => {
  it("normalises e-mail case and whitespace", () => {
    expect(normalizeEmail("  Someone@Example.COM ")).toBe("someone@example.com");
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("treats national and international Kenyan formats as the same phone number", () => {
    expect(normalizePhone("0757079441")).toBe("0757079441");
    expect(normalizePhone("+254 757 079 441")).toBe("0757079441");
    expect(normalizePhone("254757079441")).toBe("0757079441");
    expect(normalizePhone("00254757079441")).toBe("0757079441");
    expect(normalizePhone("0757-079-441")).toBe("0757079441");
    expect(normalizePhone("(0757) 079 441")).toBe("0757079441");
  });

  it("keeps genuinely different phone numbers different", () => {
    expect(normalizePhone("0757079441")).not.toBe(normalizePhone("0757079442"));
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
  });

  it("ignores blank or too-short phone numbers", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("  ")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
  });

  it("normalises ID numbers without merging different ones", () => {
    expect(normalizeIdNumber(" ab 123-45 ")).toBe("AB12345");
    expect(normalizeIdNumber("40706460")).not.toBe(normalizeIdNumber("40706461"));
    expect(normalizeIdNumber(" ")).toBeNull();
  });
});

describe("matching contact fields", () => {
  it("reports every shared field", () => {
    const a = { email: "A@x.com", phone: "0700 111 222", idNumber: "123" };
    const b = { email: "a@x.com ", phone: "+254700111222", idNumber: "123" };
    expect(matchingContactFields(a, b)).toEqual(["email", "phone", "idNumber"]);
  });

  it("never matches on blank optional fields", () => {
    expect(matchingContactFields(blank, blank)).toEqual([]);
    expect(matchingContactFields({ ...blank, phone: "" }, { ...blank, phone: "" })).toEqual([]);
  });

  it("can be limited to some fields", () => {
    const a = { email: "a@x.com", phone: "0700111222", idNumber: null };
    expect(matchingContactFields(a, a, ["phone"])).toEqual(["phone"]);
  });

  it("detects which fields changed, ignoring formatting-only edits", () => {
    const before = { email: "a@x.com", phone: "0700111222", idNumber: "AB1" };
    expect(changedContactFields(before, { email: "A@X.com", phone: "+254 700 111 222", idNumber: "ab-1" })).toEqual([]);
    expect(changedContactFields(before, { ...before, phone: "0700111223" })).toEqual(["phone"]);
  });
});
