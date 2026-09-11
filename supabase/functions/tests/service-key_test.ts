// Regression lock on the hardened service-key precedence (commit 834d76b)
// across the move to _shared/service-key.ts. Requires --allow-env.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { resolveServiceKey } from "../_shared/service-key.ts";

const KEY_VARS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** Run `fn` with exactly `env` set (other key vars cleared); restore after. */
function withEnv(env: Partial<Record<(typeof KEY_VARS)[number], string>>, fn: () => void) {
  const saved = KEY_VARS.map((k) => [k, Deno.env.get(k)] as const);
  try {
    for (const k of KEY_VARS) Deno.env.delete(k);
    for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("prefers the explicit SUPABASE_SECRET_KEY override", () => {
  withEnv(
    {
      SUPABASE_SECRET_KEY: "direct-key",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "map-key" }),
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    },
    () => assertEquals(resolveServiceKey(), "direct-key"),
  );
});

Deno.test("reads the default entry from the SUPABASE_SECRET_KEYS map", () => {
  withEnv(
    {
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "map-key", other: "other-key" }),
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    },
    () => assertEquals(resolveServiceKey(), "map-key"),
  );
});

Deno.test("falls back to the first entry when the map has no default key", () => {
  withEnv(
    {
      SUPABASE_SECRET_KEYS: JSON.stringify({ renamed: "renamed-key" }),
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    },
    () => assertEquals(resolveServiceKey(), "renamed-key"),
  );
});

Deno.test("falls back to SUPABASE_SERVICE_ROLE_KEY when the map is not valid JSON", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    withEnv(
      {
        SUPABASE_SECRET_KEYS: "not json",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
      },
      () => assertEquals(resolveServiceKey(), "legacy-key"),
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("falls back to SUPABASE_SERVICE_ROLE_KEY when the map is a JSON array", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    withEnv(
      {
        SUPABASE_SECRET_KEYS: JSON.stringify(["array-key"]),
        SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
      },
      () => assertEquals(resolveServiceKey(), "legacy-key"),
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("throws when no key source is present", () => {
  withEnv({}, () => {
    assertThrows(
      () => resolveServiceKey(),
      Error,
      "No service key found",
    );
  });
});
