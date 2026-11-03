// An in-memory stand-in for the service client that honours the filters a chain
// actually carries, so a dropped org filter changes the result and fails a test.

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export interface Failure {
  table: string;
  op: "select" | "update" | "delete";
}

function ilikeMatches(value: unknown, pattern: string) {
  if (typeof value !== "string") return false;
  const literal = pattern.replace(/\\([\\%_])/g, "$1");
  return !/(^|[^\\])[%_]/.test(pattern) && value.toLowerCase() === literal.toLowerCase();
}

export function fakeService(tables: Tables) {
  const failures: Failure[] = [];
  const log = {
    writes: [] as { table: string; op: string; filters: string[] }[],
    deletedUsers: [] as string[],
    removedObjects: [] as string[],
  };
  const state = {
    deleteUserError: null as { code: string } | null,
    storageError: null as { message: string } | null,
    // What the auth cascade does to the profile; off proves the check after it.
    cascade: true,
    onDeleteUser: null as (() => void) | null,
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
      ilike: (column: string, pattern: string) => {
        filters.push(column);
        predicates.push((row) => ilikeMatches(row[column], pattern));
        return builder;
      },
      or: (expression: string) => {
        const id = expression.split("claimed_profile_id.eq.")[1];
        predicates.push((row) => row.claimed_profile_id === null || row.claimed_profile_id === id);
        return builder;
      },
      then(resolve: (value: { data: Row[] | null; error: { code: string } | null }) => void) {
        if (failures.some((f) => f.table === table && f.op === op)) {
          resolve({ data: null, error: { code: "XX000" } });
          return;
        }
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
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          state.onDeleteUser?.();
          if (state.deleteUserError) return { error: state.deleteUserError };
          log.deletedUsers.push(id);
          if (state.cascade) tables.profiles = tables.profiles.filter((p) => p.id !== id);
          return { error: null };
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          if (state.storageError) return { data: null, error: state.storageError };
          log.removedObjects.push(...paths.map((p) => `${bucket}/${p}`));
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };

  return { client, log, state, failures };
}
