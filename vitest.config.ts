import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // scripts/ is included because the operator scripts' pure halves
    // (e.g. scripts/rekeyPlan.mjs) are unit-tested — a test placed there is
    // otherwise silently never discovered.
    include: ["lib/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
  resolve: {
    // Mirrors tsconfig.json `paths: { "@/*": ["./*"] }`. A plain alias
    // avoids adding vite-tsconfig-paths for a single mapping.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
