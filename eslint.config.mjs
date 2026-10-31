import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This app intentionally loads client-side Supabase data from effects.
      "react-hooks/set-state-in-effect": "off",
      // Native dialogs can't be styled or named for the action; see "Messages" in docs/design/DESIGN.md.
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use ConfirmDialog." },
        { name: "alert", message: "Use a toast or an inline message." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use ConfirmDialog." },
        { object: "window", property: "alert", message: "Use a toast or an inline message." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
