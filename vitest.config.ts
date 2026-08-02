import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // app/** and scripts/** are included so a test placed there is not
    // silently collected as zero tests — an omitted glob makes a test file
    // look green while never running. scripts/ covers the operator scripts'
    // pure halves (e.g. scripts/rekeyPlan.mjs).
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
  resolve: {
    // Mirrors tsconfig.json `paths: { "@/*": ["./*"] }`. A plain alias
    // avoids adding vite-tsconfig-paths for a single mapping.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
