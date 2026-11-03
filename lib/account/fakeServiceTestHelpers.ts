// An in-memory stand-in for the service client that honours the filters a chain
// actually carries, so a dropped org filter changes the result and fails a test.

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export interface Failure {
  table: string;
  op: "select" | "update" | "delete";
  // Let this many matching calls through first, to fail a later one in the same run.
  skip?: number;
}

export function fakeService(tables: Tables) {
  const failures: Failure[] = [];
  const log = {
    writes: [] as { table: string; op: string; filters: string[] }[],
    rpcs: [] as { name: string; args: unknown }[],
    removedObjects: [] as string[],
  };
  const state = {
    rpcResult: null as unknown,
    rpcError: null as { code: string } | null,
    storageError: null as { message: string } | null,
    // Keys storage reports nothing for, as it does for a key it couldn't find.
    storageSkips: [] as string[],
  };

  function from(table: string) {
    const predicates: ((row: Row) => boolean)[] = [];
    const filters: string[] = [];
    let op: Failure["op"] = "select";
    let patch: Row = {};
    let limit = Infinity;

    const builder = {
      select: () => builder,
      order: () => builder,
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      update: (values: Row) => {
        op = "update";
        patch = values;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push(column);
        predicates.push((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filters.push(column);
        predicates.push((row) => row[column] !== value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push(column);
        predicates.push((row) => values.includes(row[column]));
        return builder;
      },
      not: (column: string) => {
        filters.push(column);
        predicates.push((row) => row[column] !== null && row[column] !== undefined);
        return builder;
      },
      or: (expression: string) => {
        const id = expression.split("claimed_profile_id.eq.")[1];
        predicates.push((row) => row.claimed_profile_id === null || row.claimed_profile_id === id);
        return builder;
      },
      then(resolve: (value: { data: Row[] | null; error: { code: string } | null }) => void) {
        const failure = failures.find((f) => f.table === table && f.op === op);
        if (failure && !failure.skip) {
          resolve({ data: null, error: { code: "XX000" } });
          return;
        }
        if (failure?.skip) failure.skip -= 1;
        const rows = tables[table] ?? [];
        const matched = rows.filter((row) => predicates.every((p) => p(row))).slice(0, limit);
        if (op !== "select") log.writes.push({ table, op, filters });
        if (op === "update") matched.forEach((row) => Object.assign(row, patch));
        if (op === "delete") tables[table] = rows.filter((row) => !matched.includes(row));
        resolve({ data: matched.map((row) => ({ ...row })), error: null });
      },
    };
    return builder;
  }

  const client = {
    from,
    rpc: async (name: string, args: unknown) => {
      log.rpcs.push({ name, args });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: state.rpcResult, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          if (state.storageError) return { data: null, error: state.storageError };
          const removed = paths.filter((p) => !state.storageSkips.includes(p));
          log.removedObjects.push(...removed.map((p) => `${bucket}/${p}`));
          return { data: removed.map((name) => ({ name })), error: null };
        },
      }),
    },
  };

  return { client, log, state, failures };
}
