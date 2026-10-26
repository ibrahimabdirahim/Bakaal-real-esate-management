// Runs before `npm run dev` / `npm start`. If Bakaal's port is taken, explains who holds it
// instead of Next.js's bare EADDRINUSE error.
// With --stop-own (used by `npm run dev:restart`) it stops the holder, but ONLY if it is a
// server started from this project folder; anything else is reported and left alone.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = 3001;
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopOwn = process.argv.includes("--stop-own");

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const listeners = () => [...new Set(run("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"]).split("\n").filter(Boolean).map(Number))];
const cwdOf = (pid) => run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "";
const commandOf = (pid) => run("ps", ["-o", "command=", "-p", String(pid)]);
const parentOf = (pid) => Number(run("ps", ["-o", "ppid=", "-p", String(pid)])) || 0;

const holders = listeners();
if (holders.length === 0) process.exit(0);

const own = holders.filter((pid) => cwdOf(pid) === project);
const others = holders.filter((pid) => !own.includes(pid));

if (others.length) {
  console.error(`\nPort ${PORT} is in use by a program that is NOT this Bakaal project, so nothing was stopped:`);
  for (const pid of others) console.error(`  PID ${pid}: ${commandOf(pid) || "unknown"} (folder: ${cwdOf(pid) || "unknown"})`);
  console.error(`Close that program yourself, then run the command again.\n`);
  process.exit(1);
}

if (!stopOwn) {
  console.error(`\nBakaal is already running on port ${PORT} (PID ${own.join(", ")}).`);
  console.error(`  • Just open http://localhost:${PORT}`);
  console.error(`  • Or restart it with:  npm run dev:restart\n`);
  process.exit(1);
}

// Stop this project's server: the listening next-server and its `next dev`/`next start` parent.
for (const pid of own) {
  const parent = parentOf(pid);
  const targets = [pid];
  if (parent > 1 && cwdOf(parent) === project && /next (dev|start)/.test(commandOf(parent))) targets.push(parent);
  for (const t of targets) {
    try {
      process.kill(t, "SIGTERM");
    } catch {
      // already gone
    }
  }
  console.log(`Stopped the running Bakaal server (PID ${targets.join(", ")}).`);
}
for (let i = 0; i < 50 && listeners().length; i++) await new Promise((r) => setTimeout(r, 200));
if (listeners().length) {
  console.error(`Port ${PORT} is still busy; try again in a few seconds.`);
  process.exit(1);
}
