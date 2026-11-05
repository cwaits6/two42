// The edge functions' copy of the log core, run under Deno. That the copy is
// identical to lib/log/core.ts is checked by lib/log/mirror.test.ts; this
// proves the copy behaves in this runtime. Pure unit: no network, no env.

import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import { logError } from "../_shared/log.ts";

Deno.test("log line holds the error's code and nothing from its message, details or hint", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => void lines.push(line);
  let reference: string;
  try {
    reference = logError(
      "Reminder send failed",
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_email_key"',
        details: "Key (email)=(sample.person@example.com) already exists.",
        hint: "Please pray for my mother before her surgery on Friday.",
      },
      { route: "send-event-reminders", ids: { event: "3f0c9a52-7b1e-4c7d-9a41-0d2f6e8b1c33" } },
    );
  } finally {
    console.log = original;
  }

  assertEquals(lines.length, 1);
  assertNotMatch(lines[0], /example\.com|pray|duplicate key/);
  assertMatch(reference, /^[A-HJ-NP-Z2-9]{8}$/);
  assertEquals(JSON.parse(lines[0]), {
    level: "error",
    what: "Reminder send failed",
    route: "send-event-reminders",
    code: "23505",
    ref: reference,
    ids: { event: "3f0c9a52-7b1e-4c7d-9a41-0d2f6e8b1c33" },
  });
});
