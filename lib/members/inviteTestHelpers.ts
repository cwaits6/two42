// A recording stand-in for the service client the invite path writes
// through. It records the org predicate on every chain, which is the only
// tenant boundary a service-role query has.

export interface RecordedCall {
  table: string;
  op: "select" | "insert" | "delete";
  payload?: Record<string, unknown>;
  filters: [string, string, unknown][];
}

export interface FakeServiceOptions {
  /** Rows the profiles / access_requests lookups return. */
  existing?: { profiles?: { email: string }[]; access_requests?: { email: string }[] };
  /** Tables whose insert fails. */
  failInsert?: string[];
}

export function fakeServiceClient(options: FakeServiceOptions = {}) {
  const calls: RecordedCall[] = [];
  const failInsert = new Set(options.failInsert ?? []);

  function chain(call: RecordedCall, result: () => { data: unknown; error: unknown }) {
    const builder = {
      select: () => builder,
      eq(column: string, value: unknown) {
        call.filters.push(["eq", column, value]);
        return builder;
      },
      in(column: string, value: unknown) {
        call.filters.push(["in", column, value]);
        return builder;
      },
      single: async () => result(),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select() {
          const call: RecordedCall = { table, op: "select", filters: [] };
          calls.push(call);
          const rows =
            (options.existing as Record<string, unknown[]> | undefined)?.[table] ?? [];
          return chain(call, () => ({ data: rows, error: null }));
        },
        insert(payload: Record<string, unknown>) {
          const call: RecordedCall = { table, op: "insert", payload, filters: [] };
          calls.push(call);
          return chain(call, () =>
            failInsert.has(table)
              ? { data: null, error: { code: "42501", message: "denied" } }
              : { data: { id: `${table}-1`, token: `${table}-token` }, error: null }
          );
        },
        delete() {
          const call: RecordedCall = { table, op: "delete", filters: [] };
          calls.push(call);
          return chain(call, () => ({ data: null, error: null }));
        },
      };
    },
  };

  return { client, calls };
}
