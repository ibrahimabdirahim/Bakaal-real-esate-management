// Real check of the configured document storage (run it after setting up Cloudflare R2):
// stores a small test file, reads it back, compares it, and deletes it, through the app's own storage
// code. Settings come from the environment, or from a git-ignored `.env.storage` file holding the
// DOCUMENT_STORAGE and S3_* values. Prints the bucket and endpoint host, never a key or secret.
// Usage: npm run storage:check
import { existsSync } from "node:fs";

if (existsSync(".env.storage")) process.loadEnvFile(".env.storage");
const { deleteStoredFile, readStoredFile, resetStorageCheck, storageKind, storageWritable, storeFile } = await import("@/server/storage");

const kind = storageKind();
const where = kind === "s3" ? `bucket ${process.env.S3_BUCKET ? `"${process.env.S3_BUCKET}"` : "(not set)"} at ${process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).host : "(no endpoint set)"}` : "the local folder";
console.log(`Checking document storage: ${kind}, ${where}`);
let failed = false;
const step = async (name: string, f: () => Promise<boolean>) => {
  try {
    const ok = await f();
    console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }
};
const bytes = new TextEncoder().encode(`%PDF-1.4\n% BAKAAL storage check ${new Date().toISOString()}\n%%EOF\n`);
let key = "";
resetStorageCheck();
await step("storage answers with valid credentials", () => storageWritable());
await step("store a test file", async () => ((key = (await storeFile(bytes, "application/pdf")).key), true));
await step("read it back unchanged", async () => !!key && Buffer.from(await readStoredFile(key)).equals(Buffer.from(bytes)));
await step("delete it again", async () => (key ? (await deleteStoredFile(key), true) : false));
await step("it is gone", async () => (key ? readStoredFile(key).then(() => false, () => true) : false));
console.log(failed ? "STORAGE CHECK FAILED" : "STORAGE CHECK PASSED");
process.exit(failed ? 1 : 0);
