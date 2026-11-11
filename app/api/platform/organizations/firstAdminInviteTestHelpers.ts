// A recording stand-in for the service client the first admin's invite runs
// on. Every chain's filters are kept, because on a service client they are
// the only tenant boundary.

export interface RecordedChain {
  table: string;
  op: "rpc" | "select" | "update";
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
}

export interface FakeServiceOptions {
  /** What provision_organization answers. */
  rpc?: () => { data: unknown; error: unknown };
  /** The founding requests the read returns. */
  rows?: { id: string; email: string }[];
  /** Rows the token update reports as written. */
  updated?: number;
}

export function fakeFirstAdminService(options: FakeServiceOptions = {}) {
  const calls: RecordedChain[] = [];

  function chain(call: RecordedChain, result: () => { data: unknown; error: unknown }) {
    const builder = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      select: () => builder,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ table: name, op: "rpc", payload: args, filters: [] });
      return options.rpc ? options.rpc() : { data: "org-new", error: null };
    },
    from(table: string) {
      return {
        select() {
          const call: RecordedChain = { table, op: "select", filters: [] };
          calls.push(call);
          return chain(call, () => ({ data: options.rows ?? [], error: null }));
        },
        update(payload: Record<string, unknown>) {
          const call: RecordedChain = { table, op: "update", payload, filters: [] };
          calls.push(call);
          const n = options.updated ?? 1;
          return chain(call, () => ({
            data: Array.from({ length: n }, (_, i) => ({ id: `row-${i}` })),
            error: null,
          }));
        },
      };
    },
  };

  return { client, calls };
}
