// Loaded with `node --import ./scripts/register.mjs` to enable the "@/" alias for scripts.
import { register } from "node:module";

register("./ts-paths.mjs", import.meta.url);

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set in the environment.
}
