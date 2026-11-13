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

// Case-insensitive LIKE: walks the pattern, because a regex built from an argument
// is blocked by the repo's static analysis.
function likeMatches(value: string, pattern: string): boolean {
  const matchFrom = (v: number, p: number): boolean => {
    if (p === pattern.length) return v === value.length;
    if (pattern[p] === "%") return matchFrom(v, p + 1) || (v < value.length && matchFrom(v + 1, p));
    if (v === value.length) return false;
    if (pattern[p] === "_") return matchFrom(v + 1, p + 1);
    const at = pattern[p] === "\\" ? p + 1 : p;
    return value[v].toLowerCase() === pattern[at]?.toLowerCase() && matchFrom(v + 1, at + 1);
  };
  return matchFrom(0, 0);
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
    // Per function, ahead of rpcResult.
    rpcResults: {} as Record<string, unknown>,
    rpcError: null as { code: string } | null,
    storageError: null as { message: string } | null,
    // Keys storage reports nothing for, as it does for a key it couldn't find.
    storageSkips: [] as string[],
    // PostgREST's max_rows: a read returns at most this many, with no error.
    maxRows: Infinity,
  };

  function from(table: string) {
    const predicates: ((row: Row) => boolean)[] = [];
    const filters: string[] = [];
    let op: Failure["op"] = "select";
    let patch: Row = {};
    let limit = Infinity;
    let offset = 0;
    let columns: string[] | null = null;

    const builder = {
      // A plain column list is honoured, so a column left off an allow-list stays out.
      // One with an embed or a * returns rows as they are.
      select: (list?: string) => {
        if (list && !/[(*]/.test(list)) columns = list.split(",").map((c) => c.trim());
        return builder;
      },
      order: () => builder,
      range: (from: number, to: number) => {
        offset = from;
        limit = to - from + 1;
        return builder;
      },
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
      is: (column: string, value: null) => {
        filters.push(column);
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filters.push(column);
        predicates.push((row) => row[column] !== value);
        return builder;
      },
      ilike: (column: string, pattern: string) => {
        filters.push(column);
        predicates.push((row) => typeof row[column] === "string" && likeMatches(row[column], pattern));
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
        const matched = rows.filter((row) => predicates.every((p) => p(row))).slice(offset, offset + Math.min(limit, op === "select" ? state.maxRows : Infinity));
        if (op !== "select") log.writes.push({ table, op, filters });
        if (op === "update") matched.forEach((row) => Object.assign(row, patch));
        if (op === "delete") tables[table] = rows.filter((row) => !matched.includes(row));
        const project = (row: Row) =>
          columns ? Object.fromEntries(Object.entries(row).filter(([c]) => columns!.includes(c))) : { ...row };
        resolve({ data: matched.map(project), error: null });
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
        : { data: name in state.rpcResults ? state.rpcResults[name] : state.rpcResult, error: null };
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
