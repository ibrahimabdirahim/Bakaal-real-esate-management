// Node module-resolution hook for command-line scripts: resolves the "@/..." import
// alias to ./src and extensionless TypeScript imports, so scripts can reuse the
// application's services with Node's built-in TypeScript support (no extra packages).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && !path.endsWith("/")) return url;
  for (const ext of EXTENSIONS) {
    if (existsSync(path + ext)) return pathToFileURL(path + ext).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = withExtension(new URL(specifier.slice(2), SRC).href);
    if (found) return { url: found, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const found = withExtension(new URL(specifier, context.parentURL).href);
    if (found) return { url: found, shortCircuit: true };
  }
  // Next.js subpath modules ("next/headers", "next/navigation") have no package "exports" map,
  // so plain Node needs the file extension. They are only loaded by scripts, never called.
  if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
