// Password hashing with Node's built-in scrypt (memory-hard; no extra dependency).
// Stored format: scrypt$N$r$p$<salt base64>$<hash base64>

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Minimum password rule (password policy is unresolved; this is a conservative floor). */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}

/** Random password for newly created staff accounts (shown once to the administrator). */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}
