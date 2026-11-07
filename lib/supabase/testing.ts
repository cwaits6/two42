// A stand-in for the Supabase client in route tests. Each `from(table)` takes
// the next answer queued for that table, whatever filters the route chains.

import { expect } from "vitest";
import { loggedLines } from "@/lib/log/testing";

export type QueryAnswer = { data: unknown; error: unknown };

/**
 * A database error naming a table, a column and a policy in every text field,
 * so a test can prove none of them reaches a response body or a log line.
 */
export const SCHEMA_REVEALING_ERROR = {
  code: "42501",
  message: 'new row violates row-level security policy "family_members_org_isolation" for table "family_members"',
  details: "Failing row contains (birth_year, preferred_name).",
  hint: 'Check the column "family_id".',
};

export const SCHEMA_WORDS = ["family_members", "org_isolation", "policy", "birth_year", "family_id", "Failing row"];

function chain(answer: QueryAnswer): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: QueryAnswer) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(answer).then(resolve, reject);
        }
        if (prop === "single" || prop === "maybeSingle") return async () => answer;
        return () => proxy;
      },
    },
  );
  return proxy;
}

export function fakeQueryClient(
  answers: Record<string, QueryAnswer[]>,
  user: { id: string } | null = { id: "user-1" },
) {
  const queues = Object.fromEntries(Object.entries(answers).map(([table, list]) => [table, [...list]]));
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      const next = queues[table]?.shift();
      if (!next) throw new Error(`unexpected read of ${table}`);
      return chain(next);
    },
  };
}

/**
 * The route answered with its fixed message and status, and logged the
 * failure exactly once with the error's code; neither holds the error's text.
 */
export async function expectSchemaHidden(
  res: Response,
  log: { mock: { calls: unknown[][] } },
  expected: { status: number; error: string; what: string; route: string },
) {
  expect(res.status).toBe(expected.status);
  const body = await res.text();
  expect(JSON.parse(body)).toEqual({ error: expected.error });
  const lines = loggedLines(log);
  expect(lines).toEqual([
    expect.objectContaining({ level: "error", what: expected.what, route: expected.route, code: "42501" }),
  ]);
  const logged = JSON.stringify(lines);
  for (const word of SCHEMA_WORDS) {
    expect(body).not.toContain(word);
    expect(logged).not.toContain(word);
  }
}
