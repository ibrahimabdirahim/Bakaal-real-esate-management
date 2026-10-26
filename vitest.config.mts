import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node", // business logic runs on the server, not in a browser
    include: ["src/**/*.test.ts"], // test files sit next to the code they test
    exclude: ["src/**/*.int.test.ts"], // database tests run via `npm run test:integration`
  },
});
