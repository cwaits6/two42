// Who may call a cron function. Requires --allow-env.

import { assertEquals } from "jsr:@std/assert@1";
import { isServiceKeyCaller, serviceKeyCallerOnly } from "../_shared/caller-auth.ts";

const KEY_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"];

function withEnv(env: Record<string, string>, fn: () => void) {
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

function request(authorization?: string): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

Deno.test("accepts every service key in the environment, not only the resolved one", () => {
  withEnv(
    {
      SUPABASE_SECRET_KEY: "direct-key",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "map-key", other: "other-key" }),
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    },
    () => {
      for (const key of ["direct-key", "map-key", "other-key", "legacy-key"]) {
        assertEquals(isServiceKeyCaller(request(`Bearer ${key}`)), true, key);
      }
    },
  );
});

Deno.test("refuses a wrong key, a key's prefix, no header and another scheme", () => {
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }, () => {
    for (const header of ["Bearer anon-key", "Bearer legacy-ke", "Bearer legacy-key2", "Basic legacy-key", "legacy-key"]) {
      assertEquals(isServiceKeyCaller(request(header)), false, header);
    }
    assertEquals(isServiceKeyCaller(request()), false);
  });
});

Deno.test("refuses everyone when the environment holds no key", () => {
  withEnv({}, () => {
    assertEquals(isServiceKeyCaller(request("Bearer ")), false);
    assertEquals(isServiceKeyCaller(request("Bearer undefined")), false);
  });
});

Deno.test("a malformed key map adds nothing and leaves the other keys working", () => {
  withEnv({ SUPABASE_SECRET_KEYS: "not json", SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }, () => {
    assertEquals(isServiceKeyCaller(request("Bearer legacy-key")), true);
    assertEquals(isServiceKeyCaller(request("Bearer not json")), false);
  });
});

Deno.test("empty and non-string map values never match", () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: "", b: 7, c: "map-key" }) }, () => {
    assertEquals(isServiceKeyCaller(request("Bearer 7")), false);
    assertEquals(isServiceKeyCaller(request("Bearer map-key")), true);
  });
});

Deno.test("a refused caller gets a 401, never reaches the handler, and the log names no token", async () => {
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  let reached = 0;
  const guarded = serviceKeyCallerOnly(() => {
    reached++;
    return new Response("ran");
  });
  const responses: (Response | Promise<Response>)[] = [];
  try {
    withEnv({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }, () => {
      for (const header of [undefined, "Bearer wrong-token", "Bearer publishable-token", "Basic legacy-key"]) {
        responses.push(guarded(request(header)));
      }
    });
  } finally {
    console.error = realError;
  }
  for (const pending of responses) {
    const res = await pending;
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(await res.json(), { error: "Unauthorized" });
  }
  assertEquals(reached, 0);
  assertEquals(logged.length, 4);
  const text = JSON.stringify(logged);
  for (const token of ["wrong-token", "publishable-token", "legacy-key"]) {
    assertEquals(text.includes(token), false, token);
  }
});

Deno.test("a service key caller reaches the handler with the request body unread", async () => {
  const guarded = serviceKeyCallerOnly(async (req) => new Response(await req.text()));
  let pending: Response | Promise<Response> = new Response(null, { status: 500 });
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }, () => {
    pending = guarded(
      new Request("http://localhost/", {
        method: "POST",
        headers: { Authorization: "Bearer legacy-key" },
        body: '{"mode":"monthly"}',
      }),
    );
  });
  const res = await pending;
  assertEquals(res.status, 200);
  assertEquals(await res.text(), '{"mode":"monthly"}');
});
