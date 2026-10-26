// Creates the first system administrator (or another administrator) from the terminal.
// Usage: npm run user:create-admin
// The password is typed without being shown and is never written to logs.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { hashPassword, passwordProblem } from "@/server/auth/password";

async function askHidden(question: string): Promise<string> {
  stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        stdout.write("\n");
        process.exit(1);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question("Administrator e-mail: ")).trim().toLowerCase();
const name = (await rl.question("Full name: ")).trim();
rl.close();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error("A valid e-mail and a name are required.");
  process.exit(1);
}
if (await db.user.findUnique({ where: { email } })) {
  console.error(`A staff account with ${email} already exists. Use Settings → Staff accounts to manage it.`);
  process.exit(1);
}
const password = await askHidden("Password (min. 12 characters, hidden): ");
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
if ((await askHidden("Repeat password: ")) !== password) {
  console.error("The passwords do not match.");
  process.exit(1);
}

const user = await db.user.create({ data: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) } });
await audit(db, null, { action: "user.create", entityType: "User", entityId: user.id, summary: `Created administrator ${email} from the command line`, after: { email, name, role: "ADMIN" } });
console.log(`Administrator ${email} created. Sign in at http://localhost:3001/login`);
await db.$disconnect();
