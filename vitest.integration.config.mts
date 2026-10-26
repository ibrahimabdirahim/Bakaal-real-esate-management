import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests use the real PostgreSQL test database and run one file at a time.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
